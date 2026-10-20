"""Ustawienia projektu.

Wartości wrażliwe (SECRET_KEY, hasła) i zależne od środowiska (DEBUG, ALLOWED_HOSTS, baza danych)
są odczytywane ze zmiennych środowiskowych (WN-07) - lista w pliku .env.example.
Domyślne wartości służą wyłącznie do pracy lokalnej (SQLite, DEBUG, poczta w konsoli).
"""
import os
import sys
import warnings
from pathlib import Path

import dj_database_url
from django.utils.csp import CSP


def env_list(name: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, '').split(',') if item.strip()]


BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY')
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError('Ustaw zmienną środowiskową DJANGO_SECRET_KEY.')
    SECRET_KEY = 'dev-only-insecure-key-nie-uzywac-na-produkcji'

def local_ips() -> list[str]:
    """Adresy tego komputera w sieci lokalnej - telefon w tym samym Wi-Fi otworzy aplikację pod http://<adres>:8000."""
    import socket
    try:
        return socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        return []


ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS')
# Render.com podaje publiczny adres usługi (np. silownik.onrender.com) w zmiennej środowiskowej
RENDER_HOST = os.environ.get('RENDER_EXTERNAL_HOSTNAME', '')
if RENDER_HOST:
    ALLOWED_HOSTS.append(RENDER_HOST)
if DEBUG:
    # tryb deweloperski: komputer, telefon w tej samej sieci Wi-Fi i tymczasowy tunel HTTPS (cloudflared)
    ALLOWED_HOSTS += ['localhost', '127.0.0.1', 'testserver', '.trycloudflare.com', *local_ips()]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'drf_spectacular',
    'drf_spectacular_sidecar',  # pliki Swagger UI lokalnie - bez zewnętrznych CDN
    'training',
]

MIDDLEWARE = [
    'core.middleware.ProbeMiddleware',   # /api/ping/ i /api/health/ - przed sprawdzaniem hosta i HTTPS
    'django.middleware.security.SecurityMiddleware',
    # pliki statyczne (w tym zbudowany frontend) serwowane z kompresją i długim cache - bez osobnego serwera
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'core.middleware.SessionRefreshMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'django.middleware.csp.ContentSecurityPolicyMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

WSGI_APPLICATION = 'core.wsgi.application'

# DATABASE_URL, np. postgres://silownik:haslo@db:5432/silownik; bez zmiennej - lokalny plik SQLite
DATABASES = {
    'default': dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        # baza w chmurze usypiana bez ruchu (Neon) - krótszy czas trzymania połączenia: DJANGO_DB_CONN_MAX_AGE=60
        conn_max_age=int(os.environ.get('DJANGO_DB_CONN_MAX_AGE', '600')), conn_health_checks=True),
}
# Pula połączeń (np. Neon „-pooler”, PgBouncer w trybie transakcji) nie obsługuje kursorów po stronie serwera
if '-pooler' in DATABASES['default'].get('HOST', '') or os.environ.get('DJANGO_DB_POOLER') == '1':
    DATABASES['default']['DISABLE_SERVER_SIDE_CURSORS'] = True

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'pl'
TIME_ZONE = 'Europe/Warsaw'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = Path(os.environ.get('DJANGO_STATIC_ROOT', BASE_DIR / 'staticfiles'))
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    # pliki z hashem w nazwie + gzip/brotli; w testach zwykły magazyn (bez collectstatic)
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage' if DEBUG or 'test' in sys.argv
                    else 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}

# Lokalnie (DEBUG) pliki statyczne są czytane bezpośrednio z katalogów źródłowych - bez collectstatic
WHITENOISE_USE_FINDERS = DEBUG or 'test' in sys.argv
WHITENOISE_AUTOREFRESH = DEBUG
if WHITENOISE_USE_FINDERS:
    warnings.filterwarnings('ignore', message='No directory at', module='whitenoise.base')

# Pliki Vite z hashem w nazwie (assets/index-AbC123.js) mogą zostać w cache przeglądarki na stałe
WHITENOISE_IMMUTABLE_FILE_TEST = r'^.+/assets/.+-[0-9A-Za-z_-]{8,}\.(js|css|woff2?|png|svg)$'

# Zbudowany frontend (npm run build) leży w katalogu frontend/dist i jest serwowany
# pod adresem /static/dist/. Kod backendu nie zawiera żadnych plików interfejsu.
FRONTEND_DIST = BASE_DIR.parent / 'frontend' / 'dist'
STATICFILES_DIRS = [('dist', FRONTEND_DIST)]

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework.authentication.SessionAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'DEFAULT_SCHEMA_CLASS': 'training.schema.SilownikSchema',
    'PAGE_SIZE': 50,
    # limit prób logowania, rejestracji i resetu hasła - ochrona przed zgadywaniem haseł (WN-07);
    # podczas testów automatycznych limit jest wyłączony, bo testy zakładają wiele kont w krótkim czasie
    'DEFAULT_THROTTLE_RATES': {'auth': '10000/min' if 'test' in sys.argv else '10/min'},
}

# Dokumentacja API (OpenAPI 3): /api/docs/ - dostępna dla kont personelu (lokalnie dla wszystkich)
SPECTACULAR_SETTINGS = {
    'TITLE': 'Siłownik - REST API',
    'DESCRIPTION': 'Interfejs aplikacji do planowania treningu siłowego i analizy postępów. '
                   'Uwierzytelnianie sesją Django; zapytania modyfikujące wymagają nagłówka X-CSRFToken.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'SERVE_PERMISSIONS': ['rest_framework.permissions.AllowAny' if DEBUG else 'rest_framework.permissions.IsAdminUser'],
    'SWAGGER_UI_DIST': 'SIDECAR',
    'SWAGGER_UI_FAVICON_HREF': 'SIDECAR',
    'COMPONENT_SPLIT_REQUEST': True,
}

CSRF_TRUSTED_ORIGINS = env_list('DJANGO_CSRF_ORIGINS')
if RENDER_HOST:
    CSRF_TRUSTED_ORIGINS.append(f'https://{RENDER_HOST}')
if DEBUG:
    CSRF_TRUSTED_ORIGINS += ['http://localhost:5173', 'http://127.0.0.1:5173',
                             'http://localhost:8000', 'http://127.0.0.1:8000', 'https://*.trycloudflare.com']

# Poczta: w trybie deweloperskim wiadomości (np. link do zmiany hasła) są wypisywane w konsoli serwera.
if os.environ.get('EMAIL_HOST'):
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = os.environ['EMAIL_HOST']
    EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
    EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
    EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
    EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', '1') == '1'
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'Siłownik <no-reply@localhost>')
PASSWORD_RESET_TIMEOUT = 60 * 60 * 24  # link ważny 24 godziny

SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_HTTPONLY = False  # React odczytuje token z ciasteczka
SESSION_COOKIE_HTTPONLY = True
# aplikacja na telefonie nie wylogowuje po 2 tygodniach: sesja ważna 90 dni, przedłużana raz na dobę
# przy korzystaniu z aplikacji (core.middleware.SessionRefreshMiddleware)
SESSION_COOKIE_AGE = int(os.environ.get('DJANGO_SESSION_DAYS', '90')) * 24 * 3600

SECURE_CONTENT_TYPE_NOSNIFF = True
# Content Security Policy: skrypty i połączenia tylko z własnej domeny (ochrona przed XSS).
# Style inline są dozwolone, bo biblioteki wykresów i animacji ustawiają atrybut style.
SECURE_CSP = {
    'default-src': [CSP.SELF],
    'script-src': [CSP.SELF],
    'style-src': [CSP.SELF, CSP.UNSAFE_INLINE],
    'img-src': [CSP.SELF, 'data:', 'blob:'],
    'font-src': [CSP.SELF, 'data:'],
    'connect-src': [CSP.SELF],
    'worker-src': [CSP.SELF],
    'manifest-src': [CSP.SELF],
    'object-src': [CSP.NONE],
    'base-uri': [CSP.SELF],
    'form-action': [CSP.SELF],
    'frame-ancestors': [CSP.NONE],
}
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # za odwrotnym proxy (Caddy/nginx) informacja o HTTPS przychodzi w nagłówku X-Forwarded-Proto
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = os.environ.get('DJANGO_SSL_REDIRECT', '1') == '1'
    SECURE_REDIRECT_EXEMPT = [r'^api/health/$']  # kontrola stanu kontenera po HTTP
    SECURE_HSTS_SECONDS = int(os.environ.get('DJANGO_HSTS_SECONDS', '31536000'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

# Dziennik: błędy i ostrzeżenia na standardowe wyjście (zbierane przez Dockera / systemd)
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'plain': {'format': '{asctime} {levelname} {name}: {message}', 'style': '{'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'}},
    'root': {'handlers': ['console'], 'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO')},
    'loggers': {'django.db.backends': {'level': 'WARNING'}},
}

# Administratorzy dostają e-mail z opisem błędu 500 (gdy skonfigurowano SMTP)
ADMINS = [('Administrator', email) for email in env_list('DJANGO_ADMINS')]
SERVER_EMAIL = DEFAULT_FROM_EMAIL
