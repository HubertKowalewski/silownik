"""Plany: tworzenie, szablony, dobór, klonowanie, konsultacje (WF-08 - WF-22, WF-39, WF-40)."""

from django.db import transaction
from django.db.models import Count, Q
from django.http import Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import analytics
from ..models import (
    ContentReport,
    Exercise,
    LoadType,
    PlanComment,
    PlanDay,
    PlanExercise,
    WorkoutPlan,
)
from ..moderation import author_of, has_open_report
from ..plan_assistant import SPLITS, split_list, suggest
from ..plan_templates import TEMPLATES, choose_template, create_from_template, template_list
from ..serializers import (
    PlanCommentSerializer,
    WorkoutPlanSerializer,
)
from .common import ensure_profiles, notify

# =============================================================================
#  PLANY: tworzenie, dobór, klonowanie, konsultacje (WF-08 - WF-22)
# =============================================================================



def with_details(qs):
    """Plan z jednostkami, ćwiczeniami i licznikami - stała liczba zapytań niezależnie od wielkości planu."""
    return (qs.select_related('creator', 'parent_plan__creator')
            .prefetch_related('days__exercises__exercise')
            .annotate(n_forks=Count('forks', distinct=True),
                      n_exercises=Count('exercises', distinct=True),
                      n_comments=Count('comments', filter=Q(comments__is_hidden=False), distinct=True)))


COPIED_ITEM_FIELDS = ('exercise_id', 'order', 'target_sets', 'target_reps', 'target_reps_max', 'target_rir',
                      'load_type', 'load_value', 'rest_seconds', 'notes')


def copy_plan(source, owner, item_overrides=None, **plan_fields):
    """Kopiuje plan wraz z jednostkami i pozycjami jako nowy, prywatny plan użytkownika `owner`.

    `item_overrides(item) -> dict` pozwala podmienić pola pozycji (np. ćwiczenie i ciężar przy klonowaniu
    cudzego planu - WF-17); bez niego powstaje wierna kopia (duplikowanie własnego planu - WF-11).
    """
    copy = WorkoutPlan.objects.create(
        title=f'{source.title} (kopia)'[:150], creator=owner, description=source.description, is_public=False,
        goal=source.goal, level=source.level, days_per_week=source.days_per_week,
        duration_weeks=source.duration_weeks, required_equipment=source.required_equipment, **plan_fields)
    for day in source.days.all():
        new_day = PlanDay.objects.create(plan=copy, week=day.week, order=day.order, name=day.name)
        PlanExercise.objects.bulk_create([PlanExercise(plan=copy, day=new_day, **{
            field: getattr(item, field) for field in COPIED_ITEM_FIELDS
        } | (item_overrides(item) if item_overrides else {})) for item in day.exercises.all()])
    return copy



def report_content(request, **target):
    """Zgłoszenie planu lub komentarza do moderacji; target = plan=... albo comment=..."""
    reason = (request.data.get('reason') or '').strip()[:300]
    if not reason:
        return Response({'detail': 'Podaj powód zgłoszenia.'}, status=400)
    content = target.get('plan') or target.get('comment')
    if author_of(content).id == request.user.id:
        return Response({'detail': 'Nie możesz zgłosić własnej treści.'}, status=400)
    if has_open_report(request.user, **target):
        return Response({'detail': 'Ta treść została już przez Ciebie zgłoszona i czeka na moderatora.'})
    ContentReport.objects.create(reporter=request.user, reason=reason, **target)
    return Response({'detail': 'Dziękujemy, zgłoszenie trafi do moderacji.'}, status=201)


class WorkoutPlanViewSet(viewsets.ModelViewSet):
    serializer_class = WorkoutPlanSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):  # generowanie dokumentacji API - brak użytkownika
            return self.serializer_class.Meta.model.objects.none()
        user = self.request.user
        qs = with_details(WorkoutPlan.objects.all())
        visible = Q(creator=user) | Q(is_public=True, is_hidden=False)
        scope = self.request.query_params.get('scope')
        if scope == 'mine':
            qs = qs.filter(creator=user)
        elif scope == 'public':
            qs = qs.filter(is_public=True, is_hidden=False)
        else:
            qs = qs.filter(visible)
        params = self.request.query_params
        if params.get('search'):
            qs = qs.filter(Q(title__icontains=params['search']) | Q(description__icontains=params['search']))
        for field in ('goal', 'level'):
            if params.get(field):
                qs = qs.filter(**{field: params[field]})
        if params.get('days', '').isdigit():
            qs = qs.filter(days_per_week=int(params['days']))
        plans = qs.distinct().order_by('-created_at')
        if params.get('equipment'):
            allowed = set(params['equipment'].split(','))
            plans = [p for p in plans if set(p.required_equipment or []) <= allowed]
        return plans

    def _assert_owner(self, plan):
        if plan.creator_id != self.request.user.id:
            raise PermissionDenied('To nie jest Twój plan.')

    def _can_view(self, plan):
        user = self.request.user
        return (plan.creator_id == user.id or (plan.is_public and (not plan.is_hidden or user.is_staff))
                or plan.forks.filter(creator=user).exists())

    def get_object(self):
        plan = with_details(WorkoutPlan.objects.filter(pk=self.kwargs['pk'])).first()
        if not plan or not self._can_view(plan):
            raise Http404
        return plan

    def perform_create(self, serializer):
        analytics.recalculate_plan(serializer.save(), self.request.user)

    def perform_update(self, serializer):
        self._assert_owner(serializer.instance)
        analytics.recalculate_plan(serializer.save(), self.request.user)

    def update(self, request, *args, **kwargs):
        super().update(request, *args, **kwargs)
        # odpowiedź z ponownie pobranego planu - przeliczone ciężary i aktualne liczniki
        return Response(self.get_serializer(self.get_object()).data)

    def perform_destroy(self, instance):
        self._assert_owner(instance)
        instance.delete()

    # --- dobór planu (WF-14) ---------------------------------------------------

    @action(detail=True, methods=['get'])
    def match(self, request, pk=None):
        return Response(analytics.plan_match(request.user, self.get_object()))

    @action(detail=False, methods=['get'])
    def recommended(self, request):
        ensure_profiles(request.user)
        plans = (WorkoutPlan.objects.filter(is_public=True, is_hidden=False)
                 .exclude(creator=request.user).select_related('creator')
                 .prefetch_related('days__exercises__exercise', 'exercises__exercise__stressed_areas'))
        ranked = []
        for plan in plans:
            m = analytics.plan_match(request.user, plan)
            data = WorkoutPlanSerializer(plan, context={'request': request}).data
            data.update({'match_score': m['score'], 'match_reasons': m['reasons'],
                         'health_warnings': len(m['warnings'])})
            ranked.append(data)
        ranked.sort(key=lambda p: (-p['match_score'], p['health_warnings']))
        return Response(ranked[:20])

    # --- klonowanie (WF-16 - WF-18) --------------------------------------------

    @action(detail=True, methods=['get'], url_path='fork-preview')
    def fork_preview(self, request, pk=None):
        plan = self.get_object()
        match = analytics.plan_match(request.user, plan)
        return Response({'items': analytics.scale_plan_for(request.user, plan), **match})

    @action(detail=True, methods=['post'], url_path='fork')
    @transaction.atomic
    def fork_plan(self, request, pk=None):
        target = self.get_object()
        if target.creator_id == request.user.id:
            return Response({'detail': 'Nie możesz sklonować własnego planu.'}, status=400)
        if not target.is_public:
            return Response({'detail': 'Plan nie jest publiczny.'}, status=404)

        substitutions = request.data.get('substitutions') or {}
        valid_ids = {str(i) for i in target.exercises.values_list('id', flat=True)}
        substitutions = {k: v for k, v in substitutions.items()
                         if k in valid_ids and Exercise.objects.filter(pk=v).exists()}
        scaled = {row['plan_exercise_id']: row
                  for row in analytics.scale_plan_for(request.user, target, substitutions)}

        def scaled_load(item):
            row = scaled[item.id]
            return {
                'exercise_id': row['exercise_id'],
                # pozycje w kg otrzymują ciężar przeliczony dla odbiorcy
                'load_value': (row['suggested_weight']
                               if item.load_type == LoadType.KG and row['suggested_weight'] else item.load_value),
                'calculated_weight': row['suggested_weight'], 'needs_calibration': row['needs_calibration'],
            }

        forked = copy_plan(target, request.user, item_overrides=scaled_load, parent_plan=target,
                           share_progress_with_author=bool(request.data.get('share_progress')))
        notify(target.creator, f'{request.user.username} sklonował Twój plan „{target.title}”.',
               f'/plany/{target.id}')
        return Response({
            'message': 'Plan został sklonowany i dostosowany do Twoich możliwości.',
            'forked_plan_id': forked.id,
            'plan': WorkoutPlanSerializer(forked, context={'request': request}).data,
            'scaled_exercises_data': list(scaled.values()),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        """Kopia własnego planu, np. jako punkt wyjścia do kolejnego mezocyklu (WF-11)."""
        source = self.get_object()
        self._assert_owner(source)
        copy = copy_plan(source, request.user)
        analytics.recalculate_plan(copy, request.user)
        return Response(WorkoutPlanSerializer(copy, context={'request': request}).data, status=201)

    @action(detail=True, methods=['get'])
    def suggestions(self, request, pk=None):
        """Propozycje ciężarów na najbliższy trening (podwójna progresja) dla pozycji planu."""
        plan = self.get_object()
        self._assert_owner(plan)
        items = plan.exercises.all()
        if str(request.query_params.get('day', '')).isdigit():
            items = items.filter(day_id=int(request.query_params['day']))
        items = list(items)
        history = analytics.recent_working_sets(request.user, {i.exercise_id for i in items})
        return Response({str(i.id): analytics.progression_suggestion(
            request.user, i.exercise_id, i.target_reps, i.target_reps_max, i.target_rir,
            fallback_weight=i.calculated_weight, history=history[i.exercise_id]) for i in items})

    @action(detail=True, methods=['post'])
    def recalculate(self, request, pk=None):
        plan = self.get_object()
        self._assert_owner(plan)
        analytics.recalculate_plan(plan, request.user)
        return Response(self.get_serializer(self.get_object()).data)  # świeże dane (bez cache prefetch)

    @action(detail=True, methods=['patch'], url_path='share-progress')
    def share_progress(self, request, pk=None):
        """Udzielenie lub cofnięcie zgody na wgląd autora w postępy (WF-04)."""
        plan = self.get_object()
        self._assert_owner(plan)
        plan.share_progress_with_author = bool(request.data.get('value'))
        plan.save(update_fields=['share_progress_with_author'])
        return Response({'share_progress_with_author': plan.share_progress_with_author})

    # --- konsultacje (WF-19, WF-20) -------------------------------------------

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        plan = self.get_object()
        # wątek konsultacji prowadzony jest przy planie oryginalnym
        thread_plan = plan.parent_plan if plan.parent_plan_id and plan.creator_id == request.user.id else plan
        if request.method == 'GET':
            qs = thread_plan.comments.filter(is_hidden=False).select_related('author', 'plan')
            return Response({'plan_id': thread_plan.id, 'plan_title': thread_plan.title,
                             'comments': PlanCommentSerializer(qs, many=True).data})
        serializer = PlanCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = serializer.validated_data.get('parent')
        if parent and parent.plan_id != thread_plan.id:
            raise ValidationError({'parent': 'Odpowiedź musi dotyczyć tego samego wątku.'})
        comment = serializer.save(plan=thread_plan, author=request.user)
        url = f'/plany/{thread_plan.id}'
        if thread_plan.creator_id != request.user.id:
            notify(thread_plan.creator, f'Nowe pytanie do planu „{thread_plan.title}” od {request.user.username}.', url)
        if parent and parent.author_id != request.user.id:
            notify(parent.author, f'{request.user.username} odpowiedział w wątku planu „{thread_plan.title}”.', url)
        return Response(PlanCommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def followers(self, request, pk=None):
        """Osoby realizujące plan; postępy tylko za zgodą, bez danych o zdrowiu (WF-20)."""
        plan = self.get_object()
        self._assert_owner(plan)
        out = []
        for fork in plan.forks.select_related('creator'):
            entry = {'username': fork.creator.username, 'forked_at': fork.created_at,
                     'shares_progress': fork.share_progress_with_author}
            if fork.share_progress_with_author:
                sessions = fork.sessions.order_by('-date_completed')
                entry['sessions'] = sessions.count()
                entry['last_session'] = sessions.first().date_completed if sessions.exists() else None
                seen, progress = set(), []
                for pe in fork.exercises.select_related('exercise'):
                    if pe.exercise_id in seen:
                        continue
                    seen.add(pe.exercise_id)
                    progress.append({'exercise': pe.exercise.name,
                                     'current_1rm': analytics.current_1rm(fork.creator, pe.exercise_id)[0]})
                entry['progress'] = progress[:10]
            out.append(entry)
        return Response(out)

    @action(detail=True, methods=['post'], url_path='flag')
    def flag(self, request, pk=None):
        return report_content(request, plan=self.get_object())


class FlagCommentAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        comment = PlanComment.objects.filter(pk=pk, is_hidden=False).first()
        if not comment:
            return Response({'detail': 'Nie znaleziono komentarza.'}, status=404)
        return report_content(request, comment=comment)


class PlanTemplatesAPIView(APIView):
    """Gotowe szablony planów oraz szablon polecany dla profilu użytkownika."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_profiles(request.user)
        key, reason = choose_template(request.user)
        return Response({'templates': template_list(), 'recommended': key, 'reason': reason})

    def post(self, request, key):
        """Tworzy plan z szablonu; key = 'auto' - wybór szablonu na podstawie profilu (generator)."""
        ensure_profiles(request.user)
        reason = None
        if key == 'auto':
            key, reason = choose_template(request.user)
        if key not in TEMPLATES:
            return Response({'detail': 'Nie ma takiego szablonu.'}, status=404)
        plan, changes = create_from_template(request.user, key, adapt=request.data.get('adapt', True) is not False)
        return Response({'template': key, 'reason': reason, 'changes': changes,
                         'plan': WorkoutPlanSerializer(plan, context={'request': request}).data}, status=201)


class PlanAssistantAPIView(APIView):
    """Asystent tworzenia planu: GET - podziały treningowe i polecany dla profilu,
    POST {split} - jednostki z propozycjami ćwiczeń dla każdego miejsca (do wyboru, nie na sztywno)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_profiles(request.user)
        return Response(split_list(request.user.profile))

    def post(self, request):
        ensure_profiles(request.user)
        key = request.data.get('split')
        if key not in SPLITS:
            return Response({'detail': 'Nieznany podział treningowy.'}, status=400)
        return Response(suggest(request.user, key))
