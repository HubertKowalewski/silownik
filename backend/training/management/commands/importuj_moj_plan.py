"""Import 4 treningów (Push, Pull, Upper, Lower) przepisanych ze zrzutów ekranu z poprzedniej aplikacji.

Każdy trening trafia na konto jako osobny, prywatny plan z jedną jednostką - na ekranie treningu
wybierasz po prostu „Push”, „Pull”, „Upper” albo „Lower”.

Użycie:
    python manage.py importuj_moj_plan --user eksu --email hiimmodrzew.1@gmail.com
    python manage.py importuj_moj_plan --user eksu --nadpisz              # zastąpi wcześniej zaimportowane treningi
    python manage.py importuj_moj_plan --user eksu --historia             # zapisze też 4 wykonane treningi w historii
    python manage.py importuj_moj_plan --user eksu --historia --daty 2026-10-13,2026-10-14,2026-10-16,2026-10-17
    python manage.py importuj_moj_plan --user eksu --publiczny            # opublikuje treningi dla innych

Jeśli konta nie ma, a podano --email, zostanie założone (hasło z --haslo albo podane w konsoli).
Ciężar = najcięższy ciężar roboczy z ostatniego treningu, liczba powtórzeń = powtórzenia pierwszej serii.
Pełny przebieg ostatniego treningu jest w uwagach do ćwiczenia, np. „Ostatnio: 80×8, 80×6”.
Z opcją --historia te same serie trafiają do historii, więc od razu liczą się 1RM, rekordy i propozycje
ciężarów. Daty (--daty) podaje się w kolejności Push, Pull, Upper, Lower. Ponowne uruchomienie nie
tworzy duplikatów w historii.
"""
import getpass
import uuid
from datetime import date, datetime, time, timedelta

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from training import analytics
from training.analytics import recalculate_plan
from training.models import Exercise, ExerciseSet, PlanDay, PlanExercise, UserProfile, WorkoutPlan, WorkoutSession

LEGACY_TITLE = 'Mój plan 4-dniowy'   # dawna wersja importu - jeden plan z 4 dniami
HISTORY_NAMESPACE = uuid.UUID('0b7f6c52-3c1e-4f43-9a7e-5d2a8e61c9d4')

# (nazwa ćwiczenia w bazie - część angielska, przerwa [s], wykonane serie [(kg, powt.)]; kg 0 = masa ciała)
# Każdy trening: (nazwa, opis, czas trwania ostatniego treningu [s], ćwiczenia)
DAYS = [
    ('Push', 'klatka, barki, triceps', 2 * 3600 + 1 * 60 + 56, [
        ('Incline dumbbell bench press', 180, [(34, 8), (36, 7), (36, 6)]),
        ('Dips – chest version', 120, [(10, 8), (10, 7), (10, 6)]),
        ('Pec dec fly', 90, [(79, 8), (79, 8), (79, 8)]),
        ('Seated overhead dumbbell press', 120, [(24, 8), (24, 8), (24, 8)]),
        ('One arm cable lateral raise', 60, [(6.8, 8), (6.8, 8), (6.8, 8)]),
        ('Skull crusher', 90, [(32.5, 8), (32.5, 8), (32.5, 8)]),
        ('Cable bar triceps extension', 90, [(29.5, 8), (29.5, 8), (29.5, 8)]),
    ]),
    ('Pull', 'plecy, biceps', 1 * 3600 + 22 * 60 + 6, [
        ('Dumbbell row – hand supported on bench', 120, [(35, 8), (35, 8), (35, 8)]),
        ('Lat pulldown', 120, [(59, 8), (59, 8), (59, 8)]),
        ('Cable row', 120, [(68, 8), (68, 8), (68, 8)]),
        ('Cable pullover', 90, [(54, 8), (61, 8), (54, 12)]),
        ('Rear delt machine', 90, [(54, 8), (54, 8), (54, 8)]),
        ('Seated incline dumbbell biceps curl', 90, [(15, 8), (15, 8)]),
        ('Hammer curl', 90, [(17.5, 8), (17.5, 8)]),
        ('Dumbbell shrugs', 90, [(27.5, 10), (27.5, 10), (27.5, 10)]),
    ]),
    ('Upper', 'góra ciała - siła', 1 * 3600 + 44 * 60 + 9, [
        ('Barbell bench press', 180, [(80, 8), (80, 8), (80, 6), (80, 5)]),
        ('Bent over barbell row', 180, [(90, 6), (80, 10), (80, 9), (80, 8)]),
        ('Military press', 180, [(47.5, 6), (47.5, 7), (47.5, 6)]),
        ('Pull ups', 120, [(0, 8), (0, 8), (0, 8)]),
        ('Lateral raise', 60, [(10, 10), (10, 10), (10, 10), (10, 10)]),
        ('Face pull', 90, [(27.3, 10), (27.3, 10), (27.3, 10)]),
        ('Barbell biceps curl', 90, [(35, 8), (35, 8), (35, 8)]),
        ('Cable rope triceps extension', 90, [(29.5, 8), (31.8, 8), (31.8, 8)]),
    ]),
    ('Lower', 'nogi, brzuch', 2 * 3600 + 24 * 60 + 17, [
        ('Back squat', 180, [(85, 6), (85, 5), (85, 5), (85, 5)]),
        ('Romanian deadlift', 180, [(100, 8), (110, 8), (110, 6), (110, 6)]),
        ('Leg press', 120, [(100, 8), (100, 8), (100, 8)]),
        ('Lying leg curl machine', 90, [(45, 8), (54, 8), (54, 8)]),
        ('Leg extensions', 90, [(43, 8), (43, 8), (43, 8)]),
        ('Standing calf raise machine', 90, [(80, 10), (90, 10), (90, 10), (90, 10)]),
        ('Hanging leg raise', 90, [(0, 12), (0, 12), (0, 12)]),
        ('Cable crunch', 60, [(31.5, 10), (33.8, 10), (33.8, 10)]),
    ]),
]

# ćwiczenia, w których ciężar oznacza dociążenie do masy ciała
ADDED_WEIGHT = {'Dips – chest version'}


def fmt(sets):
    return ', '.join(f"{f'{kg:g}'.replace('.', ',')}×{reps}" if kg else f'{reps}' for kg, reps in sets)


class Command(BaseCommand):
    help = 'Importuje treningi Push, Pull, Upper i Lower (przepisane ze zrzutów ekranu) na konto użytkownika.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='nazwa użytkownika, np. eksu')
        parser.add_argument('--email', help='adres e-mail konta (ustawiany; przy nowym koncie wymagany)')
        parser.add_argument('--haslo', help='hasło nowego konta (bez tej opcji zostanie zadane w konsoli)')
        parser.add_argument('--nadpisz', action='store_true', help='usuń wcześniej zaimportowane treningi i utwórz je od nowa')
        parser.add_argument('--publiczny', action='store_true', help='opublikuj treningi dla innych użytkowników')
        parser.add_argument('--historia', action='store_true', help='zapisz też 4 wykonane treningi w historii')
        parser.add_argument('--daty', help='daty 4 treningów (Push, Pull, Upper, Lower) w formacie RRRR-MM-DD, po przecinku; '
                                           'domyślnie 4 ostatnie dni')

    def find_exercise(self, english):
        match = Exercise.objects.filter(name__iendswith=f' / {english}', created_by__isnull=True).first() \
            or Exercise.objects.filter(name__iendswith=f' / {english}').first()
        if not match:
            raise CommandError(f'Nie znaleziono w bazie ćwiczenia „{english}”. Uruchom najpierw: python manage.py migrate')
        return match

    def get_user(self, opts):
        user = User.objects.filter(username=opts['user']).first()
        email = (opts.get('email') or '').strip()
        if user:
            if email and user.email.lower() != email.lower():
                if User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
                    raise CommandError(f'Adres {email} ma już inne konto.')
                user.email = email
                user.save(update_fields=['email'])
                self.stdout.write(f'Ustawiono e-mail konta {user.username}: {email}')
            return user
        if not email:
            names = ', '.join(User.objects.values_list('username', flat=True)) or 'brak kont'
            raise CommandError(f'Nie ma użytkownika „{opts["user"]}” (dostępne: {names}). '
                               'Podaj --email, aby założyć nowe konto.')
        if User.objects.filter(email__iexact=email).exists():
            raise CommandError(f'Adres {email} ma już inne konto.')
        password = opts.get('haslo') or getpass.getpass(f'Hasło dla nowego konta {opts["user"]}: ')
        user = User(username=opts['user'], email=email)
        try:
            validate_password(password, user)
        except ValidationError as e:
            raise CommandError('Hasło: ' + ' '.join(e.messages)) from e
        user.set_password(password)
        user.save()
        self.stdout.write(f'Założono konto {user.username} ({email}).')
        return user

    def dates(self, opts):
        if opts.get('daty'):
            try:
                days = [date.fromisoformat(d.strip()) for d in opts['daty'].split(',')]
            except ValueError as e:
                raise CommandError('Daty podaj w formacie RRRR-MM-DD, np. 2026-10-13,2026-10-14,2026-10-16,2026-10-17') from e
            if len(days) != len(DAYS):
                raise CommandError(f'Podaj {len(DAYS)} daty - po jednej dla treningów Push, Pull, Upper, Lower.')
        else:
            today = timezone.localdate()
            days = [today - timedelta(days=len(DAYS) - i) for i in range(len(DAYS))]
        tz = timezone.get_current_timezone()
        return [timezone.make_aware(datetime.combine(d, time(18, 0)), tz) for d in days]

    @transaction.atomic
    def handle(self, *args, **opts):
        user = self.get_user(opts)

        titles = [name for name, *_ in DAYS]
        existing = WorkoutPlan.objects.filter(creator=user, title__in=[*titles, LEGACY_TITLE])
        if existing.exists():
            if not opts['nadpisz']:
                names = ', '.join(sorted(existing.values_list('title', flat=True)))
                raise CommandError(f'Użytkownik {user.username} ma już treningi: {names}. '
                                   'Użyj --nadpisz, aby utworzyć je od nowa.')
            existing.delete()

        plans, plan_days = [], []
        for name, about, _duration, items in DAYS:
            plan = WorkoutPlan.objects.create(
                title=name, creator=user, is_public=opts['publiczny'],
                description=f'{name} - {about}. Trening przeniesiony z poprzedniej aplikacji; ciężary to najcięższe '
                            'serie robocze z ostatniego wykonania, pełny przebieg serii jest w uwagach do ćwiczeń.',
                goal='hypertrophy', level='intermediate', days_per_week=1, duration_weeks=8,
                required_equipment=['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'],
            )
            day = PlanDay.objects.create(plan=plan, week=1, order=0, name=name)
            for i, (english, rest, sets) in enumerate(items):
                top = max(kg for kg, _ in sets)
                prefix = 'Masa ciała. ' if top == 0 else 'Ciężar = dociążenie do masy ciała. ' if english in ADDED_WEIGHT else ''
                PlanExercise.objects.create(
                    plan=plan, day=day, exercise=self.find_exercise(english), order=i,
                    target_sets=len(sets), target_reps=sets[0][1],
                    load_type='kg', load_value=top, rest_seconds=rest,
                    notes=f'{prefix}Ostatnio: {fmt(sets)}',
                )
            plans.append(plan)
            plan_days.append(day)
            self.stdout.write(f'  {name} ({about}): {len(items)} ćwiczeń')

        if opts['historia']:
            self.import_history(user, plans, plan_days, self.dates(opts))

        # 4 treningi w cyklu - tyle dni w tygodniu pokazuje pulpit w „Planie na ten tydzień”
        UserProfile.objects.filter(user=user).update(days_per_week=len(DAYS))

        for plan in plans:
            recalculate_plan(plan, user)
        self.stdout.write(self.style.SUCCESS(
            f'Gotowe: treningi {", ".join(titles)} dodane do konta {user.username}'
            + (' (widoczne publicznie).' if opts['publiczny'] else ' (prywatne - widzisz je tylko Ty).')))

    def import_history(self, user, plans, plan_days, when):
        created, touched = 0, set()
        for (day_name, _about, duration, items), plan, day, done_at in zip(DAYS, plans, plan_days, when, strict=True):
            client_uuid = uuid.uuid5(HISTORY_NAMESPACE, f'{user.id}|{done_at.date().isoformat()}|{day_name}')
            existing = WorkoutSession.objects.filter(client_uuid=client_uuid).first()
            if existing:
                # trening mógł zostać utworzony od nowa (--nadpisz) - podepnij historię pod nowy
                WorkoutSession.objects.filter(pk=existing.pk).update(plan=plan, plan_day=day)
                continue
            session = WorkoutSession.objects.create(
                user=user, plan=plan, plan_day=day, date_completed=done_at, client_uuid=client_uuid,
                duration_seconds=duration, notes='Przeniesione z poprzedniej aplikacji treningowej.')
            objs = []
            for english, _rest, sets in items:
                exercise = self.find_exercise(english)
                touched.add(exercise.id)
                objs += [ExerciseSet(session=session, exercise=exercise, set_number=n, weight=kg, reps=reps)
                         for n, (kg, reps) in enumerate(sets, start=1)]
            ExerciseSet.objects.bulk_create(objs)
            created += 1
        for exercise_id in touched:
            analytics.recompute_record(user, exercise_id)
        self.stdout.write(f'  Historia: dodano treningów: {created}'
                          + (f' (pominięto już zapisane: {len(DAYS) - created})' if created < len(DAYS) else ''))
