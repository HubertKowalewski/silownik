# Obraz produkcyjny aplikacji Siłownik: frontend budowany w Node, serwowany przez Django + WhiteNoise.

# --- 1. budowa frontendu ---------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- 2. backend ------------------------------------------------------------------
FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_DEBUG=0 \
    DJANGO_STATIC_ROOT=/app/backend/staticfiles
WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
# collectstatic wymaga jakiegokolwiek klucza - prawdziwy podaje się przy uruchomieniu
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput \
    && useradd --system --uid 1000 silownik && chown -R silownik /app
USER silownik

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/ping/')" || exit 1
ENTRYPOINT ["sh", "/app/backend/deploy/entrypoint.sh"]
