"""Szablony planów i generator planu dopasowanego do profilu użytkownika.

Główne boje mają obciążenie jako % 1RM (przeliczane na ciężar użytkownika), ćwiczenia
akcesoryjne - jako docelowe RPE z zakresem powtórzeń, więc nie wymagają znajomości 1RM.
Generator wybiera szablon według liczby dni, celu, poziomu i sprzętu, a następnie
podmienia ćwiczenia kolidujące z ograniczeniami zdrowotnymi lub niedostępnym sprzętem.
"""
from __future__ import annotations

from django.db import transaction

from .analytics import recalculate_plan, substitutes_for, user_restrictions
from .models import Exercise, PlanDay, PlanExercise, WorkoutPlan

# pozycja: (angielska nazwa ćwiczenia, serie, powt. od, powt. do, tryb obciążenia, wartość, docelowy RIR, przerwa [s])
TEMPLATES = {
    'fbw': {
        'title': 'FBW - całe ciało 3× w tygodniu',
        'description': 'Plan dla początkujących: dwie jednostki całego ciała (A i B) wykonywane naprzemiennie '
                       'trzy razy w tygodniu. Ciężary głównych ćwiczeń wynikają z 1RM, pozostałych - z RIR.',
        'goal': 'general', 'level': 'beginner', 'days_per_week': 3, 'duration_weeks': 8,
        'equipment': ['barbell', 'dumbbell', 'cable', 'machine'],
        'days': [
            ('Trening A', [
                ('Back squat', 3, 6, 8, 'percent', 70, 2, 150),
                ('Barbell bench press', 3, 6, 8, 'percent', 70, 2, 150),
                ('Lat pulldown', 3, 8, 12, 'rpe', 8, 2, 90),
                ('Romanian deadlift', 3, 8, 10, 'rpe', 7, 3, 120),
                ('Lateral raise', 2, 12, 15, 'rpe', 8, 2, 60),
                ('Cable crunch', 3, 12, 15, 'rpe', 8, 2, 60),
            ]),
            ('Trening B', [
                ('Deadlift', 3, 5, 6, 'percent', 70, 3, 180),
                ('Seated overhead dumbbell press', 3, 8, 10, 'rpe', 8, 2, 120),
                ('Cable row', 3, 8, 12, 'rpe', 8, 2, 90),
                ('Leg press', 3, 10, 12, 'rpe', 8, 2, 120),
                ('Dumbbell supinated biceps curls', 2, 10, 12, 'rpe', 8, 2, 60),
                ('Cable rope triceps extension', 2, 10, 12, 'rpe', 8, 2, 60),
            ]),
        ],
    },
    'upper_lower': {
        'title': 'Góra / dół 4× w tygodniu',
        'description': 'Cztery jednostki: dwie na górę i dwie na dół ciała, jedna z akcentem siłowym, druga '
                       'objętościowym. Dobry wybór dla osób średniozaawansowanych.',
        'goal': 'hypertrophy', 'level': 'intermediate', 'days_per_week': 4, 'duration_weeks': 8,
        'equipment': ['barbell', 'dumbbell', 'cable', 'machine'],
        'days': [
            ('Góra - siła', [
                ('Barbell bench press', 4, 4, 6, 'percent', 80, 2, 180),
                ('Bent over barbell row', 4, 6, 8, 'percent', 75, 2, 150),
                ('Military press', 3, 6, 8, 'percent', 72.5, 2, 150),
                ('Lat pulldown', 3, 8, 10, 'rpe', 8, 2, 90),
                ('Skull crusher', 3, 8, 10, 'rpe', 8, 2, 90),
                ('Barbell biceps curl', 3, 8, 10, 'rpe', 8, 2, 90),
            ]),
            ('Dół - siła', [
                ('Back squat', 4, 4, 6, 'percent', 80, 2, 180),
                ('Romanian deadlift', 3, 6, 8, 'percent', 70, 2, 150),
                ('Leg press', 3, 8, 10, 'rpe', 8, 2, 120),
                ('Lying leg curl machine', 3, 8, 12, 'rpe', 8, 2, 90),
                ('Standing calf raise machine', 4, 8, 12, 'rpe', 8, 1, 60),
            ]),
            ('Góra - objętość', [
                ('Incline dumbbell bench press', 3, 8, 12, 'rpe', 8, 2, 120),
                ('Cable row', 3, 10, 12, 'rpe', 8, 2, 90),
                ('Seated overhead dumbbell press', 3, 10, 12, 'rpe', 8, 2, 90),
                ('Pec dec fly', 3, 12, 15, 'rpe', 8, 1, 60),
                ('Lateral raise', 4, 12, 15, 'rpe', 8, 1, 60),
                ('Face pull', 3, 12, 15, 'rpe', 8, 2, 60),
                ('Hammer curl', 3, 10, 12, 'rpe', 8, 1, 60),
                ('Cable rope triceps extension', 3, 10, 12, 'rpe', 8, 1, 60),
            ]),
            ('Dół - objętość', [
                ('Hack squat', 3, 8, 12, 'rpe', 8, 2, 120),
                ('Barbell hip thrust', 3, 8, 12, 'rpe', 8, 2, 120),
                ('Bulgarian split squat with dumbbells – quad version', 3, 10, 12, 'rpe', 8, 2, 90),
                ('Seated leg curl', 3, 10, 15, 'rpe', 8, 1, 90),
                ('Leg extensions', 3, 12, 15, 'rpe', 8, 1, 60),
                ('Cable crunch', 3, 12, 15, 'rpe', 8, 2, 60),
            ]),
        ],
    },
    'ppl': {
        'title': 'Push / Pull / Legs',
        'description': 'Podział na ruchy pchające, przyciągające i nogi. Trzy dni w tygodniu albo sześć, '
                       'jeśli cykl jest powtarzany dwukrotnie.',
        'goal': 'hypertrophy', 'level': 'intermediate', 'days_per_week': 3, 'duration_weeks': 8,
        'equipment': ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
        'days': [
            ('Push - klatka, barki, triceps', [
                ('Barbell bench press', 4, 6, 8, 'percent', 75, 2, 180),
                ('Incline dumbbell bench press', 3, 8, 10, 'rpe', 8, 2, 120),
                ('Seated overhead dumbbell press', 3, 8, 10, 'rpe', 8, 2, 120),
                ('Pec dec fly', 3, 12, 15, 'rpe', 8, 1, 60),
                ('Lateral raise', 4, 12, 15, 'rpe', 8, 1, 60),
                ('Cable bar triceps extension', 3, 10, 12, 'rpe', 8, 1, 60),
            ]),
            ('Pull - plecy, biceps', [
                ('Pull ups', 4, 6, 10, 'rpe', 8, 2, 120),
                ('Bent over barbell row', 3, 6, 8, 'percent', 75, 2, 150),
                ('Cable row', 3, 10, 12, 'rpe', 8, 2, 90),
                ('Face pull', 3, 12, 15, 'rpe', 8, 2, 60),
                ('Barbell biceps curl', 3, 8, 10, 'rpe', 8, 1, 90),
                ('Hammer curl', 2, 10, 12, 'rpe', 8, 1, 60),
            ]),
            ('Legs - nogi, brzuch', [
                ('Back squat', 4, 5, 8, 'percent', 75, 2, 180),
                ('Romanian deadlift', 3, 8, 10, 'percent', 65, 2, 150),
                ('Leg press', 3, 10, 12, 'rpe', 8, 2, 120),
                ('Lying leg curl machine', 3, 10, 12, 'rpe', 8, 1, 90),
                ('Standing calf raise machine', 4, 10, 15, 'rpe', 8, 1, 60),
                ('Hanging leg raise', 3, 10, 15, 'rpe', 8, 2, 60),
            ]),
        ],
    },
    'strength_5x5': {
        'title': 'Siła 5×5',
        'description': 'Klasyczny plan siłowy: dwie jednostki (A i B) na zmianę trzy razy w tygodniu, '
                       'ciężkie boje wielostawowe po 5 serii po 5 powtórzeń.',
        'goal': 'strength', 'level': 'beginner', 'days_per_week': 3, 'duration_weeks': 12,
        'equipment': ['barbell', 'bodyweight'],
        'days': [
            ('Trening A', [
                ('Back squat', 5, 5, 5, 'percent', 80, 2, 180),
                ('Barbell bench press', 5, 5, 5, 'percent', 80, 2, 180),
                ('Bent over barbell row', 5, 5, 5, 'percent', 77.5, 2, 150),
                ('Hanging leg raise', 3, 10, 12, 'rpe', 8, 2, 60),
            ]),
            ('Trening B', [
                ('Back squat', 5, 5, 5, 'percent', 80, 2, 180),
                ('Military press', 5, 5, 5, 'percent', 80, 2, 180),
                ('Deadlift', 1, 5, 5, 'percent', 82.5, 1, 240),
                ('Chin ups', 3, 6, 10, 'rpe', 8, 2, 120),
            ]),
        ],
    },
    'home': {
        'title': 'Trening w domu - hantle i masa ciała',
        'description': 'Plan wymagający jedynie pary hantli i drążka, dwie jednostki na zmianę 3× w tygodniu.',
        'goal': 'general', 'level': 'beginner', 'days_per_week': 3, 'duration_weeks': 8,
        'equipment': ['dumbbell', 'bodyweight'],
        'days': [
            ('Trening A', [
                ('Goblet squat', 3, 10, 15, 'rpe', 8, 2, 90),
                ('Push ups', 3, 8, 15, 'rpe', 8, 2, 90),
                ('Dumbbell row – hand supported on bench', 3, 10, 12, 'rpe', 8, 2, 90),
                ('Dumbbell RDL', 3, 10, 12, 'rpe', 8, 2, 90),
                ('Lateral raise', 3, 12, 15, 'rpe', 8, 1, 60),
                ('Reverse crunch', 3, 12, 15, 'rpe', 8, 2, 60),
            ]),
            ('Trening B', [
                ('Bulgarian split squat with dumbbells – quad version', 3, 8, 12, 'rpe', 8, 2, 90),
                ('Pull ups', 3, 5, 10, 'rpe', 8, 2, 120),
                ('Overhead dumbbell press', 3, 8, 12, 'rpe', 8, 2, 90),
                ('Hip thrust with dumbbell', 3, 12, 15, 'rpe', 8, 2, 90),
                ('Hammer curl', 3, 10, 12, 'rpe', 8, 1, 60),
                ('Bench dips', 3, 10, 15, 'rpe', 8, 2, 60),
            ]),
        ],
    },
}


def find_exercise(english: str) -> Exercise | None:
    return (Exercise.objects.filter(name__iendswith=f' / {english}', created_by__isnull=True).first()
            or Exercise.objects.filter(name__iexact=f'{english} / {english}', created_by__isnull=True).first())


def template_list() -> list[dict]:
    return [{'key': key, 'title': t['title'], 'description': t['description'], 'goal': t['goal'],
             'level': t['level'], 'days_per_week': t['days_per_week'], 'duration_weeks': t['duration_weeks'],
             'equipment': t['equipment'], 'days': [{'name': name, 'exercises': len(items)} for name, items in t['days']]}
            for key, t in TEMPLATES.items()]


def choose_template(user) -> tuple[str, str]:
    """Wybór szablonu na podstawie profilu; zwraca klucz i uzasadnienie."""
    profile = getattr(user, 'profile', None)
    equipment = set(profile.equipment or []) if profile else set()
    days = profile.days_per_week if profile else 3
    if equipment and not equipment & {'barbell', 'machine', 'cable'}:
        return 'home', 'Brak sztangi, maszyn i wyciągów w dostępnym sprzęcie - plan domowy.'
    if profile and profile.goal == 'strength':
        return 'strength_5x5', 'Cel: siła - plan oparty na ciężkich bojach wielostawowych.'
    if days >= 4 and profile and profile.level != 'beginner':
        return 'upper_lower', f'{days} dni w tygodniu i poziom co najmniej średni - podział góra/dół.'
    if days >= 5:
        return 'ppl', f'{days} dni w tygodniu - podział push/pull/legs (cykl powtarzany w tygodniu).'
    return 'fbw', 'Trening całego ciała - najlepszy przy 2-3 dniach w tygodniu i na początek.'


def adapt_exercise(user, exercise: Exercise, restricted: set[int],
                   available: set[str]) -> tuple[Exercise | None, str | None]:
    """Dopasowuje ćwiczenie do ograniczeń zdrowotnych i sprzętu.

    Zdrowie ma pierwszeństwo przed sprzętem: przy kolizji zdrowotnej wybierany jest zamiennik
    na dostępny sprzęt, a gdy takiego nie ma - na inny sprzęt; jeśli nie istnieje żaden
    bezpieczny zamiennik, ćwiczenie jest pomijane (zwracane None).
    """

    def fits(equipment):
        return not available or equipment in available or equipment == 'bodyweight'

    conflict = bool(set(exercise.stressed_areas.values_list('id', flat=True)) & restricted)
    no_equipment = not fits(exercise.equipment)
    if not conflict and not no_equipment:
        return exercise, None
    candidates = substitutes_for(user, exercise, restricted, limit=50)
    for c in candidates:
        if fits(c['equipment']):
            return Exercise.objects.get(pk=c['id']), 'ograniczenie zdrowotne' if conflict else 'brak sprzętu'
    if conflict:
        if candidates:
            return (Exercise.objects.get(pk=candidates[0]['id']),
                    'ograniczenie zdrowotne; zamiennik wymaga innego sprzętu')
        return None, 'ograniczenie zdrowotne; brak bezpiecznego zamiennika - ćwiczenie pominięto'
    return exercise, None  # brak sprzętu i brak zamiennika - zostaje, użytkownik zdecyduje


@transaction.atomic
def create_from_template(user, key: str, adapt: bool = True) -> tuple[WorkoutPlan, list[dict]]:

    template = TEMPLATES[key]
    profile = getattr(user, 'profile', None)
    restricted = user_restrictions(user) if adapt else set()
    available = set(profile.equipment or []) if adapt and profile else set()
    days_per_week = template['days_per_week']
    if key == 'ppl' and profile and profile.days_per_week >= 6:
        days_per_week = 6
    plan = WorkoutPlan.objects.create(
        title=template['title'], creator=user, description=template['description'], goal=template['goal'],
        level=template['level'], days_per_week=days_per_week, duration_weeks=template['duration_weeks'],
        required_equipment=template['equipment'])
    changes = []
    for d_index, (day_name, items) in enumerate(template['days']):
        day = PlanDay.objects.create(plan=plan, week=1, order=d_index, name=day_name)
        for i, (english, sets, reps_min, reps_max, load_type, value, rir, rest) in enumerate(items):
            exercise = find_exercise(english)
            if exercise is None:
                continue
            chosen, reason = adapt_exercise(user, exercise, restricted, available)
            if reason:
                changes.append({'day': day_name, 'from': exercise.name,
                                'to': chosen.name if chosen else '(pominięte)', 'reason': reason})
            if chosen is None:
                continue
            if chosen.pk != exercise.pk and load_type == 'percent':
                # %1RM dotyczył ćwiczenia z szablonu - zamiennik prowadzimy według RPE
                load_type, value = 'rpe', 10 - rir
            PlanExercise.objects.create(
                plan=plan, day=day, exercise=chosen, order=i, target_sets=sets, target_reps=reps_min,
                target_reps_max=reps_max if reps_max != reps_min else None, target_rir=rir,
                load_type=load_type, load_value=value, rest_seconds=rest)
    plan.required_equipment = sorted(set(plan.exercises.values_list('exercise__equipment', flat=True)))
    plan.save(update_fields=['required_equipment'])
    recalculate_plan(plan, user)
    return plan, changes
