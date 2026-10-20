"""Serwowanie aplikacji React (SPA), plików PWA i kontrola stanu serwera."""
import json
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.http import FileResponse, Http404, JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.generic import TemplateView

# =============================================================================
#  APLIKACJA REACT (SPA) + PWA
# =============================================================================

DIST_DIR = Path(settings.FRONTEND_DIST)


def vite_assets():
    """Pliki startowe frontendu; na produkcji manifest czytany raz (zmienia się tylko przy wdrożeniu)."""
    return _read_manifest() if not settings.DEBUG else _read_manifest.__wrapped__()


@lru_cache(maxsize=1)
def _read_manifest():
    """Odczytuje manifest Vite, aby dołączyć pliki z hashem w nazwie."""
    manifest_path = DIST_DIR / '.vite' / 'manifest.json'
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    entry = manifest.get('index.html') or next(v for v in manifest.values() if v.get('isEntry'))
    return {'js': entry['file'], 'css': entry.get('css', [])}


@method_decorator(never_cache, name='dispatch')
class SPAView(TemplateView):
    template_name = 'training/react_app.html'

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['assets'] = vite_assets()
        return ctx


def service_worker(request):
    path = DIST_DIR / 'sw.js'
    if not path.exists():
        raise Http404
    response = FileResponse(open(path, 'rb'), content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache'
    return response


def web_manifest(request):
    path = DIST_DIR / 'manifest.webmanifest'
    if not path.exists():
        raise Http404
    return FileResponse(open(path, 'rb'), content_type='application/manifest+json')


@never_cache
def health(request):
    """Kontrola stanu dla Dockera / monitoringu: aplikacja działa i ma połączenie z bazą."""
    try:
        connection.ensure_connection()
    except Exception:
        return JsonResponse({'status': 'error', 'database': False}, status=503)
    assets = vite_assets()
    # version = nazwa pliku startowego frontendu (z hashem) - aplikacja porównuje ją ze swoją,
    # aby po wdrożeniu nowej wersji zaproponować odświeżenie
    return JsonResponse({'status': 'ok', 'database': True, 'version': assets['js'] if assets else None})
