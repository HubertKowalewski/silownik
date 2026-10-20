"""Import historii treningów z pliku CSV (eksport Strong, Hevy albo własny szablon).

Użycie:
    python manage.py importuj_csv --user eksu --plik strong_export.csv

Ponowny import tego samego pliku nie tworzy duplikatów.
"""
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from training.importers import import_csv


class Command(BaseCommand):
    help = 'Importuje historię treningów z pliku CSV na konto użytkownika.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True)
        parser.add_argument('--plik', required=True)

    def handle(self, *args, **opts):
        user = User.objects.filter(username=opts['user']).first()
        if not user:
            raise CommandError(f'Nie ma użytkownika „{opts["user"]}”.')
        path = Path(opts['plik'])
        if not path.exists():
            raise CommandError(f'Nie znaleziono pliku {path}.')
        raw = path.read_bytes()
        text = next((raw.decode(enc) for enc in ('utf-8-sig', 'cp1250', 'latin-1') if self._decodes(raw, enc)), '')
        try:
            result = import_csv(user, text)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(
            f"Format: {result['format']}. Zaimportowano treningów: {result['sessions_created']} "
            f"({result['sets_created']} serii). Pominięto już istniejące: {result['sessions_skipped_duplicates']}, "
            f"wiersze bez powtórzeń: {result['rows_skipped']}."))
        if result['exercises_created']:
            self.stdout.write('Dodano ćwiczenia własne (brak odpowiednika w bazie): '
                              + ', '.join(result['exercises_created']))

    @staticmethod
    def _decodes(raw, encoding):
        try:
            raw.decode(encoding)
            return True
        except UnicodeDecodeError:
            return False
