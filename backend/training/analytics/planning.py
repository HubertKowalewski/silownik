"""Planowanie: skalowanie przy klonowaniu, dobór planu, podwójna progresja, realizacja planu."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from ..models import Exercise, ExerciseSet, LoadType, PlanExercise, WorkoutPlan, WorkoutSession
from .core import current_1rm, round_down

LEVEL_ORDER = ['beginner', 'intermediate', 'advanced']

# --- SKALOWANIE PRZY KLONOWANIU (WF-17, WF-18) --------------------------------

def scale_plan_for(user, plan: WorkoutPlan, substitutions: dict | None = None) -> list[dict]:
    """Przelicza obciążenia planu na możliwości użytkownika.

    - %1RM:  w = floor(p * 1RM_odbiorcy / Δ) * Δ
    - RPE:   bez przeliczenia - intensywność jest względna z definicji
    - kg:    proporcjonalnie do 1RM_odbiorcy / 1RM_autora, gdy oba są znane
    Brak 1RM odbiorcy oznacza konieczność kalibracji (ćwiczenie testowe).
    """
    substitutions = substitutions or {}
    increment = getattr(getattr(user, 'profile', None), 'load_increment', 2.5) or 2.5
    result = []
    items = plan.exercises.select_related('exercise', 'day').order_by('day__week', 'day__order', 'order')
    for item in items:
        exercise = item.exercise
        if str(item.id) in substitutions:
            exercise = Exercise.objects.get(pk=substitutions[str(item.id)])
        user_1rm, source = current_1rm(user, exercise.id)
        weight, basis, needs_calibration = None, '', False

        if item.load_type == LoadType.RPE:
            basis = f'RPE {item.load_value:g} - dobór ciężaru w trakcie treningu'
        elif item.load_type == LoadType.PERCENT:
            if user_1rm > 0:
                weight = round_down(user_1rm * item.load_value / 100, increment)
                basis = f'{item.load_value:g}% z 1RM {user_1rm:g} kg ({source})'
            else:
                needs_calibration = True
                basis = 'brak 1RM - wykonaj ćwiczenie testowe'
        elif plan.creator_id == user.id and exercise.id == item.exercise_id:
            # własny plan w kg: ciężar podany przez autora jest jego ciężarem roboczym
            weight = item.load_value
            basis = f'{item.load_value:g} kg wg planu'
        else:  # kg w cudzym planie
            author_1rm, _ = current_1rm(plan.creator, item.exercise_id)
            if user_1rm > 0 and author_1rm > 0:
                weight = round_down(item.load_value * user_1rm / author_1rm, increment)
                basis = f'{item.load_value:g} kg x (1RM {user_1rm:g} / 1RM autora {author_1rm:g})'
            else:
                needs_calibration = True
                basis = 'brak 1RM do przeliczenia - wykonaj ćwiczenie testowe'

        result.append({
            'plan_exercise_id': item.id,
            'day_id': item.day_id,
            'day_name': item.day.name if item.day else '',
            'week': item.day.week if item.day else 1,
            'exercise_id': exercise.id,
            'exercise_name': exercise.name,
            'substituted': exercise.id != item.exercise_id,
            'sets': item.target_sets,
            'reps': item.target_reps,
            'load_type': item.load_type,
            'load_value': item.load_value,
            'user_1rm': user_1rm,
            'suggested_weight': weight,
            'needs_calibration': needs_calibration,
            'based_on': basis,
        })
    return result


# --- DOBÓR PLANU (WF-14, WF-15) ----------------------------------------------

def user_restrictions(user) -> set[int]:
    health = getattr(user, 'health', None)
    if not health or not health.consent_given:
        return set()
    return set(health.restrictions.values_list('id', flat=True))


def plan_match(user, plan: WorkoutPlan) -> dict:
    """Ocena zgodności planu z profilem (0-100) oraz ostrzeżenia zdrowotne.

    Wagi: poziom 30, liczba dni 30, sprzęt 25, cel 15.
    """
    profile = getattr(user, 'profile', None)
    score, reasons = 0, []
    if profile:
        diff = abs(LEVEL_ORDER.index(profile.level) - LEVEL_ORDER.index(plan.level))
        level_pts = {0: 30, 1: 15}.get(diff, 0)
        score += level_pts
        if diff:
            reasons.append(f'poziom planu: {plan.get_level_display().lower()}')

        day_diff = abs(profile.days_per_week - plan.days_per_week)
        score += {0: 30, 1: 15}.get(day_diff, 0)
        if day_diff:
            reasons.append(f'{plan.days_per_week} dni treningowych w tygodniu')

        required = set(plan.required_equipment or [])
        available = set(profile.equipment or [])
        if not required or not available:
            score += 25 if not required else 12
        else:
            score += round(25 * len(required & available) / len(required))
            missing = required - available
            if missing:
                reasons.append('brak sprzętu: ' + ', '.join(sorted(missing)))

        if profile.goal == plan.goal:
            score += 15
        else:
            reasons.append(f'cel planu: {plan.get_goal_display().lower()}')

    restricted = user_restrictions(user)
    warnings = []
    if restricted:
        for item in plan.exercises.select_related('exercise').prefetch_related('exercise__stressed_areas'):
            conflict = [a for a in item.exercise.stressed_areas.all() if a.id in restricted]
            if conflict:
                warnings.append({
                    'plan_exercise_id': item.id,
                    'exercise_id': item.exercise_id,
                    'exercise_name': item.exercise.name,
                    'areas': [a.name for a in conflict],
                    'substitutes': substitutes_for(user, item.exercise, restricted),
                })
    return {'score': score, 'reasons': reasons, 'warnings': warnings}


def substitutes_for(user, exercise: Exercise, restricted: set[int] | None = None, limit: int = 3) -> list[dict]:
    """Zamienniki: ta sama grupa mięśni główna, brak kolizji z ograniczeniami,
    preferowany dostępny sprzęt (WF-15)."""
    restricted = user_restrictions(user) if restricted is None else restricted
    available = set(getattr(getattr(user, 'profile', None), 'equipment', []) or [])
    candidates = (Exercise.objects.filter(muscle_group=exercise.muscle_group)
                  .exclude(pk=exercise.pk)
                  .exclude(stressed_areas__in=restricted)
                  .distinct())
    ranked = sorted(candidates, key=lambda e: (e.equipment not in available, e.equipment != exercise.equipment, e.name))
    return [{'id': e.id, 'name': e.name, 'equipment': e.equipment} for e in ranked[:limit]]

# --- PODWÓJNA PROGRESJA -------------------------------------------------------

def recent_working_sets(user, exercise_ids, sessions: int = 2, days: int = 365) -> dict[int, list[tuple]]:
    """Serie robocze z ostatnich `sessions` treningów dla wielu ćwiczeń naraz.

    Zwraca {exercise_id: [(data, [serie]), ...]} od najnowszego treningu. Jedno zapytanie dla
    ostatniego roku; ćwiczenia bez treningu w tym okresie są doczytywane osobno (rzadki przypadek).
    """
    exercise_ids = set(exercise_ids)
    out: dict[int, list[tuple]] = {ex_id: [] for ex_id in exercise_ids}

    def collect(qs):
        for s in qs.select_related('session').order_by('-session__date_completed', '-session_id', 'set_number'):
            per_ex = out[s.exercise_id]
            if per_ex and per_ex[-1][0] == s.session_id:
                per_ex[-1][2].append(s)
            elif len(per_ex) < sessions:
                per_ex.append((s.session_id, s.session.date_completed, [s]))

    base = ExerciseSet.objects.filter(session__user=user, is_warmup=False)
    collect(base.filter(exercise_id__in=exercise_ids,
                        session__date_completed__gte=timezone.now() - timedelta(days=days)))
    missing = [ex_id for ex_id, found in out.items() if not found]
    for ex_id in missing:
        last_ids = list(WorkoutSession.objects.filter(user=user, sets__exercise_id=ex_id, sets__is_warmup=False)
                        .distinct().order_by('-date_completed').values_list('id', flat=True)[:sessions])
        if last_ids:
            collect(base.filter(exercise_id=ex_id, session_id__in=last_ids))
    return {ex_id: [(when, sets) for _, when, sets in found] for ex_id, found in out.items()}


def progression_suggestion(user, exercise_id: int, reps_min: int, reps_max: int | None = None,
                           target_rir: int | None = None, fallback_weight: float | None = None,
                           history: list[tuple] | None = None) -> dict:
    """Propozycja ciężaru na następny trening metodą podwójnej progresji.

    Ciężar roboczy zwiększa się dopiero, gdy we wszystkich seriach roboczych osiągnięto
    górną granicę zakresu powtórzeń, a (jeśli oceniano wysiłek) zapas powtórzeń nie był
    mniejszy od docelowego. Do tego czasu rośnie liczba powtórzeń przy tym samym ciężarze.
    Dwa kolejne treningi poniżej dolnej granicy zakresu skutkują odciążeniem o ok. 10%.
    `history` - wynik recent_working_sets() dla ćwiczenia (przy wielu ćwiczeniach naraz).
    """
    reps_max = reps_max or reps_min
    increment = getattr(getattr(user, 'profile', None), 'load_increment', 2.5) or 2.5
    if history is None:
        history = recent_working_sets(user, [exercise_id])[exercise_id]
    base = {'reps_min': reps_min, 'reps_max': reps_max, 'target_rir': target_rir}
    if not history:
        return {**base, 'action': 'start', 'weight': fallback_weight, 'based_on': None,
                'reason': 'Brak historii tego ćwiczenia - zacznij od ciężaru z planu.' if fallback_weight
                else 'Brak historii tego ćwiczenia - dobierz ciężar próbnie.'}

    last_date, last = history[0]
    weight = max(s.weight for s in last)
    top = [s for s in last if s.weight == weight]
    based_on = (f"{timezone.localtime(last_date):%d.%m}: "
                + ', '.join(f"{s.weight:g}×{s.reps}" + (f" RIR {s.rir}" if s.rir is not None else '') for s in last))
    rated = [s.rir for s in top if s.rir is not None]
    all_top = all(s.reps >= reps_max for s in top)
    below = sum(s.reps < reps_min for s in top) > len(top) / 2

    if all_top and (target_rir is None or not rated or min(rated) >= target_rir):
        return {**base, 'action': 'increase', 'weight': round(weight + increment, 2), 'based_on': based_on,
                'reason': f'We wszystkich seriach osiągnięto {reps_max} powt. - zwiększ ciężar o {increment:g} kg '
                          f'i wróć do dolnej granicy zakresu.'}
    if all_top:
        return {**base, 'action': 'keep', 'weight': weight, 'based_on': based_on,
                'reason': f'Zakres osiągnięty, ale bliżej upadku niż zakładane RIR {target_rir} - powtórz ciężar.'}
    if below:
        previous = history[1][1] if len(history) > 1 else []
        prev_top = [s for s in previous if s.weight == weight]
        if prev_top and sum(s.reps < reps_min for s in prev_top) > len(prev_top) / 2:
            return {**base, 'action': 'decrease', 'weight': round_down(weight * 0.9, increment), 'based_on': based_on,
                    'reason': f'Dwa treningi z rzędu poniżej {reps_min} powt. - odciąż ciężar o ok. 10%.'}
        return {**base, 'action': 'keep', 'weight': weight, 'based_on': based_on,
                'reason': f'Większość serii poniżej {reps_min} powt. - zostań przy tym ciężarze.'}
    return {**base, 'action': 'keep', 'weight': weight, 'based_on': based_on,
            'reason': f'Utrzymaj ciężar i spróbuj dołożyć powtórzenie, aż dojdziesz do {reps_max} w każdej serii.'}

# --- REALIZACJA PLANU W SESJI (WF-26) ---------------------------------------------------

def session_vs_plan(session: WorkoutSession) -> dict | None:
    """Porównanie wykonanego treningu z jednostką planu."""
    if not session.plan_day_id:
        return None
    done: dict[int, list] = {}
    for s in session.sets.all():
        if not s.is_warmup:
            done.setdefault(s.exercise_id, []).append(s)
    items, planned_total, done_total = [], 0, 0
    for pe in session.plan_day.exercises.select_related('exercise'):
        sets = done.pop(pe.exercise_id, [])
        reps_max = pe.target_reps_max or pe.target_reps
        hit = sum(1 for s in sets if s.reps >= pe.target_reps)
        planned_total += pe.target_sets
        done_total += min(len(sets), pe.target_sets)
        status = ('skipped' if not sets else
                  'done' if len(sets) >= pe.target_sets and hit >= pe.target_sets else 'partial')
        items.append({
            'exercise': pe.exercise.name, 'status': status,
            'planned': f"{pe.target_sets}×{pe.target_reps}" + (f"-{reps_max}" if reps_max != pe.target_reps else '')
                       + (f" @ {pe.calculated_weight:g} kg" if pe.calculated_weight else ''),
            'done': ', '.join(f"{s.weight:g}×{s.reps}" for s in sets) or '-',
            'sets_done': len(sets), 'sets_planned': pe.target_sets, 'sets_in_range': hit,
        })
    extra = [{'exercise': sets[0].exercise.name, 'status': 'added', 'planned': '-',
              'done': ', '.join(f"{s.weight:g}×{s.reps}" for s in sets), 'sets_done': len(sets),
              'sets_planned': 0, 'sets_in_range': 0} for sets in done.values()]
    return {'plan_day': session.plan_day.name,
            'completion_percent': round(100 * done_total / planned_total, 1) if planned_total else None,
            'items': items + extra}


def recalculate_plan(plan: WorkoutPlan, user) -> None:
    """Wylicza ciężary planu dla jego właściciela (np. po wykonaniu testu)."""
    scaled = {row['plan_exercise_id']: row for row in scale_plan_for(user, plan)}
    items = list(plan.exercises.all())
    for item in items:
        row = scaled.get(item.id)
        if row:
            item.calculated_weight = row['suggested_weight']
            item.needs_calibration = row['needs_calibration']
    PlanExercise.objects.bulk_update(items, ['calculated_weight', 'needs_calibration'])
