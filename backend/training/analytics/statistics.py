"""Statystyki: objętość, progresja i prognoza, RIR, rekordy powtórzeniowe, obciążenie, cele."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
from django.utils import timezone

from ..models import (
    BodyMeasurement,
    ExerciseSet,
    WorkoutSession,
)
from .core import current_1rm, records_map, round_down, sets_dataframe

# --- STATYSTYKI (WF-31 - WF-33) ---------------------------------------------

def weekly_tonnage(user, weeks: int = 12) -> list[dict]:
    df = sets_dataframe(user, days=weeks * 7)
    if df.empty:
        return []
    grouped = df.set_index('date').resample('W-MON')['tonnage'].sum().reset_index()
    return [{'week': r['date'].strftime('%d.%m'), 'tonnage': int(r['tonnage'])}
            for _, r in grouped.iterrows()]


def monthly_tonnage(user, months: int = 6) -> list[dict]:
    df = sets_dataframe(user, days=months * 31)
    if df.empty:
        return []
    grouped = df.set_index('date').resample('MS')['tonnage'].sum().reset_index()
    return [{'month': r['date'].strftime('%m.%Y'), 'tonnage': int(r['tonnage'])}
            for _, r in grouped.iterrows()]


def exercise_progression(user, exercise_id: int, weeks: int = 12) -> list[dict]:
    df = sets_dataframe(user, days=weeks * 7)
    df = df[df['exercise_id'] == exercise_id]
    if df.empty:
        return []
    grouped = (df.set_index('date').resample('W-MON')
               .agg(e1rm=('e1rm', 'max'), top_weight=('weight', 'max'))
               .dropna(subset=['top_weight']).reset_index())
    return [{'week': r['date'].strftime('%d.%m'), 'date': r['date'].date().isoformat(),
             'weight': round(float(r['top_weight']), 1),
             'e1rm': None if pd.isna(r['e1rm']) else round(float(r['e1rm']), 1)}
            for _, r in grouped.iterrows()]


def linear_trend(user, exercise_id: int) -> tuple[float, float, float, date] | None:
    """Regresja liniowa tygodniowych maksimów szacowanego 1RM z 26 tygodni.
    Zwraca (nachylenie [kg/tydz.], wyraz wolny, x ostatniego punktu, data ostatniego punktu)
    albo None przy danych z mniej niż 3 tygodni. Wspólna dla prognozy (WF-33) i celów (WF-42)."""
    points = [p for p in exercise_progression(user, exercise_id, weeks=26) if p['e1rm']]
    if len(points) < 3:
        return None
    first = date.fromisoformat(points[0]['date'])
    x = np.array([(date.fromisoformat(p['date']) - first).days / 7 for p in points])
    slope, intercept = np.polyfit(x, np.array([p['e1rm'] for p in points]), 1)
    return float(slope), float(intercept), float(x[-1]), date.fromisoformat(points[-1]['date'])


def predict_1rm(user, exercise_id: int, weeks_ahead: int = 4) -> list[dict]:
    """Prognoza 1RM na kolejne tygodnie (WF-33)."""
    trend = linear_trend(user, exercise_id)
    if trend is None:
        return []
    slope, intercept, x_last, last_date = trend
    return [{'week': (last_date + timedelta(weeks=k)).strftime('%d.%m'),
             'predicted': round(intercept + slope * (x_last + k), 1)}
            for k in range(1, weeks_ahead + 1)]


def muscle_group_split(user, weeks: int = 4) -> list[dict]:
    df = sets_dataframe(user, days=weeks * 7)
    if df.empty:
        return []
    grouped = df.groupby('muscle_group')['tonnage'].sum().sort_values(ascending=False)
    total = float(grouped.sum()) or 1.0
    return [{'group': g, 'tonnage': int(t), 'percent': round(100 * t / total, 1)}
            for g, t in grouped.items()]


def personal_records(user) -> list[dict]:
    df = sets_dataframe(user)
    if df.empty:
        return []
    grouped = (df.groupby(['exercise_id', 'exercise'])
               .agg(e1rm=('e1rm', 'max'), weight=('weight', 'max'), sets=('weight', 'count'))
               .reset_index())
    known = records_map(user)
    out = []
    for _, r in grouped.iterrows():
        # rekord z bazy (test/wpis/estymacja); bez niego - najlepsza estymacja z serii w DataFrame
        estimate = 0.0 if pd.isna(r['e1rm']) else round(float(r['e1rm']), 1)
        value, source = known.get(int(r['exercise_id']), (estimate, 'estimate' if estimate else 'none'))
        out.append({'exercise_id': int(r['exercise_id']), 'exercise': r['exercise'],
                    'e1rm': round(value, 1), 'source': source,
                    'best_weight': round(float(r['weight']), 1), 'total_sets': int(r['sets'])})
    return sorted(out, key=lambda r: r['e1rm'], reverse=True)


def measurement_series(user) -> list[dict]:
    qs = BodyMeasurement.objects.filter(user=user).order_by('measured_at')
    return [{'date': m.measured_at.strftime('%d.%m.%Y'), 'body_weight': m.body_weight,
             'waist': m.waist, 'chest': m.chest, 'arm': m.arm, 'thigh': m.thigh,
             'hips': m.hips, 'resting_hr': m.resting_hr} for m in qs]


def relative_strength(user, exercise_id: int) -> float | None:
    """Siła względna: 1RM / masa ciała (WF-32)."""
    value, _ = current_1rm(user, exercise_id)
    last = BodyMeasurement.objects.filter(user=user, body_weight__isnull=False).order_by('-measured_at').first()
    if not value or not last:
        return None
    return round(value / last.body_weight, 2)


def smart_suggestion(user) -> dict | None:
    df = sets_dataframe(user, days=60)
    if df.empty:
        return None
    last = df.sort_values('date').iloc[-1]
    best, _ = current_1rm(user, int(last['exercise_id']))
    if not best:
        return None
    return {'exercise': last['exercise'], 'weight': round_down(best * 0.8),
            'oneRm': round(best, 1), 'basedOn': f'{round(best, 1)} kg (1RM)'}


# --- BLISKOŚĆ UPADKU (RIR) ----------------------------------------------------

RIR_BUCKETS = ['0', '1', '2', '3', '4', '5+']


def _effort_summary(df: pd.DataFrame) -> dict:
    rated = df.dropna(subset=['rir'])
    return {
        'total_sets': len(df),
        'rated_sets': len(rated),
        'avg_rir': round(float(rated['rir'].mean()), 1) if len(rated) else None,
        'to_failure_percent': round(100 * float((rated['rir'] == 0).mean()), 1) if len(rated) else None,
    }


def effort_stats(user, weeks: int = 12) -> dict:
    """Jak blisko upadku mięśniowego wykonywane są serie robocze."""
    df = sets_dataframe(user, days=weeks * 7)
    out = _effort_summary(df) if not df.empty else _effort_summary(pd.DataFrame(columns=['rir']))
    out.update({'distribution': [], 'weekly': [], 'by_exercise': []})
    if df.empty or out['rated_sets'] == 0:
        return out
    rated = df.dropna(subset=['rir']).copy()
    rated['bucket'] = rated['rir'].clip(upper=5).astype(int).astype(str).replace('5', '5+')
    counts = rated['bucket'].value_counts()
    out['distribution'] = [{'rir': b, 'sets': int(counts.get(b, 0)),
                            'percent': round(100 * counts.get(b, 0) / len(rated), 1)} for b in RIR_BUCKETS]
    weekly = rated.set_index('date').resample('W-MON')['rir'].agg(['mean', 'count']).dropna().reset_index()
    out['weekly'] = [{'week': r['date'].strftime('%d.%m'), 'avg_rir': round(float(r['mean']), 1),
                      'sets': int(r['count'])} for _, r in weekly.iterrows()]
    by_ex = (rated.groupby('exercise')['rir'].agg(['mean', 'count'])
             .sort_values('count', ascending=False).head(6).reset_index())
    out['by_exercise'] = [{'exercise': r['exercise'], 'avg_rir': round(float(r['mean']), 1),
                           'sets': int(r['count'])} for _, r in by_ex.iterrows()]
    return out

# --- REKORDY POWTÓRZENIOWE ----------------------------------------------------

MAX_REP_RECORD = 12


def rep_records(user, exercise_id: int, before=None, exclude_session_id=None) -> dict[int, dict]:
    """Najcięższy ciężar podniesiony na co najmniej N powtórzeń (N = 1..12)."""
    qs = ExerciseSet.objects.filter(session__user=user, exercise_id=exercise_id, is_warmup=False, weight__gt=0)
    if before is not None:
        qs = qs.filter(session__date_completed__lt=before)
    if exclude_session_id is not None:
        qs = qs.exclude(session_id=exclude_session_id)
    return best_by_reps(qs.values_list('weight', 'reps', 'session__date_completed'))


def best_by_reps(rows) -> dict[int, dict]:
    """Z par (ciężar, powtórzenia, data): najcięższy ciężar dla każdego N = 1..12 powtórzeń."""
    best: dict[int, dict] = {}
    for weight, reps, when in rows:
        for n in range(1, min(reps, MAX_REP_RECORD) + 1):
            if n not in best or weight > best[n]['weight']:
                best[n] = {'weight': weight, 'date': when}
    return best


def detect_rep_records(session: WorkoutSession) -> list[dict]:
    """Rekordy powtórzeniowe pobite w sesji (w porównaniu z wcześniejszymi treningami)."""
    found = {}
    by_exercise: dict[int, list] = {}
    for s in session.sets.select_related('exercise'):
        if not s.is_warmup and s.weight > 0 and s.reps <= MAX_REP_RECORD:
            by_exercise.setdefault(s.exercise_id, []).append(s)
    for exercise_id, sets in by_exercise.items():
        previous = rep_records(session.user, exercise_id, before=session.date_completed,
                               exclude_session_id=session.id)
        if not previous:
            continue  # pierwszy trening ćwiczenia - brak punktu odniesienia
        for s in sets:
            prev = previous.get(s.reps)
            if prev is None or s.weight > prev['weight']:
                key = (exercise_id, s.reps)
                if key not in found or s.weight > found[key]['weight']:
                    found[key] = {'exercise_id': exercise_id, 'exercise': s.exercise.name, 'reps': s.reps,
                                  'weight': s.weight, 'previous': prev['weight'] if prev else None}
    return drop_dominated(sorted(found.values(), key=lambda r: (r['exercise'], r['reps'])))


def drop_dominated(records: list[dict]) -> list[dict]:
    """Usuwa rekordy "przykryte" przez lepszy w tym samym ćwiczeniu: 100 kg × 8 obejmuje
    także 100 kg × 7 i 100 kg × 6 (ten sam ciężar na więcej powtórzeń)."""
    return [r for r in records if not any(
        o is not r and o['exercise_id'] == r['exercise_id'] and o['reps'] >= r['reps'] and o['weight'] >= r['weight']
        and (o['reps'], o['weight']) != (r['reps'], r['weight']) for o in records)]


# --- OBCIĄŻENIE TRENINGOWE I REGULARNOŚĆ -----------------------------------------

def training_load(user) -> dict:
    """ACWR (stosunek obciążenia ostrego do przewlekłego), seria tygodni z treningiem, kalendarz."""
    now = timezone.now()
    df = sets_dataframe(user, days=182)
    acute = float(df[df['date'] >= now - timedelta(days=7)]['tonnage'].sum()) if not df.empty else 0.0
    chronic_total = float(df[df['date'] >= now - timedelta(days=28)]['tonnage'].sum()) if not df.empty else 0.0
    chronic = chronic_total / 4
    # Obciążenie przewlekłe ma sens dopiero przy ok. 3-4 tygodniach historii - wcześniej ACWR
    # wychodzi sztucznie wysoki (pierwszy tydzień dzielony przez 4) i straszyłby nowego użytkownika.
    enough_history = not df.empty and bool((df['date'] < now - timedelta(days=21)).any())
    acwr = round(acute / chronic, 2) if chronic > 0 and enough_history else None
    if acwr is None:
        zone, zone_text = None, 'Za mało danych - wskaźnik pojawi się po ok. 3-4 tygodniach treningów.'
    elif acwr < 0.8:
        zone, zone_text = 'low', 'Obciążenie niższe niż zwykle (np. roztrenowanie lub przerwa).'
    elif acwr <= 1.3:
        zone, zone_text = 'optimal', 'Obciążenie zgodne z Twoim zwykłym poziomem.'
    elif acwr <= 1.5:
        zone, zone_text = 'elevated', 'Obciążenie wyraźnie wyższe niż zwykle.'
    else:
        zone, zone_text = 'high', 'Gwałtowny wzrost obciążenia - rozważ lżejszy tydzień.'

    sessions = list(WorkoutSession.objects.filter(user=user, date_completed__gte=now - timedelta(days=371))
                    .values_list('date_completed', flat=True))
    local_dates = [timezone.localtime(d).date() for d in sessions]
    weeks = {d - timedelta(days=d.weekday()) for d in local_dates}
    today = timezone.localdate()
    week = today - timedelta(days=today.weekday())
    if week not in weeks:
        week -= timedelta(weeks=1)  # bieżący tydzień jeszcze trwa - nie przerywa serii
    streak = 0
    while week in weeks:
        streak += 1
        week -= timedelta(weeks=1)

    per_day: dict = {}
    if not df.empty:
        local_day = df['date'].dt.tz_convert(timezone.get_current_timezone()).dt.date
        for day, tonnage in df.groupby(local_day)['tonnage'].sum().items():
            per_day[day] = {'tonnage': int(tonnage)}
    for d in local_dates:
        per_day.setdefault(d, {'tonnage': 0})
        per_day[d]['sessions'] = per_day[d].get('sessions', 0) + 1
    start = today - timedelta(days=181)
    calendar = [{'date': d.isoformat(), 'sessions': v.get('sessions', 0), 'tonnage': v['tonnage']}
                for d, v in sorted(per_day.items()) if d >= start]

    target = getattr(getattr(user, 'profile', None), 'days_per_week', None)
    last4 = sum(1 for d in local_dates if d > today - timedelta(days=28))
    return {'acute_tonnage': int(acute), 'chronic_weekly_tonnage': int(chronic), 'acwr': acwr,
            'zone': zone, 'zone_text': zone_text, 'streak_weeks': streak,
            'sessions_per_week_4w': round(last4 / 4, 1), 'target_per_week': target, 'calendar': calendar}


# --- CELE SIŁOWE -------------------------------------------------------------------

def goal_status(goal) -> dict:
    current, source = current_1rm(goal.user, goal.exercise_id)
    span = goal.target_1rm - goal.start_1rm
    progress = 100.0 if current >= goal.target_1rm else (
        max(0.0, min(100.0, 100 * (current - goal.start_1rm) / span)) if span > 0 else 0.0)
    if current >= goal.target_1rm and goal.achieved_at is None:
        goal.achieved_at = timezone.now()
        goal.save(update_fields=['achieved_at'])
    trend = linear_trend(goal.user, goal.exercise_id)
    slope = trend[0] if trend else None
    predicted, message = None, None
    if goal.achieved_at:
        message = 'Cel osiągnięty.'
    elif slope is None:
        message = 'Za mało danych do prognozy (potrzebne treningi z co najmniej 3 tygodni).'
    elif slope <= 0.05:
        message = 'Brak trendu wzrostowego - przy obecnym tempie cel nie zostanie osiągnięty.'
    else:
        weeks_needed = (goal.target_1rm - current) / slope
        predicted = (timezone.localdate() + timedelta(weeks=weeks_needed)).isoformat()
        message = f'Przy obecnym tempie (+{slope:.1f} kg/tydz.) cel zostanie osiągnięty ok. {predicted}.'
    on_track = None
    if predicted and goal.deadline:
        on_track = date.fromisoformat(predicted) <= goal.deadline
    return {'current_1rm': current, 'source': source, 'progress_percent': round(progress, 1),
            'weekly_trend': round(slope, 2) if slope is not None else None,
            'predicted_date': predicted, 'on_track': on_track, 'message': message}
