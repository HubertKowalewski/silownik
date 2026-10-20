"""Punkt wejścia WSGI (gunicorn).

Widoki (i ciężkie biblioteki: pandas, NumPy, ReportLab) są ładowane od razu, a nie przy pierwszym
żądaniu. Z opcją gunicorna --preload dzieje się to raz w procesie głównym, a procesy obsługujące
żądania współdzielą tę pamięć - ważne na darmowym hostingu z 512 MB RAM. Pierwsze żądanie po
uruchomieniu serwera też jest dzięki temu szybsze.
"""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

application = get_wsgi_application()

from django.urls import get_resolver  # noqa: E402

_ = get_resolver().url_patterns   # import wszystkich widoków (i ich zależności) przy starcie
