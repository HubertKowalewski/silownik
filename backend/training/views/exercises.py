"""Baza ćwiczeń i notatki do ćwiczeń (WF-06, WF-07, WF-44)."""

from django.db.models import Count, Q
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .. import analytics
from ..models import (
    Exercise,
    ExerciseNote,
)
from ..serializers import (
    ExerciseSerializer,
)

# =============================================================================
#  ĆWICZENIA (WF-06, WF-07)
# =============================================================================

class ExerciseViewSet(viewsets.ModelViewSet):
    serializer_class = ExerciseSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'muscle_group']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):  # generowanie dokumentacji API - brak użytkownika
            return self.serializer_class.Meta.model.objects.none()
        user = self.request.user
        qs = (Exercise.objects.filter(Q(created_by__isnull=True) | Q(created_by=user))
              .annotate(times_used=Count('exerciseset', filter=Q(exerciseset__session__user=user,
                                                                  exerciseset__is_warmup=False))))
        group = self.request.query_params.get('muscle_group')
        if group:
            qs = qs.filter(muscle_group=group)
        return qs.prefetch_related('stressed_areas').order_by('muscle_group', 'name')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['get', 'put'])
    def note(self, request, pk=None):
        """Prywatna notatka do ćwiczenia (np. ustawienie maszyny); pusty tekst usuwa notatkę."""
        exercise = self.get_object()
        if request.method == 'PUT':
            text = (request.data.get('text') or '').strip()[:500]
            if text:
                ExerciseNote.objects.update_or_create(user=request.user, exercise=exercise, defaults={'text': text})
            else:
                ExerciseNote.objects.filter(user=request.user, exercise=exercise).delete()
        note = ExerciseNote.objects.filter(user=request.user, exercise=exercise).first()
        return Response({'exercise': exercise.id, 'text': note.text if note else ''})

    @action(detail=True, methods=['get'])
    def substitutes(self, request, pk=None):
        """Zamienniki ćwiczenia (ta sama partia, bez obciążania zgłoszonych ograniczeń, preferowany
        dostępny sprzęt) - do zamiany ćwiczenia w trakcie treningu, np. gdy maszyna jest zajęta (WF-26)."""
        return Response(analytics.substitutes_for(request.user, self.get_object(), limit=6))

    def _check_owner(self, instance):
        if not self.request.user.is_staff and instance.created_by_id != self.request.user.id:
            raise PermissionDenied('Można edytować tylko własne ćwiczenia.')

    def perform_update(self, serializer):
        self._check_owner(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._check_owner(instance)
        instance.delete()
