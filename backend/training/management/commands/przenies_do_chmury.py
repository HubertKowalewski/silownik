"""Kopiuje wszystkie dane z obecnej bazy (np. lokalnej SQLite na komputerze) do bazy w chmurze.

Użycie (PowerShell, w katalogu backend, z aktywnym .venv):
    python manage.py przenies_do_chmury --cel "postgresql://...neon.tech/neondb?sslmode=require"

Kroki: 1) w bazie docelowej tworzone są tabele (migracje), 2) dane z bazy lokalnej są zapisywane do
pliku JSON (UTF-8), 3) plik jest wgrywany do bazy docelowej. Konta, plany, treningi, pomiary, testy,
cele i ustawienia przechodzą 1:1 (z tymi samymi numerami), hasła działają dalej.

Baza docelowa powinna być pusta - komenda odmawia, jeśli są w niej już konta (np. utworzone przez
uruchomioną wcześniej aplikację), bo rekordy o tych samych numerach zostałyby nadpisane. --wymus
pozwala mimo to kontynuować.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

# dane techniczne odtwarzane przez migracje albo zbędne w kopii
EXCLUDE = ['contenttypes', 'auth.permission', 'sessions', 'admin.logentry']


class Command(BaseCommand):
    help = 'Kopiuje wszystkie dane z obecnej bazy do bazy w chmurze (PostgreSQL, np. Neon).'

    def add_arguments(self, parser):
        parser.add_argument('--cel', required=True, help='adres bazy docelowej: postgresql://...')
        parser.add_argument('--wymus', action='store_true', help='kopiuj także do bazy, w której są już konta')

    def handle(self, *args, **opts):
        target = opts['cel'].strip()
        if not target.startswith(('postgres://', 'postgresql://')):
            raise CommandError('Podaj adres bazy PostgreSQL zaczynający się od postgresql:// (z panelu Neon: Connect).')

        manage = Path(settings.BASE_DIR) / 'manage.py'
        env = {**os.environ, 'DATABASE_URL': target, 'PYTHONUTF8': '1'}

        def run(*cmd):
            result = subprocess.run([sys.executable, str(manage), *cmd], env=env, capture_output=True, text=True,
                                    encoding='utf-8')
            if result.returncode != 0:
                raise CommandError(f'Polecenie {" ".join(cmd[:1])} w bazie docelowej nie powiodło się:\n'
                                   f'{(result.stderr or result.stdout).strip()[-1500:]}')
            return result.stdout

        self.stdout.write('1/3 Przygotowuję bazę w chmurze (tworzenie tabel)...')
        run('migrate', '--noinput')
        users = run('shell', '-c', 'from django.contrib.auth.models import User; print(User.objects.count())')
        if int(users.strip().splitlines()[-1] or 0) and not opts['wymus']:
            raise CommandError('W bazie docelowej są już konta. Kopiuj do pustej bazy (najlepiej przed pierwszym '
                               'uruchomieniem aplikacji w chmurze) albo użyj --wymus.')

        self.stdout.write('2/3 Zapisuję kopię danych z bazy lokalnej...')
        fd, path = tempfile.mkstemp(suffix='.json', prefix='silownik-kopia-')
        os.close(fd)
        try:
            with open(path, 'w', encoding='utf-8') as stream:   # UTF-8 także na Windowsie (polskie znaki)
                call_command('dumpdata', natural_foreign=True, natural_primary=True, exclude=EXCLUDE,
                             stdout=stream, verbosity=0)
            self.stdout.write('3/3 Wgrywam dane do bazy w chmurze...')
            loaded = run('loaddata', path).strip().splitlines()
        finally:
            os.unlink(path)

        self.stdout.write(self.style.SUCCESS(
            f'Gotowe: {loaded[-1] if loaded else "dane skopiowane"}. Zaloguj się w aplikacji w chmurze '
            'tym samym kontem i hasłem co na komputerze.'))
