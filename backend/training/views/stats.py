"""Pulpit, statystyki, cele i raporty (WF-30 - WF-34, WF-38 - WF-43)."""
from datetime import date, timedelta

from django.db.models import Count, F, Max, Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import analytics
from ..models import (
    ExerciseSet,
    Notification,
    TrainingGoal,
    WorkoutSession,
)
from ..reports import report_to_csv, report_to_pdf
from ..serializers import (
    TrainingGoalSerializer,
)

# =============================================================================
#  PULPIT, STATYSTYKI, RAPORTY (WF-30 - WF-34)
# =============================================================================

def active_plan(user):
    last = (WorkoutSession.objects.filter(user=user, plan__creator=user)
            .order_by('-date_completed').select_related('plan').first())
    if last:
        return last.plan
    return user.created_plans.order_by('-updated_at').first()


def next_day(user, plan):
    days = list(plan.days.all())
    if not days:
        return None
    last = (WorkoutSession.objects.filter(user=user, plan=plan, plan_day__isnull=False)
            .order_by('-date_completed').first())
    if not last or last.plan_day not in days:
        return days[0]
    return days[(days.index(last.plan_day) + 1) % len(days)]


def single_trainings(user):
    """Własne plany z jedną jednostką (np. osobne treningi Push, Pull, Upper, Lower)."""
    return list(user.created_plans.annotate(n_days=Count('days', distinct=True)).filter(n_days=1)
                .annotate(last_done=Max('sessions__date_completed', filter=Q(sessions__user=user))).order_by('id'))


def rotation(user, plan, week_start):
    """Gdy użytkownik ma kilka osobnych treningów jednodniowych, pulpit traktuje je jak jeden cykl:
    proponuje ten, który był wykonany najdawniej (albo jeszcze nigdy), a postęp tygodnia liczy łącznie."""
    if plan.days.count() != 1:
        return None
    singles = single_trainings(user)
    if len(singles) < 2 or plan.id not in {p.id for p in singles}:
        return None
    # najpierw nigdy niewykonane (w kolejności utworzenia), potem najdawniej wykonane
    oldest = min(singles, key=lambda p: (p.last_done is not None, p.last_done.timestamp() if p.last_done else 0, p.id))
    day = oldest.days.first()
    profile = getattr(user, 'profile', None)
    return {
        'id': oldest.id, 'name': 'Twoje treningi: ' + ', '.join(p.title for p in singles), 'rotation': True,
        'weeklyWorkouts': getattr(profile, 'days_per_week', None) or len(singles),
        'completed': WorkoutSession.objects.filter(user=user, plan__in=singles, date_completed__gte=week_start).count(),
        'nextDay': {'id': day.id, 'name': day.name} if day else None,
    }


class DashboardAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        sessions = WorkoutSession.objects.filter(user=user)
        now = timezone.localtime()
        month = sessions.filter(date_completed__year=now.year, date_completed__month=now.month)
        week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)

        def tonnage(qs):
            # suma ciężar x powtórzenia liczona w bazie danych, bez wczytywania serii do pamięci
            total = (ExerciseSet.objects.filter(session__in=qs, is_warmup=False)
                     .aggregate(t=Sum(F('weight') * F('reps')))['t'])
            return int(total or 0)

        plan = active_plan(user)
        plan_data = {'name': 'Brak aktywnego planu', 'weeklyWorkouts': 0, 'completed': 0}
        if plan and (cycle := rotation(user, plan, week_start)):
            plan_data = cycle
        elif plan:
            nd = next_day(user, plan)
            plan_data = {'id': plan.id, 'name': plan.title, 'weeklyWorkouts': plan.days_per_week,
                         'completed': sessions.filter(plan=plan, date_completed__gte=week_start).count(),
                         'nextDay': {'id': nd.id, 'name': nd.name} if nd else None}

        progression = analytics.weekly_tonnage(user, weeks=4)
        return Response({
            'monthlyWorkouts': month.count(),
            'totalWorkouts': sessions.count(),
            'monthlyTonnage': tonnage(month),
            'totalTonnage': tonnage(sessions),
            'currentPlan': plan_data,
            'recentSessions': [{
                'id': s.id, 'date': s.date_completed.isoformat(),
                'name': s.plan.title if s.plan else 'Trening bez planu',
                'note': s.notes or '', 'status': 'Zakończony',
            } for s in sessions.select_related('plan').order_by('-date_completed')[:5]],
            'smartSuggestion': analytics.smart_suggestion(user),
            'unreadNotifications': Notification.objects.filter(user=user, is_read=False).count(),
            'progressData': [{'week': p['week'], 'weight': p['tonnage']} for p in progression]
            or [{'week': f'Tydz. {i}', 'weight': 0} for i in range(1, 5)],
        })


class StatsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        try:
            weeks = min(max(int(request.query_params.get('weeks', 12)), 1), 52)
        except (TypeError, ValueError):
            weeks = 12
        exercise_id = request.query_params.get('exercise')
        progression, prediction, relative = [], [], None
        if exercise_id and exercise_id.isdigit():
            progression = analytics.exercise_progression(user, int(exercise_id), weeks)
            prediction = analytics.predict_1rm(user, int(exercise_id))
            relative = analytics.relative_strength(user, int(exercise_id))
        return Response({
            'weeklyTonnage': analytics.weekly_tonnage(user, weeks),
            'monthlyTonnage': analytics.monthly_tonnage(user),
            'muscleSplit': analytics.muscle_group_split(user, weeks=4),
            'personalRecords': analytics.personal_records(user)[:10],
            'progression': progression,
            'prediction': prediction,
            'relativeStrength': relative,
            'measurements': analytics.measurement_series(user),
            'effort': analytics.effort_stats(user, weeks),
            'load': analytics.training_load(user),
            'repRecords': ([{'reps': n, 'weight': r['weight'], 'date': r['date']}
                            for n, r in sorted(analytics.rep_records(user, int(exercise_id)).items())]
                           if exercise_id and exercise_id.isdigit() else []),
        })


class ReportAPIView(APIView):
    """Raport okresowy w formacie JSON, CSV lub PDF (WF-34)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            date_to = date.fromisoformat(request.query_params.get('to') or timezone.localdate().isoformat())
            date_from = date.fromisoformat(request.query_params.get('from')
                                           or (date_to - timedelta(days=29)).isoformat())
        except ValueError:
            return Response({'detail': 'Daty w formacie RRRR-MM-DD.'}, status=400)
        if date_from > date_to or (date_to - date_from).days > 366:
            return Response({'detail': 'Nieprawidłowy zakres dat (maks. 1 rok).'}, status=400)
        report = analytics.period_report(request.user, date_from, date_to)
        fmt = request.query_params.get('export', 'json')
        name = f'raport-{date_from}-{date_to}'
        if fmt == 'csv':
            response = HttpResponse(report_to_csv(report), content_type='text/csv; charset=utf-8')
            response['Content-Disposition'] = f'attachment; filename="{name}.csv"'
            return response
        if fmt == 'pdf':
            response = HttpResponse(report_to_pdf(report), content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="{name}.pdf"'
            return response
        return Response(report)

class TrainingGoalViewSet(viewsets.ModelViewSet):
    """Cele siłowe z postępem i prognozowaną datą osiągnięcia."""
    serializer_class = TrainingGoalSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):  # generowanie dokumentacji API - brak użytkownika
            return self.serializer_class.Meta.model.objects.none()
        return TrainingGoal.objects.filter(user=self.request.user).select_related('exercise')

    def perform_create(self, serializer):
        exercise = serializer.validated_data['exercise']
        current, _ = analytics.current_1rm(self.request.user, exercise.id)
        if current >= serializer.validated_data['target_1rm']:
            raise ValidationError({'target_1rm': f'Twoje obecne 1RM ({current:g} kg) już osiąga ten cel.'})
        serializer.save(user=self.request.user, start_1rm=current)
