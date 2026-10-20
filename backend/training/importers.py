"""Import historii treningów z plików CSV innych aplikacji.

Obsługiwane formaty (rozpoznawane po nagłówkach kolumn):
- Strong:  Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, ..., RPE
- Hevy:    title, start_time, end_time, exercise_title, set_index, set_type, weight_kg, reps, ..., rpe
- szablon: date, workout, exercise, weight, reps, rir (opcjonalnie: rpe, warmup, notes)

Import jest idempotentny (WN-04): każda sesja otrzymuje identyfikator client_uuid wyliczany
deterministycznie z użytkownika, daty i nazwy treningu, więc ponowny import tego samego
pliku pomija już zaimportowane sesje zamiast tworzyć duplikaty.
"""
from __future__ import annotations

import csv
import io
import re
import uuid
from collections import OrderedDict
from contextlib import suppress
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from . import analytics
from .models import Exercise, ExerciseSet, WorkoutSession

IMPORT_NAMESPACE = uuid.UUID('6f1c1d0e-8b4a-4c55-9b39-1d8f0e7a2b11')
LBS_TO_KG = 0.45359237

# Nazwy ćwiczeń z innych aplikacji -> angielska część nazwy w bazie ćwiczeń.
# Klucze są znormalizowane (małe litery, bez znaków specjalnych, nawias = sprzęt).
NAME_MAP = {
    'bench press': 'Barbell bench press', 'bench press barbell': 'Barbell bench press',
    'bench press dumbbell': 'Dumbbells bench press', 'dumbbell bench press': 'Dumbbells bench press',
    'incline bench press barbell': 'Incline barbell bench press', 'incline bench press': 'Incline barbell bench press',
    'incline bench press dumbbell': 'Incline dumbbell bench press', 'incline dumbbell press': 'Incline dumbbell bench press',
    'decline bench press barbell': 'Decline barbell bench press',
    'chest dip': 'Dips – chest version', 'chest dips': 'Dips – chest version', 'dips': 'Dips – chest version',
    'triceps dip': 'Dips – triceps version',
    'machine fly': 'Pec dec fly', 'butterfly pec deck': 'Pec dec fly', 'chest fly machine': 'Pec dec fly',
    'pec deck': 'Pec dec fly', 'chest fly dumbbell': 'Dumbbells chest fly', 'chest fly': 'Dumbbells chest fly',
    'cable crossover': 'Low cable chest fly', 'push up': 'Push ups',
    'overhead press': 'Military press', 'overhead press barbell': 'Military press', 'military press': 'Military press',
    'shoulder press dumbbell': 'Seated overhead dumbbell press', 'dumbbell shoulder press': 'Seated overhead dumbbell press',
    'seated overhead press dumbbell': 'Seated overhead dumbbell press', 'arnold press dumbbell': 'Arnold press',
    'lateral raise': 'Lateral raise', 'lateral raise dumbbell': 'Lateral raise', 'dumbbell lateral raise': 'Lateral raise',
    'lateral raise cable': 'One arm cable lateral raise', 'one arm cable lateral raise': 'One arm cable lateral raise',
    'face pull': 'Face pull', 'face pull cable': 'Face pull',
    'rear delt fly cable': 'Cable rear delt fly', 'reverse fly cable': 'Cable rear delt fly',
    'skull crusher': 'Skull crusher', 'skullcrusher barbell': 'Skull crusher', 'skullcrusher dumbbell': 'Dumbbell skull crusher',
    'pushdown': 'Cable bar triceps extension', 'triceps pushdown': 'Cable bar triceps extension',
    'triceps pushdown cable straight bar': 'Cable bar triceps extension',
    'rope pushdown': 'Cable rope triceps extension', 'triceps rope pushdown': 'Cable rope triceps extension',
    'triceps pushdown cable rope': 'Cable rope triceps extension',
    'triceps extension dumbbell': 'Overhead dumbbell triceps extension',
    'barbell curl': 'Barbell biceps curl', 'bicep curl barbell': 'Barbell biceps curl', 'biceps curl barbell': 'Barbell biceps curl',
    'bicep curl dumbbell': 'Dumbbell supinated biceps curls', 'dumbbell curl': 'Dumbbell supinated biceps curls',
    'hammer curl': 'Hammer curl', 'hammer curl dumbbell': 'Hammer curl',
    'incline dumbbell curl': 'Seated incline dumbbell biceps curl', 'incline curl dumbbell': 'Seated incline dumbbell biceps curl',
    'barbell row': 'Bent over barbell row', 'bent over row barbell': 'Bent over barbell row', 'pendlay row barbell': 'Pendlay row',
    'one arm dumbbell row': 'Dumbbell row – hand supported on bench', 'bent over one arm row dumbbell': 'Dumbbell row – hand supported on bench',
    'dumbbell row': 'Dumbbell row – hand supported on bench',
    'lat pulldown': 'Lat pulldown', 'lat pulldown cable': 'Lat pulldown', 'lat pulldown machine': 'Lat pulldown',
    'seated row': 'Cable row', 'seated row cable': 'Cable row', 'seated cable row': 'Cable row',
    'straight arm lat pulldown': 'Cable pullover', 'straight arm pulldown': 'Cable pullover', 'straight arm pulldown cable': 'Cable pullover',
    'pull up': 'Pull ups', 'pullup': 'Pull ups', 'pull ups': 'Pull ups', 'chin up': 'Chin ups', 'chin ups': 'Chin ups',
    'shrug dumbbell': 'Dumbbell shrugs', 'dumbbell shrug': 'Dumbbell shrugs', 'shrug barbell': 'Barbell shrugs',
    'squat': 'Back squat', 'squat barbell': 'Back squat', 'back squat': 'Back squat', 'front squat barbell': 'Front squat',
    'front squat': 'Front squat', 'goblet squat': 'Goblet squat', 'goblet squat kettlebell': 'Goblet squat',
    'deadlift': 'Deadlift', 'deadlift barbell': 'Deadlift', 'conventional deadlift': 'Deadlift',
    'sumo deadlift': 'Sumo deadlift', 'sumo deadlift barbell': 'Sumo deadlift',
    'romanian deadlift': 'Romanian deadlift', 'romanian deadlift barbell': 'Romanian deadlift',
    'romanian deadlift dumbbell': 'Dumbbell RDL', 'stiff leg deadlift': 'Stiff leg deadlift',
    'leg press': 'Leg press', 'leg press machine': 'Leg press',
    'leg extension': 'Leg extensions', 'leg extension machine': 'Leg extensions',
    'leg curl': 'Hamstring curls machine',
    'standing calf raise': 'Standing barbell calf raise', 'calf raise': 'Standing barbell calf raise',
    'seated calf raise machine': 'Seated calf raise machine', 'seated calf raise': 'Seated calf raise machine',
    'hanging leg raise': 'Hanging leg raise', 'hanging leg raises': 'Hanging leg raise',
    'cable crunch': 'Cable crunch', 'kneeling cable crunch': 'Cable crunch', 'crunch': 'Ab crunch',
    'hip thrust barbell': 'Barbell hip thrust', 'hip thrust': 'Barbell hip thrust',
    'hip thrust machine': 'Hip thrust machine',
    'chest press machine': 'Chest press machine', 'chest press': 'Chest press machine',
    'incline chest press machine': 'Incline chest press machine',
    'shoulder press machine': 'Overhead machine press – neutral grip',
    'lateral raise machine': 'Lateral raise machine', 'rear delt machine': 'Rear delt machine',
    'reverse fly machine': 'Rear delt machine', 'rear delt fly machine': 'Rear delt machine',
    'reverse pec deck': 'Rear delt machine', 'seated row machine': 'Machine row', 'machine row': 'Machine row',
    'chest supported row machine': 'Machine row', 't bar row': 'T-bar row', 't bar row machine': 'T-bar row',
    'assisted pull up': 'Assisted pull up machine', 'assisted pull up machine': 'Assisted pull up machine',
    'assisted dip': 'Assisted dip machine', 'assisted dip machine': 'Assisted dip machine',
    'hack squat': 'Hack squat', 'hack squat machine': 'Hack squat', 'pendulum squat': 'Pendulum squat',
    'belt squat': 'Belt squat', 'trap bar deadlift': 'Trap bar deadlift', 'hex bar deadlift': 'Trap bar deadlift',
    'rack pull': 'Rack pull', 'rack pull barbell': 'Rack pull', 'deficit deadlift': 'Deficit deadlift',
    'paused bench press': 'Paused bench press', 'pause bench press': 'Paused bench press',
    'close grip bench press': 'Close grip bench press', 'bench press close grip barbell': 'Close grip bench press',
    'push press': 'Push press', 'jm press': 'JM press',
    'standing calf raise machine': 'Standing calf raise machine', 'calf raise machine': 'Standing calf raise machine',
    'seated leg curl': 'Seated leg curl', 'lying leg curl machine': 'Lying leg curl machine',
    'lying leg curl': 'Lying leg curl machine', 'seated leg curl machine': 'Seated leg curl',
    'bicep curl cable': 'Cable biceps curl', 'cable curl': 'Cable biceps curl',
    'wrist curl': 'Wrist curl', 'reverse wrist curl': 'Reverse wrist curl', 'russian twist': 'Russian twist',
    'decline crunch': 'Decline crunch', 'kettlebell swing': 'Kettlebell swing',
}

# Grupa mięśniowa dla ćwiczeń nieznalezionych w bazie - według słów kluczowych w nazwie.
GROUP_KEYWORDS = [
    ('Łydki', ['calf']), ('Brzuch', ['crunch', 'plank', 'leg raise', 'ab ', 'abs']),
    ('Biceps', ['curl']), ('Triceps', ['tricep', 'pushdown', 'skull', 'extension']),
    ('Barki', ['shoulder', 'lateral', 'delt', 'overhead', 'raise', 'face pull']),
    ('Klatka piersiowa', ['bench', 'chest', 'fly', 'dip', 'push up', 'press']),
    ('Plecy', ['row', 'pull', 'lat ', 'shrug', 'deadlift']),
    ('Czworogłowe Uda', ['squat', 'leg press', 'lunge', 'extension']),
    ('Dwugłowe Uda / Pośladki', ['hip', 'glute', 'leg curl', 'rdl']),
]


def normalize(name: str) -> str:
    name = name.lower().replace('–', ' ').replace('-', ' ')
    name = re.sub(r'[^\w\s]', ' ', name)
    return re.sub(r'\s+', ' ', name).strip()


class ExerciseResolver:
    """Dopasowuje nazwy z pliku do bazy ćwiczeń; brakujące tworzy jako ćwiczenia własne."""

    def __init__(self, user):
        self.user = user
        self.cache: dict[str, Exercise] = {}
        self.created: list[str] = []
        self.by_english = {}
        for ex in Exercise.objects.all():
            if ex.created_by_id not in (None, user.id):
                continue
            parts = ex.name.split(' / ')
            for part in {parts[-1], parts[0], ex.name}:
                self.by_english.setdefault(normalize(part), ex)

    def resolve(self, raw: str) -> Exercise:
        key = normalize(raw)
        if key in self.cache:
            return self.cache[key]
        exercise = None
        target = NAME_MAP.get(key) or NAME_MAP.get(re.sub(r'\s*\(.*\)', '', raw).lower().strip())
        if target:
            exercise = self.by_english.get(normalize(target))
        if exercise is None:
            exercise = self.by_english.get(key)
        if exercise is None:
            exercise = self._create(raw)
        self.cache[key] = exercise
        return exercise

    def _create(self, raw: str) -> Exercise:
        low = f' {raw.lower()} '
        group = next((g for g, keys in GROUP_KEYWORDS if any(k in low for k in keys)), 'Inne')
        equipment = ('barbell' if 'barbell' in low else 'dumbbell' if 'dumbbell' in low else
                     'cable' if 'cable' in low else 'machine' if 'machine' in low else 'bodyweight')
        name = f'{raw.strip()} / {raw.strip()}'[:200]
        existing = Exercise.objects.filter(name=name).first()
        if existing and existing.created_by_id not in (None, self.user.id):
            name = f'{raw.strip()} [{self.user.username}] / {raw.strip()}'[:200]
            existing = Exercise.objects.filter(name=name).first()
        if existing:
            return existing
        exercise = Exercise.objects.create(name=name, muscle_group=group, equipment=equipment, created_by=self.user)
        self.created.append(raw.strip())
        self.by_english[normalize(raw)] = exercise
        return exercise


# --- odczyt pliku ------------------------------------------------------------

DATE_FORMATS = ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d',
                '%d %b %Y, %H:%M', '%d.%m.%Y %H:%M', '%d.%m.%Y', '%m/%d/%Y %H:%M', '%m/%d/%Y']


def parse_date(value: str) -> datetime:
    value = (value or '').strip()
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(value, fmt)  # noqa: DTZ007 - strefa nadawana w linii niżej
            return timezone.make_aware(dt) if timezone.is_naive(dt) else dt
        except ValueError:
            continue
    raise ValueError(f'Nieznany format daty: „{value}”')


def parse_number(value) -> float | None:
    if value is None:
        return None
    value = str(value).strip().replace(',', '.')
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_duration(value: str) -> int | None:
    """'1h 38m', '58m', '1:38:30' -> sekundy."""
    value = (value or '').strip().lower()
    if not value:
        return None
    if re.fullmatch(r'\d+:\d{2}(:\d{2})?', value):
        parts = [int(p) for p in value.split(':')]
        return parts[0] * 3600 + parts[1] * 60 + (parts[2] if len(parts) == 3 else 0)
    total = 0
    for amount, unit in re.findall(r'(\d+)\s*(h|m|s)', value):
        total += int(amount) * {'h': 3600, 'm': 60, 's': 1}[unit]
    return total or None


def read_rows(text: str) -> tuple[list[dict], str]:
    text = text.lstrip('\ufeff')
    first_line = text.split('\n', 1)[0]
    delimiter = ';' if first_line.count(';') > first_line.count(',') else ','
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    rows = [{(k or '').strip().lower(): (v or '').strip() for k, v in row.items()} for row in reader]
    headers = {h.strip().lower() for h in (reader.fieldnames or [])}
    if {'exercise name', 'set order'} <= headers:
        return rows, 'strong'
    if {'exercise_title', 'start_time'} <= headers:
        return rows, 'hevy'
    if {'date', 'exercise', 'reps'} <= headers:
        return rows, 'template'
    raise ValueError('Nie rozpoznano formatu pliku. Obsługiwane są eksporty CSV z aplikacji Strong i Hevy '
                     'oraz szablon z kolumnami: date, exercise, weight, reps (opcjonalnie workout, rir, rpe, warmup).')


def normalize_rows(rows: list[dict], fmt: str) -> list[dict]:
    """Sprowadza wiersze do wspólnej postaci: data, trening, ćwiczenie, ciężar, powtórzenia..."""
    out = []
    for row in rows:
        if fmt == 'strong':
            unit_lbs = 'lbs' in row.get('weight unit', '').lower()
            order = row.get('set order', '').upper()
            out.append({
                'date': row.get('date'), 'workout': row.get('workout name') or 'Trening',
                'duration': parse_duration(row.get('duration', '')), 'exercise': row.get('exercise name'),
                'weight': parse_number(row.get('weight')), 'reps': parse_number(row.get('reps')),
                'rpe': parse_number(row.get('rpe')), 'rir': None, 'warmup': order == 'W',
                'notes': row.get('workout notes', ''), 'lbs': unit_lbs,
            })
        elif fmt == 'hevy':
            start, end = row.get('start_time'), row.get('end_time')
            duration = None
            with suppress(ValueError):
                duration = int((parse_date(end) - parse_date(start)).total_seconds()) if end else None
            weight = parse_number(row.get('weight_kg'))
            lbs = False
            if weight is None and row.get('weight_lbs'):
                weight, lbs = parse_number(row.get('weight_lbs')), True
            out.append({
                'date': start, 'workout': row.get('title') or 'Trening', 'duration': duration,
                'exercise': row.get('exercise_title'), 'weight': weight, 'reps': parse_number(row.get('reps')),
                'rpe': parse_number(row.get('rpe')), 'rir': None, 'warmup': row.get('set_type', '') == 'warmup',
                'notes': row.get('description', ''), 'lbs': lbs,
            })
        else:
            out.append({
                'date': row.get('date'), 'workout': row.get('workout') or 'Trening',
                'duration': parse_duration(row.get('duration', '')), 'exercise': row.get('exercise'),
                'weight': parse_number(row.get('weight')), 'reps': parse_number(row.get('reps')),
                'rpe': parse_number(row.get('rpe')), 'rir': parse_number(row.get('rir')),
                'warmup': row.get('warmup', '').lower() in ('1', 'true', 'tak', 'w', 'yes'),
                'notes': row.get('notes', ''), 'lbs': False,
            })
    return out


@transaction.atomic
def import_csv(user, text: str) -> dict:
    """Importuje historię treningów; zwraca podsumowanie."""

    rows, fmt = read_rows(text)
    rows = normalize_rows(rows, fmt)
    resolver = ExerciseResolver(user)
    sessions: OrderedDict[tuple, dict] = OrderedDict()
    skipped_rows = 0
    for row in rows:
        reps = row['reps']
        if not row['exercise'] or not reps or reps <= 0 or reps > 200:
            skipped_rows += 1  # np. ćwiczenia na czas lub dystans
            continue
        try:
            date = parse_date(row['date'])
        except ValueError:
            skipped_rows += 1
            continue
        weight = row['weight'] or 0.0
        if row['lbs']:
            weight *= LBS_TO_KG
        weight = round(min(max(weight, 0), 1000), 2)
        key = (date.isoformat(), row['workout'])
        sessions.setdefault(key, {'date': date, 'workout': row['workout'], 'duration': row['duration'],
                                  'notes': row['notes'], 'sets': []})
        rpe = row['rpe'] if row['rpe'] and 1 <= row['rpe'] <= 10 else None
        rir = int(row['rir']) if row['rir'] is not None and 0 <= row['rir'] <= 10 else (
            max(0, round(10 - rpe)) if rpe else None)
        sessions[key]['sets'].append({'exercise': resolver.resolve(row['exercise']), 'weight': weight,
                                      'reps': int(reps), 'rpe': rpe, 'rir': rir, 'warmup': row['warmup']})

    created, duplicates, set_count, touched = 0, 0, 0, set()
    for (date_iso, workout), data in sessions.items():
        client_uuid = uuid.uuid5(IMPORT_NAMESPACE, f'{user.id}|{date_iso}|{workout}')
        if WorkoutSession.objects.filter(client_uuid=client_uuid).exists():
            duplicates += 1
            continue
        notes = f'Import: {workout}' + (f'\n{data["notes"]}' if data['notes'] else '')
        session = WorkoutSession.objects.create(
            user=user, date_completed=data['date'], client_uuid=client_uuid, notes=notes[:1000],
            duration_seconds=data['duration'] if data['duration'] and data['duration'] <= 6 * 3600 else None)
        counters: dict[int, int] = {}
        objs = []
        for s in data['sets']:
            counters[s['exercise'].id] = counters.get(s['exercise'].id, 0) + 1
            objs.append(ExerciseSet(session=session, exercise=s['exercise'], set_number=counters[s['exercise'].id],
                                    weight=s['weight'], reps=s['reps'], rpe=s['rpe'], rir=s['rir'],
                                    is_warmup=s['warmup']))
            touched.add(s['exercise'].id)
        ExerciseSet.objects.bulk_create(objs)
        created += 1
        set_count += len(objs)

    for exercise_id in touched:
        analytics.recompute_record(user, exercise_id)

    return {'format': fmt, 'sessions_created': created, 'sessions_skipped_duplicates': duplicates,
            'sets_created': set_count, 'rows_skipped': skipped_rows,
            'exercises_created': resolver.created}
