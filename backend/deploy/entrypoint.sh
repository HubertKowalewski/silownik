#!/bin/sh
# Start kontenera: migracje bazy, konto administratora, serwer aplikacji gunicorn.
set -e
python manage.py migrate --noinput
if [ -n "$DJANGO_SUPERUSER_USERNAME" ] && [ -n "$DJANGO_SUPERUSER_PASSWORD" ]; then
    # pierwsze konto administratora (pomijane, jeśli już istnieje)
    python manage.py createsuperuser --noinput --email "${DJANGO_SUPERUSER_EMAIL:-admin@localhost}" 2>/dev/null || true
fi
# PORT podaje hosting (np. Render); domyślnie 8000 (docker compose).
# --preload: kod aplikacji (Django, pandas) ładowany raz i współdzielony przez procesy - mniej pamięci,
# co ma znaczenie na darmowym serwerze z 512 MB RAM. Wątki obsługują równoległe żądania jednego procesu.
exec gunicorn core.wsgi:application \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${GUNICORN_WORKERS:-2}" \
    --threads "${GUNICORN_THREADS:-4}" \
    --preload \
    --timeout 90 \
    --access-logfile - \
    --forwarded-allow-ips "*"
