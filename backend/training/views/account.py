"""Konto, profil, prywatność, powiadomienia (WF-01 - WF-05, WF-21)."""
import json
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.http import Http404, HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .. import analytics, avatars, social
from ..models import (
    Avatar,
    BodyArea,
    Equipment,
    Exercise,
    Goal,
    Level,
    LoadType,
    Notification,
    StrengthTest,
    WorkoutSession,
)
from ..serializers import (
    AccountSerializer,
    BodyAreaSerializer,
    BodyMeasurementSerializer,
    NotificationSerializer,
    PasswordResetConfirmSerializer,
    PlanCommentSerializer,
    ProfileSerializer,
    RegisterSerializer,
    StrengthTestSerializer,
    UserSerializer,
    WorkoutPlanSerializer,
    WorkoutSessionSerializer,
)
from .common import ensure_profiles

# =============================================================================
#  KONTO (WF-01, WF-05)
# =============================================================================

class AuthThrottleMixin:
    """Wspólny limit prób dla endpointów przyjmujących hasło lub adres e-mail."""
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'


class CSRFTokenAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'csrfToken': get_token(request)})


class RegisterAPIView(AuthThrottleMixin, APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                user = serializer.save()
        except IntegrityError:
            # Dwie równoczesne rejestracje tej samej nazwy - walidacja przeszła w obu, baza odrzuciła drugą.
            return Response({'username': ['Ta nazwa użytkownika jest już zajęta.']}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginAPIView(AuthThrottleMixin, APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''
        user = authenticate(request, username=username, password=password)
        if user is None:
            # poprawne hasło do zablokowanego konta - komunikat zamiast ogólnego błędu logowania
            inactive = User.objects.filter(username=username, is_active=False).first()
            if inactive and inactive.check_password(password):
                return Response({'detail': 'Konto zostało zablokowane przez moderatora.'},
                                status=status.HTTP_403_FORBIDDEN)
            return Response({'detail': 'Nieprawidłowa nazwa użytkownika lub hasło.'},
                            status=status.HTTP_401_UNAUTHORIZED)
        login(request, user)
        ensure_profiles(user)
        return Response(UserSerializer(user).data)


class LogoutAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        # niezalogowany gość dostaje pustą odpowiedź (200), a nie błąd - to normalny stan przed logowaniem
        if not request.user.is_authenticated:
            return JsonResponse(None, safe=False)
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        serializer = AccountSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)

    def delete(self, request):
        """Trwałe usunięcie konta wraz z danymi (WF-05, art. 17 RODO)."""
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        if not request.user.check_password(request.data.get('password') or ''):
            return Response({'detail': 'Nieprawidłowe hasło.'}, status=status.HTTP_400_BAD_REQUEST)
        user = request.user
        logout(request)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetRequestAPIView(AuthThrottleMixin, APIView):
    """Wysyła link do ustawienia nowego hasła (WF-01).

    Odpowiedź jest zawsze taka sama, niezależnie od tego, czy konto istnieje -
    nie ujawnia, jakie adresy e-mail są zarejestrowane.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        from django.contrib.auth.tokens import default_token_generator
        from django.core.mail import send_mail
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        email = (request.data.get('email') or '').strip()
        for user in User.objects.filter(email__iexact=email, is_active=True) if email else []:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = request.build_absolute_uri(f'/reset-hasla?uid={uid}&token={token}')
            send_mail(
                'Siłownik - ustawienie nowego hasła',
                f'Cześć {user.username},\n\nktoś (prawdopodobnie Ty) poprosił o zmianę hasła. '
                f'Aby ustawić nowe hasło, otwórz link:\n\n{link}\n\n'
                'Link jest ważny 24 godziny i działa jednorazowo. Jeżeli to nie Ty, zignoruj tę wiadomość.',
                None, [user.email],
            )
            if settings.DEBUG:
                # treść e-maila w konsoli jest zakodowana (quoted-printable) - wypisujemy czysty link
                print(f'[DEV] Link do zmiany hasła dla {user.username}: {link}', flush=True)
        return Response({'detail': 'Jeżeli konto z tym adresem istnieje, wysłaliśmy na nie link do zmiany hasła.'})


class PasswordChangeAPIView(AuthThrottleMixin, APIView):
    """Zmiana hasła przez zalogowanego użytkownika (WF-01); sesja pozostaje aktywna."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.contrib.auth import update_session_auth_hash
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        user = request.user
        if not user.check_password(request.data.get('old_password') or ''):
            return Response({'old_password': ['Obecne hasło jest nieprawidłowe.']}, status=400)
        new, new2 = request.data.get('new_password') or '', request.data.get('new_password2') or ''
        if new != new2:
            return Response({'new_password2': ['Hasła nie są identyczne.']}, status=400)
        try:
            validate_password(new, user)
        except DjangoValidationError as exc:
            return Response({'new_password': list(exc.messages)}, status=400)
        user.set_password(new)
        user.save()
        update_session_auth_hash(request, user)
        return Response({'detail': 'Hasło zostało zmienione.'})


class PasswordResetConfirmAPIView(AuthThrottleMixin, APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        user.set_password(serializer.validated_data['password'])
        user.save()  # zmiana hasła unieważnia token - link działa jednorazowo
        return Response({'detail': 'Hasło zostało zmienione. Możesz się zalogować.'})


class PublicProfileAPIView(APIView):
    """Profil innego użytkownika według jego ustawień widoczności (WF-04, WF-21).
    Profil prywatny pokazuje innym tylko nazwę, zdjęcie i stan obserwowania - bez planów i statystyk."""
    permission_classes = [IsAuthenticated]

    def get(self, request, username):
        # moderator widzi także profile niepubliczne i zablokowane - potrzebne przy rozpatrywaniu zgłoszeń
        moderator = request.user.is_staff
        user = User.objects.filter(username__iexact=username, **({} if moderator else {'is_active': True})).first()
        if not user:
            raise Http404
        ensure_profiles(user)
        own = user.id == request.user.id
        rel = social.relation(request.user, user)
        # profil prywatny: inni widzą tylko nazwę i zdjęcie (żeby dało się obserwować i odwzajemnić
        # obserwowanie); osoby obserwowane wzajemnie widzą także udostępnione treningi
        full = own or moderator or user.profile.profile_public
        if not full:
            return Response({
                'username': user.username, 'avatar_url': avatars.avatar_url_for(user), 'restricted': True,
                'is_own': False, 'profile_public': False, 'relation': rel, 'counts': social.counts(user),
                'can_see_workouts': rel['mutual'], 'plans': [], 'trainings': None,
            })
        plans = user.created_plans.filter(is_public=True, is_hidden=False).order_by('-created_at')
        data = {
            'username': user.username,
            'avatar_url': avatars.avatar_url_for(user),
            'member_since': user.date_joined.date().isoformat(),
            'level': user.profile.get_level_display(),
            'goal': user.profile.get_goal_display(),
            'is_own': own,
            'restricted': False,
            'relation': rel,
            'counts': social.counts(user),
            'can_see_workouts': True,
            'profile_public': user.profile.profile_public,
            'trainings_public': user.profile.trainings_public,
            'plans': WorkoutPlanSerializer(plans, many=True, context={'request': request}).data,
            'trainings': None,
        }
        if own or user.profile.trainings_public:
            sessions = WorkoutSession.objects.filter(user=user)
            since = timezone.now() - timedelta(days=30)
            data['trainings'] = {
                'total_sessions': sessions.count(),
                'sessions_30_days': sessions.filter(date_completed__gte=since).count(),
                'weekly_tonnage': analytics.weekly_tonnage(user, weeks=8),
                'records': [{'exercise': r['exercise'], 'e1rm': r['e1rm']}
                            for r in analytics.personal_records(user)[:5]],
            }
        return Response(data)


class ExportAPIView(APIView):
    """Eksport wszystkich danych użytkownika w formacie JSON (WF-05, art. 20 RODO)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        ensure_profiles(user)
        ctx = {'request': request}
        data = {
            'exported_at': timezone.now().isoformat(),
            'account': UserSerializer(user).data,
            'profile': ProfileSerializer(user.profile).data,
            'plans': WorkoutPlanSerializer(user.created_plans.all(), many=True, context=ctx).data,
            'sessions': WorkoutSessionSerializer(user.sessions.all(), many=True, context=ctx).data,
            'measurements': BodyMeasurementSerializer(user.measurements.all(), many=True).data,
            'strength_tests': StrengthTestSerializer(user.strength_tests.all(), many=True).data,
            'comments': PlanCommentSerializer(user.plan_comments.all(), many=True).data,
        }
        response = HttpResponse(json.dumps(data, ensure_ascii=False, indent=2, default=str),
                                content_type='application/json; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="dane-{user.username}.json"'
        return response


class ProfileAPIView(APIView):
    """Profil treningowy i ankieta zdrowotna (WF-02 - WF-04)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_profiles(request.user)
        return Response(ProfileSerializer(request.user.profile).data)

    def put(self, request):
        ensure_profiles(request.user)
        serializer = ProfileSerializer(request.user.profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        request.user.refresh_from_db()
        return Response(ProfileSerializer(request.user.profile).data)

    patch = put


class MetaAPIView(APIView):
    """Słowniki dla formularzy frontendu."""
    permission_classes = [AllowAny]

    def get(self, request):
        def pairs(choices):
            return [{'value': value, 'label': label} for value, label in choices]

        return Response({
            'equipment': pairs(Equipment.choices),
            'goals': pairs(Goal.choices),
            'levels': pairs(Level.choices),
            'load_types': pairs(LoadType.choices),
            'test_protocols': pairs(StrengthTest.PROTOCOLS),
            'body_areas': BodyAreaSerializer(BodyArea.objects.all(), many=True).data,
            'muscle_groups': sorted(set(Exercise.objects.values_list('muscle_group', flat=True))),
        })

class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):  # generowanie dokumentacji API - brak użytkownika
            return self.serializer_class.Meta.model.objects.none()
        return Notification.objects.filter(user=self.request.user)[:30]

    @action(detail=False, methods=['post'])
    def read(self, request):
        Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
        return Response(status=204)


# =============================================================================
#  ZDJĘCIE PROFILOWE
# =============================================================================

class AvatarAPIView(APIView):
    """Wysłanie (POST, pole „file”) i usunięcie (DELETE) własnego zdjęcia profilowego."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'Wybierz plik ze zdjęciem.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            url = avatars.save(request.user, upload)
        except avatars.AvatarError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'avatar_url': url})

    def delete(self, request):
        avatars.remove(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


def avatar_image(request, user_id):
    """Obrazek zdjęcia profilowego (dla zalogowanych). Adres zawiera wersję (?v=...), więc
    przeglądarka może trzymać go w pamięci na stałe - po zmianie zdjęcia zmienia się adres."""
    if not request.user.is_authenticated:
        return HttpResponse(status=403)
    avatar = Avatar.objects.filter(user_id=user_id).first()
    if not avatar:
        raise Http404
    response = HttpResponse(bytes(avatar.image), content_type='image/webp')
    response['Cache-Control'] = 'private, max-age=31536000, immutable'
    return response
