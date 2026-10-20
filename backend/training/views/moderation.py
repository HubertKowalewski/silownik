"""Panel moderatora w aplikacji (WF-22): zgłoszenia treści, decyzje, blokowanie kont.

Dostęp mają konta personelu (is_staff) - nadawane poleceniem `python manage.py nadaj_moderatora <login>`.
"""
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import moderation
from ..models import ContentReport


class ModerationReportsAPIView(APIView):
    """GET ?status=open|closed - lista zgłoszeń; liczba otwartych spraw w polu open_count."""
    permission_classes = [IsAdminUser]

    def get(self, request):
        resolved = request.query_params.get('status') == 'closed'
        return Response({'open_count': moderation.open_count(), 'reports': moderation.report_rows(resolved)})


class ModerationDecisionAPIView(APIView):
    """POST {decision: hidden|dismissed|restored, note} - decyzja dla treści wskazanej w zgłoszeniu."""
    permission_classes = [IsAdminUser]

    def post(self, request, pk):
        report = get_object_or_404(ContentReport, pk=pk)
        note = (request.data.get('note') or '').strip()
        try:
            closed = moderation.decide(report, request.data.get('decision', ''), request.user, note)
        except moderation.ModerationError as exc:
            return Response({'detail': str(exc)}, status=400)
        return Response({'detail': 'Decyzja zapisana.', 'closed_reports': closed,
                         'open_count': moderation.open_count()})


class ModerationUserBlockAPIView(APIView):
    """POST {blocked: true|false} - blokada / odblokowanie konta autora treści."""
    permission_classes = [IsAdminUser]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        blocked = bool(request.data.get('blocked', True))
        try:
            moderation.set_blocked(user, blocked, request.user)
        except moderation.ModerationError as exc:
            return Response({'detail': str(exc)}, status=400)
        return Response({'detail': f'Konto {user.username} ' + ('zablokowane.' if blocked else 'odblokowane.'),
                         'blocked': blocked})
