"""Raport okresowy (WF-34)."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta

import pandas as pd
from django.utils import timezone

from ..models import (
    BodyMeasurement,
    ExerciseSet,
    TrainingGoal,
    WorkoutPlan,
    WorkoutSession,
)
from .core import MAX_REPS_FOR_ESTIMATE, MAX_RIR_FOR_ESTIMATE, set_1rm, sets_dataframe
from .planning import session_vs_plan
from .statistics import MAX_REP_RECORD, _effort_summary, best_by_reps, drop_dominated, goal_status

# --- RAPORT OKRESOWY (WF-34) --------------------------------------------------

def _change(current, previous):
    if previous in (None, 0) or current is None:
        return None
    return round(100 * (current - previous) / previous, 1)


def _period_df(user, date_from: date, date_to: date):
    start = timezone.make_aware(datetime.combine(date_from, time.min))
    end = timezone.make_aware(datetime.combine(date_to, time.max))
    return start, end, sets_dataframe(user, date_from=start, date_to=end)


def period_report(user, date_from: date, date_to: date) -> dict:
    """Raport za okres: podsumowanie z porównaniem do poprzedniego okresu, lista treningów,
    realizacja planu, objętość tygodniowa, serie na partię, zmiany 1RM, rekordy, cele, pomiary."""
    start, end, df = _period_df(user, date_from, date_to)
    length = (date_to - date_from).days + 1
    weeks = max(1.0, length / 7)
    _, _, prev_df = _period_df(user, date_from - timedelta(days=length), date_from - timedelta(days=1))

    sessions = list(WorkoutSession.objects.filter(user=user, date_completed__range=(start, end))
                    .select_related('plan', 'plan_day').prefetch_related('sets').order_by('date_completed'))
    prev_sessions = WorkoutSession.objects.filter(
        user=user, date_completed__range=(start - timedelta(days=length), start - timedelta(microseconds=1))).count()

    def totals(frame, n_sessions):
        return {'sessions': n_sessions, 'total_sets': len(frame),
                'total_tonnage': int(frame['tonnage'].sum()) if not frame.empty else 0}

    now_t, prev_t = totals(df, len(sessions)), totals(prev_df, prev_sessions)
    comparison = [{'metric': label, 'current': now_t[key], 'previous': prev_t[key],
                   'change_percent': _change(now_t[key], prev_t[key])}
                  for key, label in [('sessions', 'Treningi'), ('total_sets', 'Serie robocze'),
                                     ('total_tonnage', 'Objętość [kg]')]]

    # lista treningów i realizacja planu
    session_rows, completions = [], []
    for s in sessions:
        work = [x for x in s.sets.all() if not x.is_warmup]
        comparison_plan = session_vs_plan(s) if s.plan_day_id else None
        completion = comparison_plan['completion_percent'] if comparison_plan else None
        if completion is not None:
            completions.append(completion)
        session_rows.append({
            'date': timezone.localtime(s.date_completed).strftime('%d.%m.%Y'),
            'name': (f'{s.plan.title} · {s.plan_day.name}' if s.plan and s.plan_day else
                     s.plan.title if s.plan else 'Trening bez planu'),
            'duration_min': round(s.duration_seconds / 60) if s.duration_seconds else None,
            'sets': len(work), 'tonnage': int(sum(x.weight * x.reps for x in work)),
            'completion_percent': completion,
        })
    durations = [r['duration_min'] for r in session_rows if r['duration_min']]
    plan = WorkoutPlan.objects.filter(creator=user).order_by('-updated_at').first()
    planned = round(plan.days_per_week * weeks) if plan else 0
    done_with_plan = sum(1 for s in sessions if plan and s.plan_id == plan.id)

    # objętość tygodniowa
    weekly = []
    if not df.empty:
        grouped = df.set_index('date').resample('W-MON').agg(tonnage=('tonnage', 'sum'), sets=('tonnage', 'count'))
        weekly = [{'week': d.strftime('%d.%m'), 'tonnage': int(r['tonnage']), 'sets': int(r['sets'])}
                  for d, r in grouped.iterrows()]

    # partie mięśniowe: serie efektywne (RIR <= 4 lub bez oceny) na tydzień
    muscle = []
    if not df.empty:
        hard = df[df['rir'].isna() | (df['rir'] <= MAX_RIR_FOR_ESTIMATE)]
        g = df.groupby('muscle_group').agg(tonnage=('tonnage', 'sum'), sets=('tonnage', 'count'))
        hard_counts = hard.groupby('muscle_group')['tonnage'].count()
        muscle = sorted([{'group': grp, 'tonnage': int(r['tonnage']), 'sets': int(r['sets']),
                          'hard_sets_per_week': round(float(hard_counts.get(grp, 0)) / weeks, 1)}
                         for grp, r in g.iterrows()], key=lambda m: -m['sets'])

    # zmiany 1RM, rekordy i przebieg dla wykresu
    progress, rep_prs, series = [], [], []
    if not df.empty:
        # historia sprzed okresu dla wszystkich ćwiczeń z raportu - jedno zapytanie zamiast dwóch na ćwiczenie
        prior: dict[int, list] = defaultdict(list)
        prior_1rm: dict[int, float] = {}
        for ex_id, w, r, rir, when in ExerciseSet.objects.filter(
                session__user=user, exercise_id__in=set(df['exercise_id'].astype(int)), is_warmup=False,
                weight__gt=0, session__date_completed__lt=start).values_list(
                'exercise_id', 'weight', 'reps', 'rir', 'session__date_completed'):
            prior[ex_id].append((w, r, when))
            estimate = set_1rm(w, r, rir) if r <= MAX_REPS_FOR_ESTIMATE else None
            if estimate:
                prior_1rm[ex_id] = max(prior_1rm.get(ex_id, 0.0), estimate)

        rated = df.dropna(subset=['e1rm']).sort_values('date')
        for (ex_id, name), g in rated.groupby(['exercise_id', 'exercise']):
            prev_best = prior_1rm.get(int(ex_id))
            best = float(g['e1rm'].max())
            progress.append({'exercise': name, 'start_1rm': round(float(g['e1rm'].iloc[0]), 1),
                             'best_1rm': round(best, 1), 'change': round(best - float(g['e1rm'].iloc[0]), 1),
                             'record': prev_best is not None and best > prev_best + 0.05, 'sets': len(g)})
        progress.sort(key=lambda r: (-r['sets'], r['exercise']))
        for item in sorted(progress, key=lambda r: -r['best_1rm']):
            if len(series) == 3:
                break
            g = rated[rated['exercise'] == item['exercise']].set_index('date').resample('W-MON')['e1rm'].max().dropna()
            if len(g) < 2:
                continue
            series.append({'exercise': item['exercise'],
                            'points': [{'week': d.strftime('%d.%m'), 'date': d.date().isoformat(),
                                        'e1rm': round(float(v), 1)} for d, v in g.items()]})
        for ex_id, g in df[df['reps'] <= MAX_REP_RECORD].groupby('exercise_id'):
            previous = best_by_reps(prior[int(ex_id)])
            if not previous:
                continue
            best_in_period = {}
            for _, r in g.iterrows():
                n = int(r['reps'])
                if r['weight'] > best_in_period.get(n, (0,))[0]:
                    best_in_period[n] = (float(r['weight']), r['exercise'])
            for n, (w, name) in sorted(best_in_period.items()):
                prev = previous.get(n)
                if prev is None or w > prev['weight']:
                    rep_prs.append({'exercise': name, 'exercise_id': int(ex_id), 'reps': n, 'weight': w,
                                    'previous': prev['weight'] if prev else None})
        rep_prs = drop_dominated(rep_prs)

    goals = []
    for goal in TrainingGoal.objects.filter(user=user).select_related('exercise'):
        st = goal_status(goal)
        goals.append({'exercise': goal.exercise.name, 'target_1rm': goal.target_1rm,
                      'current_1rm': st['current_1rm'], 'progress_percent': st['progress_percent'],
                      'achieved': goal.achieved_at is not None, 'message': st['message']})

    measurements = BodyMeasurement.objects.filter(user=user, measured_at__range=(start, end)).order_by('measured_at')
    first_m, last_m = measurements.first(), measurements.last()
    fields = ['body_weight', 'waist', 'chest', 'arm', 'thigh', 'hips', 'resting_hr']
    measure = {}
    for f in fields:
        a, b = getattr(first_m, f, None), getattr(last_m, f, None)
        measure[f] = {'start': a, 'end': b, 'change': round(b - a, 1) if a is not None and b is not None else None}

    empty = pd.DataFrame(columns=['rir'])
    return {
        'user': user.username,
        'date_from': date_from.isoformat(),
        'date_to': date_to.isoformat(),
        'weeks': round(weeks, 1),
        'sessions': len(sessions),
        'total_sets': now_t['total_sets'],
        'total_tonnage': now_t['total_tonnage'],
        'avg_duration_min': round(sum(durations) / len(durations)) if durations else None,
        'sessions_per_week': round(len(sessions) / weeks, 1),
        'comparison': comparison,
        'plan': plan.title if plan else None,
        'planned_sessions': planned,
        'completed_plan_sessions': done_with_plan,
        'adherence_percent': round(100 * done_with_plan / planned, 1) if planned else None,
        'avg_plan_completion_percent': round(sum(completions) / len(completions), 1) if completions else None,
        'session_list': session_rows,
        'weekly': weekly,
        'effort': _effort_summary(df) if not df.empty else _effort_summary(empty),
        'muscle_split': muscle,
        'progress': progress,
        'progress_series': series,
        'rep_records': rep_prs,
        'goals': goals,
        'measurements': measure,
    }
