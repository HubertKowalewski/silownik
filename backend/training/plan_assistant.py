"""Asystent tworzenia planu: podział treningowy -> jednostki -> „miejsca” na ćwiczenia z podpowiedziami.

Asystent niczego nie narzuca: dla każdego miejsca w jednostce (np. „wyciskanie na klatkę”,
„przyciąganie pionowe”) proponuje kilka ćwiczeń z bazy, uszeregowanych według:
  1. bezpieczeństwa - ćwiczenia obciążające obszary z ankiety zdrowotnej są pomijane,
  2. dostępnego sprzętu z profilu,
  3. historii użytkownika (ćwiczenia, które już wykonuje),
  4. popularnych, podstawowych wariantów ruchu.
Użytkownik wybiera z propozycji, wskazuje dowolne inne ćwiczenie, pomija miejsce albo dodaje własne.
Ćwiczenia w bazie nie mają pola „wzorzec ruchu”, dlatego miejsca dopasowują ćwiczenia po partii mięśniowej
i słowach kluczowych angielskiej części nazwy (np. „press”, „row”, „pulldown”).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from django.db.models import Count, Q

from .analytics import user_restrictions
from .models import Exercise


@dataclass(frozen=True)
class Slot:
    label: str
    hint: str
    group: str
    include: str = ''
    exclude: str = ''
    kind: str = 'accessory'  # main / secondary / accessory - decyduje o seriach, powtórzeniach i przerwie
    prefer: tuple[str, ...] = ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight')
    popular: tuple[str, ...] = field(default_factory=tuple)  # podstawowe warianty - wyżej na liście
    optional: bool = False


# --- miejsca na ćwiczenia ------------------------------------------------------
CHEST_PRESS = Slot('Wyciskanie na klatkę', 'główne ćwiczenie wielostawowe na klatkę piersiową', 'Klatka piersiowa',
                   r'press|push ups|dips', r'floor|pin|guillotine|one arm|without rack|paused|decline|close|incline',
                   'main',
                   popular=('barbell bench press', 'dumbbells bench press', 'chest press machine', 'push ups'))
CHEST_INCLINE = Slot('Wyciskanie skośne', 'górna część klatki - ławka skośna', 'Klatka piersiowa',
                     r'incline.*press|incline chest press', '', 'secondary', ('dumbbell', 'barbell', 'machine'),
                     popular=('incline dumbbell bench press', 'incline barbell bench press'))
CHEST_FLY = Slot('Rozpiętki', 'izolacja klatki piersiowej', 'Klatka piersiowa', r'fly|pec dec', '', 'accessory',
                 ('cable', 'machine', 'dumbbell'), popular=('pec dec fly', 'cable chest fly'), optional=True)
ROW = Slot('Wiosłowanie', 'przyciąganie poziome - grubość pleców', 'Plecy', r'\brow\b',
           r'renegade|upright|kayak|to chest|landmine', 'secondary',
           popular=('bent over barbell row', 'cable row', 'dumbbell row – hand supported on bench', 'machine row'))
VERTICAL_PULL = Slot('Przyciąganie pionowe', 'drążek lub wyciąg górny - szerokość pleców', 'Plecy',
                     r'pulldown|pull ups|chin ups|pull up machine',
                     r'eccentric|scap|dead stop|behind|cliffhanger|australian|legs assisted', 'main',
                     ('bodyweight', 'cable', 'machine'), popular=('lat pulldown', 'pull ups', 'chin ups'))
OHP = Slot('Wyciskanie nad głowę', 'główne ćwiczenie na barki', 'Barki', r'press',
           r'cuban|landmine|half kneeling|push press|z-press|behind the neck|alternating|single arm', 'secondary',
           ('dumbbell', 'barbell', 'machine'), popular=('overhead dumbbell press', 'military press',
                                                    'seated overhead dumbbell press'))
LATERAL = Slot('Unoszenie bokiem', 'środkowy akton barków', 'Barki', r'lateral raise', '', 'accessory',
               ('dumbbell', 'cable', 'machine'), popular=('lateral raise', 'one arm cable lateral raise'))
REAR_DELT = Slot('Tył barków', 'tylny akton barków i postawa', 'Barki', r'rear delt|face pull|bent-over raise',
                 '', 'accessory', ('cable', 'machine', 'dumbbell'), popular=('face pull', 'rear delt machine'),
                 optional=True)
SQUAT = Slot('Przysiad / wypychanie', 'główne ćwiczenie na czworogłowe uda', 'Czworogłowe Uda',
             r'squat|leg press',
             r'pistol|cossack|cyclist|sissy|spanish|skater|air|box|zercher|anderson|single|cable|sumo|split|'
             r'bulgarian|belt|landmine', 'main', ('barbell', 'machine', 'dumbbell', 'kettlebell'),
             popular=('back squat', 'leg press', 'hack squat', 'goblet squat', 'front squat'))
LUNGE = Slot('Wykroki', 'praca jednonóż - uda i pośladki', 'Czworogłowe Uda', r'lunge|split squat|step.?up',
             r'oblique|drop|zercher|landmine|walking long|hands on chest|one and half', 'secondary',
             ('dumbbell', 'barbell', 'bodyweight'),
             popular=('bulgarian split squat with dumbbells – quad version', 'walking lunges with dumbbells',
                      'reverse lunges with dumbbells'))
QUAD_ISO = Slot('Prostowanie nóg', 'izolacja czworogłowych', 'Czworogłowe Uda', r'leg extension', '', 'accessory',
                ('machine',), popular=('leg extensions',), optional=True)
HINGE = Slot('Martwy ciąg / skłon', 'zawias biodrowy - tył uda i pośladki', 'Dwugłowe Uda / Pośladki',
             r'deadlift|rdl|good morning',
             r'deficit|elevated|kickstand|landmine|kettlebell|single|one leg|assisted|sumo', 'main',
             ('barbell', 'dumbbell'), popular=('romanian deadlift', 'deadlift', 'dumbbell rdl', 'trap bar deadlift'))
HIP_THRUST = Slot('Wypychanie bioder', 'pośladki', 'Dwugłowe Uda / Pośladki', r'hip thrust|glute bridge',
                  r'frog|single|toes', 'secondary', ('barbell', 'machine', 'dumbbell'),
                  popular=('barbell hip thrust', 'hip thrust machine'), optional=True)
HAM_CURL = Slot('Uginanie nóg', 'izolacja dwugłowych ud', 'Dwugłowe Uda / Pośladki', r'curl',
                r'ball|dumbbell|nordic|reverse', 'accessory', ('machine',),
                popular=('lying leg curl machine', 'seated leg curl'))
BICEPS = Slot('Biceps', 'uginanie ramion', 'Biceps', r'curl', r'wrist', 'accessory', ('dumbbell', 'barbell', 'cable'),
              popular=('barbell biceps curl', 'hammer curl', 'seated incline dumbbell biceps curl', 'cable biceps curl'))
TRICEPS = Slot('Triceps', 'prostowanie ramion', 'Triceps', r'extension|skull|dips|close grip',
               r'bench dips|eccentric|push|rollback', 'accessory', ('cable', 'dumbbell', 'barbell'),
               popular=('cable rope triceps extension', 'overhead dumbbell triceps extension', 'skull crusher'))
CALVES = Slot('Łydki', 'wspięcia na palce', 'Łydki', r'calf', '', 'accessory', ('machine', 'dumbbell', 'barbell'),
              popular=('standing calf raise machine', 'seated calf raise machine'), optional=True)
CORE = Slot('Brzuch', 'mięśnie tułowia', 'Brzuch', r'plank|crunch|leg raise|knee raise|roller|dead bug|pallof',
            r'shoulder tap|knee plank|side plank on knee|swiss|frog|candlestick', 'accessory',
            ('bodyweight', 'cable', 'machine'), popular=('plank', 'hanging knee raise', 'cable crunch', 'dead bug – bent legs'),
            optional=True)


SPLITS = {
    'full_body': {
        'name': 'Full Body (całe ciało)',
        'description': 'Każda jednostka obejmuje całe ciało; dwie wersje (A i B) wykonywane naprzemiennie. '
                       'Najlepszy przy 2-3 treningach w tygodniu i na początek.',
        'days_per_week': 3,
        'days': [('Full Body A', [SQUAT, CHEST_PRESS, ROW, LATERAL, HAM_CURL, CORE]),
                 ('Full Body B', [HINGE, OHP, VERTICAL_PULL, LUNGE, BICEPS, TRICEPS])],
    },
    'upper_lower': {
        'name': 'Upper / Lower (góra / dół)',
        'description': 'Dwie jednostki na górę i dwie na dół ciała w tygodniu. Dobry wybór przy 4 treningach.',
        'days_per_week': 4,
        'days': [('Góra A', [CHEST_PRESS, ROW, OHP, VERTICAL_PULL, BICEPS, TRICEPS]),
                 ('Dół A', [SQUAT, HINGE, LUNGE, HAM_CURL, CALVES, CORE]),
                 ('Góra B', [VERTICAL_PULL, CHEST_INCLINE, ROW, LATERAL, REAR_DELT, TRICEPS, BICEPS]),
                 ('Dół B', [HINGE, SQUAT, HIP_THRUST, QUAD_ISO, HAM_CURL, CALVES])],
    },
    'push_pull_legs': {
        'name': 'Push / Pull / Legs',
        'description': 'Pchanie (klatka, barki, triceps), ciągnięcie (plecy, biceps) i nogi. '
                       'Przy 3 dniach - raz w tygodniu, przy 6 dniach - cykl powtarzany dwukrotnie.',
        'days_per_week': 3,
        'days': [('Push', [CHEST_PRESS, OHP, CHEST_INCLINE, LATERAL, CHEST_FLY, TRICEPS]),
                 ('Pull', [VERTICAL_PULL, ROW, REAR_DELT, BICEPS, CORE]),
                 ('Legs', [SQUAT, HINGE, LUNGE, QUAD_ISO, HAM_CURL, CALVES])],
    },
    'push_pull': {
        'name': 'Push / Pull',
        'description': 'Dwie jednostki: pchanie (z przysiadem) i ciągnięcie (z martwym ciągiem). '
                       'Prosty podział na 2-4 treningi w tygodniu.',
        'days_per_week': 4,
        'days': [('Push', [SQUAT, CHEST_PRESS, OHP, LUNGE, LATERAL, TRICEPS]),
                 ('Pull', [HINGE, VERTICAL_PULL, ROW, HAM_CURL, REAR_DELT, BICEPS])],
    },
}

# serie, powt. od, powt. do, RIR, przerwa [s] - zależnie od rodzaju ćwiczenia i celu treningowego
PRESCRIPTION = {
    'strength': {'main': (4, 4, 6, 2, 180), 'secondary': (3, 6, 8, 2, 150), 'accessory': (3, 8, 12, 2, 90)},
    'hypertrophy': {'main': (3, 6, 10, 2, 150), 'secondary': (3, 8, 12, 2, 120), 'accessory': (3, 10, 15, 1, 75)},
    'reduction': {'main': (3, 8, 12, 2, 120), 'secondary': (3, 10, 12, 2, 90), 'accessory': (3, 12, 15, 1, 60)},
    'general': {'main': (3, 8, 10, 2, 120), 'secondary': (3, 10, 12, 2, 90), 'accessory': (2, 12, 15, 2, 60)},
}
CANDIDATES = 6


def recommended_split(profile) -> tuple[str, str]:
    days = getattr(profile, 'days_per_week', 3) or 3
    level = getattr(profile, 'level', 'beginner')
    if days <= 3:
        return 'full_body', f'{days} dni w tygodniu - trening całego ciała daje każdej partii 2-3 bodźce tygodniowo.'
    if days == 4:
        return 'upper_lower', '4 dni w tygodniu - podział góra/dół (każda partia 2 razy w tygodniu).'
    if level == 'beginner':
        return 'upper_lower', f'{days} dni w tygodniu, poziom początkujący - podział góra/dół.'
    return 'push_pull_legs', f'{days} dni w tygodniu - push/pull/legs powtarzany w tygodniu.'


def split_list(profile) -> dict:
    key, reason = recommended_split(profile)
    return {
        'recommended': key, 'reason': reason,
        'splits': [{'key': k, 'name': s['name'], 'description': s['description'],
                    'days': [d for d, _ in s['days']], 'days_per_week': s['days_per_week']}
                   for k, s in SPLITS.items()],
    }


def english(name: str) -> str:
    return name.split(' / ')[-1].lower()


def _candidates(slot: Slot, pool: list[Exercise], available: set[str], used: dict[int, int]) -> list[dict]:
    include = re.compile(slot.include) if slot.include else None
    exclude = re.compile(slot.exclude) if slot.exclude else None
    rows = []
    for ex in pool:
        if ex.muscle_group != slot.group:
            continue
        en = english(ex.name)
        if (include and not include.search(en)) or (exclude and exclude.search(en)):
            continue
        has_equipment = not available or ex.equipment in available or ex.equipment == 'bodyweight'
        popular = en in slot.popular
        times = used.get(ex.id, 0)
        preference = slot.prefer.index(ex.equipment) if ex.equipment in slot.prefer else len(slot.prefer)
        tags = []
        if times:
            tags.append(f'wykonywane {times}×')
        if popular:
            tags.append('podstawowe')
        if not has_equipment:
            tags.append('sprzęt spoza profilu')
        rank = (not has_equipment, -min(times, 20), not popular,
                slot.popular.index(en) if popular else 99, preference, len(en))
        rows.append((rank, {'id': ex.id, 'name': ex.name, 'equipment': ex.equipment, 'tags': tags}))
    rows.sort(key=lambda r: r[0])
    out, seen = [], set()
    for _, row in rows:  # w bazie bywają dwa wpisy o tej samej angielskiej nazwie - pokazujemy jeden
        if english(row['name']) not in seen:
            seen.add(english(row['name']))
            out.append(row)
    return out[:CANDIDATES]


def suggest(user, split_key: str) -> dict:
    """Jednostki wybranego podziału z propozycjami ćwiczeń dla każdego miejsca."""
    split = SPLITS[split_key]
    profile = getattr(user, 'profile', None)
    goal = getattr(profile, 'goal', 'hypertrophy') if profile else 'hypertrophy'
    prescription = PRESCRIPTION.get(goal, PRESCRIPTION['hypertrophy'])
    available = set(getattr(profile, 'equipment', None) or [])
    restricted = user_restrictions(user)

    pool = list(Exercise.objects.filter(Q(created_by__isnull=True) | Q(created_by=user))
                .exclude(equipment='band').exclude(stressed_areas__in=restricted).distinct())
    used = dict(Exercise.objects.filter(exerciseset__session__user=user, exerciseset__is_warmup=False)
                .annotate(n=Count('exerciseset__session', distinct=True)).values_list('id', 'n'))
    beginner = getattr(profile, 'level', 'beginner') == 'beginner'

    days = []
    earlier: dict[str, set[int]] = {}  # domyślne wybory z poprzednich jednostek dla tego samego miejsca
    for day_name, slots in split['days']:
        taken: set[int] = set()
        day_slots = []
        for i, slot in enumerate(slots):
            candidates = _candidates(slot, pool, available, used)
            # domyślnie: pierwsza propozycja, która nie powtarza się w jednostce; w kolejnej jednostce
            # z tym samym miejscem (np. Góra A / Góra B) - inny wariant ruchu, jeśli jest z czego wybrać
            fresh = [c['id'] for c in candidates if c['id'] not in taken]
            varied = [c for c in fresh if c not in earlier.get(slot.label, set())]
            default = (varied or fresh or [None])[0]
            if default:
                taken.add(default)
                earlier.setdefault(slot.label, set()).add(default)
            sets, reps_min, reps_max, rir, rest = prescription[slot.kind]
            day_slots.append({
                'key': f'{day_name}-{i}', 'label': slot.label, 'hint': slot.hint, 'kind': slot.kind,
                'sets': sets, 'reps_min': reps_min, 'reps_max': reps_max, 'rir': rir, 'rest': rest,
                # początkującym proponujemy krótsze jednostki - miejsca dodatkowe są domyślnie wyłączone
                'enabled': not (slot.optional and beginner),
                'optional': slot.optional,
                'default': default, 'candidates': candidates,
            })
        days.append({'name': day_name, 'slots': day_slots})
    return {
        'split': split_key, 'name': split['name'], 'days_per_week': split['days_per_week'], 'goal': goal,
        'health_filtered': bool(restricted), 'days': days,
    }
