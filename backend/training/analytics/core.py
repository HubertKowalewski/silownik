"""Obliczenia podstawowe: DataFrame serii, estymacja i wyznaczanie 1RM (WF-27, WF-30)."""
from __future__ import annotations

import math
from datetime import timedelta

import numpy as np
import pandas as pd
from django.utils import timezone

from ..models import (
    Exercise,
    ExerciseSet,
    PersonalRecord,
    StrengthTest,
    WorkoutSession,
)

MAX_REPS_FOR_ESTIMATE = 10  # powyżej tej liczby powtórzeń estymacja jest pomijana
MAX_RIR_FOR_ESTIMATE = 4    # serie dalej od upadku są oceniane zbyt niepewnie, by liczyć z nich 1RM

# --- OBLICZENIA PODSTAWOWE -------------------------------------------------

def epley_1rm(weight: float, reps: int) -> float:
    """Szacowane 1RM wzorem Epleya: w * (1 + r / 30)."""
    if reps <= 0 or weight <= 0:
        return 0.0
    if reps == 1:
        return float(weight)
    return float(weight) * (1 + reps / 30.0)


def set_1rm(weight: float, reps: int, rir: int | None = None) -> float | None:
    """Szacowane 1RM z serii z uwzględnieniem RIR.

    Seria wykonana z zapasem RIR powtórzeń odpowiada serii do upadku z liczbą powtórzeń
    r + RIR, dlatego do wzoru Epleya podstawiana jest ta suma. Brak oceny RIR oznacza
    założenie serii do upadku (RIR = 0). Zwraca None dla serii nienadających się do estymacji.
    """
    if weight <= 0 or reps <= 0 or reps > MAX_REPS_FOR_ESTIMATE:
        return None
    if rir is not None and rir > MAX_RIR_FOR_ESTIMATE:
        return None
    return epley_1rm(weight, reps + (rir or 0))


def round_down(value: float, increment: float = 2.5) -> float:
    """Zaokrąglenie w dół do najmniejszego przyrostu obciążenia (wzór z rozdz. 2.2)."""
    if value is None or value <= 0:
        return 0.0
    increment = increment or 2.5
    return round(increment * math.floor(value / increment + 1e-9), 2)


def sets_dataframe(user, days: int | None = None, date_from=None, date_to=None) -> pd.DataFrame:
    """Wszystkie serie robocze użytkownika jako DataFrame (bez serii rozgrzewkowych)."""
    qs = ExerciseSet.objects.filter(session__user=user, is_warmup=False)
    if days:
        qs = qs.filter(session__date_completed__gte=timezone.now() - timedelta(days=days))
    if date_from:
        qs = qs.filter(session__date_completed__gte=date_from)
    if date_to:
        qs = qs.filter(session__date_completed__lte=date_to)

    columns = ['date', 'session_id', 'exercise_id', 'exercise', 'muscle_group',
               'weight', 'reps', 'rpe', 'rir', 'tonnage', 'e1rm']
    # values_list zamiast obiektów modelu - jedno lekkie zapytanie z JOIN-em, bez tworzenia instancji
    rows = list(qs.values_list('session__date_completed', 'session_id', 'exercise_id', 'exercise__name',
                               'exercise__muscle_group', 'weight', 'reps', 'rpe', 'rir'))
    if not rows:
        return pd.DataFrame(columns=columns)

    df = pd.DataFrame(rows, columns=columns[:9])
    df = df.astype({'weight': float, 'reps': int, 'rpe': float, 'rir': float})
    df['date'] = pd.to_datetime(df['date'], utc=True)
    df['tonnage'] = df['weight'] * df['reps']
    # estymacja: serie do 10 powtórzeń i RIR <= 4; do powtórzeń doliczany jest RIR (WF-30)
    effective = df['reps'] + df['rir'].fillna(0)
    valid = ((df['weight'] > 0) & (df['reps'] <= MAX_REPS_FOR_ESTIMATE)
             & (df['rir'].isna() | (df['rir'] <= MAX_RIR_FOR_ESTIMATE)))
    df['e1rm'] = np.where(valid, df['weight'] * (1 + effective / 30.0).where(effective > 1, 1.0), np.nan)
    return df


# --- 1RM ---------------------------------------------------------------------

def brzycki_1rm(weight: float, reps: int) -> float:
    """Wzór Brzyckiego: w * 36 / (37 - r)."""
    if reps <= 0 or weight <= 0 or reps >= 37:
        return 0.0
    return float(weight) * 36 / (37 - reps)


def lombardi_1rm(weight: float, reps: int) -> float:
    """Wzór Lombardiego: w * r^0,1."""
    if reps <= 0 or weight <= 0:
        return 0.0
    return float(weight) * reps ** 0.1


def one_rep_max_formulas(weight: float, reps: int) -> dict:
    """Porównanie wzorów - wykorzystywane w kalkulatorze 1RM."""
    values = {'epley': epley_1rm(weight, reps), 'brzycki': brzycki_1rm(weight, reps),
              'lombardi': lombardi_1rm(weight, reps)}
    valid = [v for v in values.values() if v > 0]
    values['average'] = sum(valid) / len(valid) if valid else 0.0
    return {k: round(v, 1) for k, v in values.items()}


def estimate_1rm_for(user, exercise_id: int, since=None) -> float:
    """Najlepsze szacowane 1RM z serii roboczych do 10 powtórzeń (opcjonalnie od daty)."""
    qs = ExerciseSet.objects.filter(session__user=user, exercise_id=exercise_id, is_warmup=False,
                                    reps__lte=MAX_REPS_FOR_ESTIMATE, weight__gt=0)
    if since is not None:
        qs = qs.filter(session__date_completed__gte=since)
    estimates = (set_1rm(w, r, rir) for w, r, rir in qs.values_list('weight', 'reps', 'rir'))
    best = max((e for e in estimates if e), default=0.0)
    return round(best, 1)


def records_map(user) -> dict[int, tuple[float, str]]:
    """Aktualne 1RM wszystkich ćwiczeń użytkownika jednym zapytaniem: {exercise_id: (1RM, źródło)}."""
    return {ex_id: (value, source) for ex_id, value, source in
            PersonalRecord.objects.filter(user=user, best_1rm__gt=0).values_list('exercise_id', 'best_1rm', 'source')}


def current_1rm(user, exercise_id: int) -> tuple[float, str]:
    """Aktualne 1RM i jego źródło ('test', 'manual', 'estimate' lub 'none')."""
    record = PersonalRecord.objects.filter(user=user, exercise_id=exercise_id).first()
    if record and record.best_1rm > 0:
        return record.best_1rm, record.source
    estimate = estimate_1rm_for(user, exercise_id)
    return (estimate, 'estimate') if estimate > 0 else (0.0, 'none')


def recompute_record(user, exercise_id: int) -> PersonalRecord | None:
    """Wyznacza aktualne 1RM od zera (rozdz. 3.4.1).

    Punktem odniesienia jest najnowszy wynik testu lub wpis ręczny. Treningi
    wykonane po nim mogą go podnieść, ale starsze serie już nie - test
    "resetuje" poziom odniesienia. Bez testu 1RM to najlepsza estymacja z serii.
    Funkcja jest wywoływana po każdym zapisie, edycji i usunięciu treningu lub testu,
    dzięki czemu usunięcie danych cofa także wynikające z nich 1RM.
    """
    baseline = (StrengthTest.objects.filter(user=user, exercise_id=exercise_id, estimated_1rm__gt=0)
                .order_by('-performed_at', '-id').first())
    value, source = 0.0, 'none'
    if baseline:
        value = baseline.estimated_1rm
        source = 'manual' if baseline.protocol == 'manual' else 'test'
    estimate = estimate_1rm_for(user, exercise_id, since=baseline.performed_at if baseline else None)
    if estimate > value:
        value, source = estimate, 'estimate'

    if value <= 0:
        PersonalRecord.objects.filter(user=user, exercise_id=exercise_id).delete()
        return None
    top_set = (ExerciseSet.objects.filter(session__user=user, exercise_id=exercise_id, is_warmup=False)
               .order_by('-weight').values_list('weight', flat=True).first()) or 0
    top_test = (StrengthTest.objects.filter(user=user, exercise_id=exercise_id).exclude(protocol='manual')
                .order_by('-weight').values_list('weight', flat=True).first()) or 0
    record, _ = PersonalRecord.objects.update_or_create(
        user=user, exercise_id=exercise_id,
        defaults={'best_1rm': round(value, 1), 'source': source, 'best_weight': max(top_set, top_test)},
    )
    return record


def refresh_records_after_session(session: WorkoutSession, exercise_ids=None) -> list[dict]:
    """Przelicza 1RM ćwiczeń z sesji; zwraca listę pobitych rekordów (WF-30)."""
    ids = set(exercise_ids or []) | set(session.sets.values_list('exercise_id', flat=True))
    before = {ex_id: current_1rm(session.user, ex_id)[0] for ex_id in ids}
    new_records = []
    for ex_id in ids:
        record = recompute_record(session.user, ex_id)
        now = record.best_1rm if record else 0.0
        if before[ex_id] > 0 and now > before[ex_id] + 0.05:
            new_records.append({'exercise_id': ex_id,
                                'exercise': Exercise.objects.get(pk=ex_id).name,
                                'previous': before[ex_id], 'current': now})
    return new_records


def register_strength_test(test: StrengthTest) -> None:
    """Wyznacza 1RM z wyniku testu i aktualizuje rekord użytkownika (WF-27)."""
    if test.protocol == 'manual':
        test.estimated_1rm = round(test.weight, 1)
    elif test.weight > 0 and test.reps <= MAX_REPS_FOR_ESTIMATE:
        test.estimated_1rm = round(epley_1rm(test.weight, test.reps), 1)
    else:
        test.estimated_1rm = 0.0  # test z masą ciała lub zbyt wiele powtórzeń - bez 1RM
    test.save(update_fields=['estimated_1rm'])
    recompute_record(test.user, test.exercise_id)
