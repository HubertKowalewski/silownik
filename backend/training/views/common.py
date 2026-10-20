"""Wspólne elementy widoków: profile, powiadomienia, zapis idempotentny, przeliczanie planu."""

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from ..models import (
    HealthProfile,
    Notification,
    UserProfile,
)


def ensure_profiles(user):
    UserProfile.objects.get_or_create(user=user)
    HealthProfile.objects.get_or_create(user=user)


def notify(user, text, url=''):
    Notification.objects.create(user=user, text=text[:300], url=url)

# =============================================================================
#  ZAPIS IDEMPOTENTNY (WN-04)
# =============================================================================

class IdempotentCreateMixin:
    """Ponowne przesłanie rekordu z tym samym client_uuid nie tworzy duplikatu -
    zwraca istniejący rekord. Umożliwia bezpieczne ponawianie synchronizacji."""

    def create(self, request, *args, **kwargs):
        uuid = request.data.get('client_uuid')
        if uuid:
            model = self.get_serializer_class().Meta.model
            existing = model.objects.filter(client_uuid=uuid).first()
            if existing:
                if existing.user_id != request.user.id:
                    raise ValidationError({'client_uuid': 'Identyfikator jest już zajęty.'})
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)
