"""Odpowiedzi dla monitoringu, obsługiwane przed resztą aplikacji.

- /api/ping/   - aplikacja żyje; NIE łączy się z bazą, więc częste pingi (kontrola stanu na hostingu,
                 serwis podtrzymujący darmowy serwer w gotowości) nie wybudzają usypianej bazy w chmurze,
- /api/health/ - aplikacja działa i ma połączenie z bazą (+ wersja frontendu dla banera aktualizacji).

Obie działają także dla nieznanego nagłówka Host (spoza ALLOWED_HOSTS): kontrole stanu na hostingu
(Docker, Render) przychodzą na wewnętrzny adres kontenera, a nie na publiczną domenę.
"""
from django.core.exceptions import DisallowedHost
from django.http import JsonResponse


class ProbeMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == '/api/ping/':
            response = JsonResponse({'status': 'ok'})
            response['Cache-Control'] = 'no-store'
            return response
        if request.path == '/api/health/':
            try:
                request.get_host()
            except DisallowedHost:
                from training.views.spa import health
                return health(request)   # adres wewnętrzny - odpowiedź bez reszty łańcucha middleware
        return self.get_response(request)


class SessionRefreshMiddleware:
    """Przedłuża sesję zalogowanego użytkownika raz na dobę - kto korzysta z aplikacji regularnie,
    nie jest wylogowywany, a sesja nie jest zapisywana do bazy przy każdym żądaniu."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        session = getattr(request, 'session', None)
        user = getattr(request, 'user', None)
        if session is not None and user is not None and user.is_authenticated and not session.modified:
            from django.utils import timezone
            today = timezone.localdate().isoformat()
            if session.get('_refreshed') != today:
                session['_refreshed'] = today   # zmiana -> SessionMiddleware odświeży ważność ciasteczka
        return response
