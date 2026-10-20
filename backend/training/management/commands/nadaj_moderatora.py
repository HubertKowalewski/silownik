"""Nadaje (lub odbiera) uprawnienia moderatora: python manage.py nadaj_moderatora <login> [--odbierz]."""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Nadaje kontu uprawnienia moderatora (dostęp do panelu moderacji i panelu administratora).'

    def add_arguments(self, parser):
        parser.add_argument('username')
        parser.add_argument('--odbierz', action='store_true', help='odbiera uprawnienia moderatora')

    def handle(self, username, odbierz, **options):
        user = User.objects.filter(username=username).first()
        if user is None:
            raise CommandError(f'Nie ma użytkownika {username}.')
        user.is_staff = not odbierz
        user.save(update_fields=['is_staff'])
        self.stdout.write(self.style.SUCCESS(
            f'{username}: ' + ('uprawnienia moderatora odebrane.' if odbierz else 'nadano uprawnienia moderatora.')))
