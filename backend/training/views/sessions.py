"""Sesje, pomiary, testy, 1RM i import historii (WF-23 - WF-30, WF-45)."""

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import analytics
from ..importers import import_csv
from ..models import (
    BodyMeasurement,
    Exercise,
    ExerciseNote,
    LoadType,
    PersonalRecord,
    PlanDay,
    PlanExercise,
    StrengthTest,
    WorkoutPlan,
    WorkoutSession,
)
from ..serializers import (
    BodyMeasurementSerializer,
    StrengthTestSerializer,
    WorkoutPlanSerializer,
    WorkoutSessionSerializer,
)
from .common import IdempotentCreateMixin, ensure_profiles

# =============================================================================
#  SESJE, POMIARY, TESTY (WF-23 - WF-29)
# =============================================================================

class WorkoutSessionViewSet(IdempotentCreateMixin, viewsets.ModelViewSet):
    serializer_class = WorkoutSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):  # generowanie dokumentacji API - brak użytkownika
            return self.serializer_class.Meta.model.objects.none()
        return (WorkoutSession.objects.filter(user=self.request.user)
                .prefetch_related('sets__exercise').select_related('plan', 'plan_day')
                .order_by('-date_completed'))

    def create(self, request, *args, **kwargs):
        self.new_records = []
        self.rep_records = []
        response = super().create(request, *args, **kwargs)
        if response.status_code == status.HTTP_201_CREATED:
            response.data['new_records'] = self.new_records
            response.data['rep_records'] = self.rep_records
        return response

    def perform_create(self, serializer):
        session = serializer.save()
        self.new_records = analytics.refresh_records_after_session(session)
        self.rep_records = analytics.detect_rep_records(session)

    def update(self, request, *args, **kwargs):
        self.new_records = []
        self.rep_records = []
        response = super().update(request, *args, **kwargs)
        response.data['new_records'] = self.new_records
        response.data['rep_records'] = self.rep_records
        return response

    def perform_update(self, serializer):
        # ćwiczenia usunięte z sesji też wymagają przeliczenia 1RM
        previous = set(serializer.instance.sets.values_list('exercise_id', flat=True))
        session = serializer.save()
        self.new_records = analytics.refresh_records_after_session(session, previous)
        self.rep_records = analytics.detect_rep_records(session)

    def perform_destroy(self, instance):
        user, exercise_ids = instance.user, set(instance.sets.values_list('exercise_id', flat=True))
        instance.delete()
        for exercise_id in exercise_ids:
            analytics.recompute_record(user, exercise_id)

    @action(detail=True, methods=['patch'])
    def share(self, request, pk=None):
        """Udostępnienie treningu w Społeczności albo jego cofnięcie (bez przeliczania rekordów)."""
        session = self.get_object()
        session.shared = bool(request.data.get('shared'))
        session.save(update_fields=['shared'])
        return Response({'id': session.id, 'shared': session.shared})

    @action(detail=True, methods=['get'])
    def compare(self, request, pk=None):
        """Realizacja jednostki planu w tej sesji (WF-26)."""
        result = analytics.session_vs_plan(self.get_object())
        if result is None:
            return Response({'detail': 'Trening nie był wykonany według planu.'}, status=404)
        return Response(result)

    @action(detail=True, methods=['post'], url_path='to-plan')
    @transaction.atomic
    def to_plan(self, request, pk=None):
        """Tworzy prywatny plan z jedną jednostką na podstawie wykonanego treningu."""
        session = self.get_object()
        sets = list(session.sets.filter(is_warmup=False).select_related('exercise').order_by('id'))
        if not sets:
            return Response({'detail': 'Trening nie zawiera serii roboczych.'}, status=400)
        title = (request.data.get('title') or '').strip() or f'Trening z {session.date_completed:%d.%m.%Y}'
        ensure_profiles(request.user)
        rest = request.user.profile.default_rest_seconds
        plan = WorkoutPlan.objects.create(title=title[:150], creator=request.user, days_per_week=1,
                                          duration_weeks=4, goal=request.user.profile.goal,
                                          level=request.user.profile.level)
        day = PlanDay.objects.create(plan=plan, week=1, order=0, name=session.plan_day.name
                                     if session.plan_day else 'Dzień A')
        order = []
        for s in sets:
            if s.exercise_id not in order:
                order.append(s.exercise_id)
        for i, exercise_id in enumerate(order):
            ex_sets = [s for s in sets if s.exercise_id == exercise_id]
            top = max(ex_sets, key=lambda s: (s.weight, s.reps))
            PlanExercise.objects.create(plan=plan, day=day, exercise_id=exercise_id, order=i,
                                        target_sets=len(ex_sets), target_reps=top.reps,
                                        load_type=LoadType.KG, load_value=top.weight, rest_seconds=rest)
        analytics.recalculate_plan(plan, request.user)
        return Response(WorkoutPlanSerializer(plan, context={'request': request}).data, status=201)

    @action(detail=False, methods=['get'], url_path='last-for-exercise/(?P<exercise_id>[0-9]+)')
    def last_for_exercise(self, request, exercise_id=None):
        """Wynik z poprzedniej sesji - podpowiedź przy zapisie serii (WF-24)."""
        exercise_id = int(exercise_id)
        last_session = (WorkoutSession.objects
                        .filter(user=request.user, sets__exercise_id=exercise_id)
                        .order_by('-date_completed').first())
        sets = (last_session.sets.filter(exercise_id=exercise_id).order_by('set_number')
                if last_session else [])
        value, source = analytics.current_1rm(request.user, exercise_id)
        note = ExerciseNote.objects.filter(user=request.user, exercise_id=exercise_id).first()
        records = analytics.rep_records(request.user, exercise_id)
        suggestion = None
        params = request.query_params
        if params.get('reps_min', '').isdigit():
            suggestion = analytics.progression_suggestion(
                request.user, exercise_id, int(params['reps_min']),
                int(params['reps_max']) if params.get('reps_max', '').isdigit() else None,
                int(params['rir']) if params.get('rir', '').isdigit() else None)
        return Response({
            'exercise_id': exercise_id,
            'estimated_1rm': value,
            'source': source,
            'note': note.text if note else '',
            'rep_records': [{'reps': n, 'weight': r['weight'], 'date': r['date']} for n, r in sorted(records.items())],
            'suggestion': suggestion,
            'last_sets': [{'weight': s.weight, 'reps': s.reps, 'rpe': s.rpe, 'rir': s.rir,
                           'date': last_session.date_completed.isoformat()} for s in sets],
        })


class BodyMeasurementViewSet(IdempotentCreateMixin, viewsets.ModelViewSet):
    serializer_class = BodyMeasurementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):  # generowanie dokumentacji API - brak użytkownika
            return self.serializer_class.Meta.model.objects.none()
        return BodyMeasurement.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class StrengthTestViewSet(IdempotentCreateMixin, viewsets.ModelViewSet):
    serializer_class = StrengthTestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):  # generowanie dokumentacji API - brak użytkownika
            return self.serializer_class.Meta.model.objects.none()
        return StrengthTest.objects.filter(user=self.request.user).select_related('exercise')

    def perform_create(self, serializer):
        analytics.register_strength_test(serializer.save(user=self.request.user))

    def perform_update(self, serializer):
        previous = serializer.instance.exercise_id
        test = serializer.save()
        analytics.register_strength_test(test)
        if previous != test.exercise_id:
            analytics.recompute_record(test.user, previous)

    def perform_destroy(self, instance):
        user, exercise_id = instance.user, instance.exercise_id
        instance.delete()
        analytics.recompute_record(user, exercise_id)  # usunięcie testu cofa wynikające z niego 1RM


class OneRepMaxAPIView(APIView):
    """GET: aktualne 1RM we wszystkich ćwiczeniach; ?weight=&reps= - kalkulator wzorów.
    POST: ręczne wprowadzenie 1RM, zapisywane w historii testów (WF-18)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        weight, reps = request.query_params.get('weight'), request.query_params.get('reps')
        if weight and reps:
            try:
                return Response(analytics.one_rep_max_formulas(float(weight), int(reps)))
            except ValueError:
                return Response({'detail': 'Podaj ciężar i liczbę powtórzeń.'}, status=400)
        records = (PersonalRecord.objects.filter(user=request.user, best_1rm__gt=0)
                   .select_related('exercise').order_by('exercise__name'))
        return Response([{'exercise_id': r.exercise_id, 'exercise': r.exercise.name, 'value': r.best_1rm,
                          'source': r.source, 'best_weight': r.best_weight, 'updated_at': r.updated_at}
                         for r in records])

    def post(self, request):
        try:
            exercise = Exercise.objects.get(pk=request.data.get('exercise'))
            value = float(request.data.get('value'))
        except (Exercise.DoesNotExist, TypeError, ValueError):
            return Response({'detail': 'Podaj ćwiczenie i wartość 1RM.'}, status=400)
        if not 1 <= value <= 1000:
            return Response({'detail': '1RM poza zakresem 1-1000 kg.'}, status=400)
        test = StrengthTest.objects.create(user=request.user, exercise=exercise, protocol='manual',
                                           weight=round(value, 1), reps=1)
        analytics.register_strength_test(test)
        return Response({'exercise': exercise.id, 'value': test.estimated_1rm, 'source': 'manual'}, status=201)

class ImportAPIView(APIView):
    """Import historii treningów z pliku CSV (Strong, Hevy lub szablon)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'Wybierz plik CSV.'}, status=400)
        if upload.size > 5 * 1024 * 1024:
            return Response({'detail': 'Plik jest za duży (maks. 5 MB).'}, status=400)
        raw = upload.read()
        for encoding in ('utf-8-sig', 'cp1250', 'latin-1'):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        try:
            return Response(import_csv(request.user, text))
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=400)
