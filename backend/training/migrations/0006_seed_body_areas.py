"""Dane startowe: obszary ciała, sprzęt i obciążane struktury dla istniejącej
bazy ćwiczeń, profile dla istniejących kont oraz jednostka treningowa dla
planów utworzonych przed wprowadzeniem struktury tygodni i dni."""
from django.db import migrations

BODY_AREAS = [
    ('kregoslup-ledzwiowy', 'Odcinek lędźwiowy kręgosłupa'),
    ('kregoslup-szyjny', 'Odcinek szyjny kręgosłupa'),
    ('bark', 'Staw barkowy'),
    ('lokiec', 'Staw łokciowy'),
    ('nadgarstek', 'Nadgarstek'),
    ('biodro', 'Staw biodrowy'),
    ('kolano', 'Staw kolanowy'),
]

# Kolejność ma znaczenie: pierwsza pasująca reguła wygrywa.
EQUIPMENT_RULES = [
    ('kettlebell', ['kettl']),
    ('band', ['trx', 'gum', 'band', 'miniband']),
    ('cable', ['wyciąg', 'linki', 'linką', 'cable', 'pull through', 'lat pulldown', 'kayak row']),
    ('machine', ['maszyn', 'suwnic', 'machine', 'smith', 'leg press', 'butterfly', 'hammer chest']),
    ('dumbbell', ['hantl', 'sztangiel', 'dumbbell', 'goblet', 'farmer', 'suitcase', 'hammer curl',
                  'zottman', 'cuban', 'powell', 't raise', 'bent-over raise', 'external rotation',
                  'seal row', 'renegade', 'floor press']),
    ('barbell', ['sztang', 'barbell', 'landmine', 'gryf', 'deadlift', 'romanian', 'pendlay', 'zercher',
                 'anderson', 'front squat', 'box squat', 'z-press', 'good morning', 'skull crusher',
                 'rollback', 'rdl']),
]

AREA_RULES = {
    'kregoslup-ledzwiowy': ['martwy ciąg', 'deadlift', 'rdl', 'dzień dobry', 'good morning',
                            'back squat', 'front squat', 'przysiad ze sztangą', 'zercher',
                            'wiosłowanie sztangą', 'bent over barbell', 'pendlay', 'hyperextension',
                            'ławce rzymskiej', 'stiff leg'],
    'kregoslup-szyjny': ['za kark', 'behind the neck', 'behind the head', 'szrugsy', 'shrugs'],
    'bark': ['nad głow', 'overhead', 'military', 'arnold', 'za kark', 'bench press', 'wyciskanie',
             'pompki na poręczach', 'dips', 'upright', 'pod brodę', 'pull up', 'podciąganie',
             'lateral raise', 'front raise', 'wznosy ramion', 'unoszenie ramion', 'rozpiętki',
             'chest fly', 'z-press', 'landmine press', 'cuban', 'rotacj', 'rotation',
             'face pull', 'raise', 'powell', 'reverse fly', 'rear delt'],
    'kolano': ['przysiad', 'squat', 'wykrok', 'zakrok', 'lunge', 'step up', 'step-up', 'wchodzenie',
               'wypychanie', 'leg press', 'wyprosty kolan', 'leg extension', 'pistolet', 'pistol',
               'nordic', 'sissy', 'syzyf', 'wyskok', 'jump'],
    'lokiec': ['francusk', 'skull', 'triceps', 'prostowanie przedramion', 'prostowanie ramion',
               'dips', 'zginanie przedramion', 'uginanie ramion', 'biceps', 'hammer curl', 'preacher'],
    'nadgarstek': ['front rack', 'front squat', 'na barkach', 'ab roller', 'rollout', 'pompki',
                   'push up', 'zottman', 'nachwytem biceps', 'reverse barbell biceps'],
    'biodro': ['hip thrust', 'unoszenie bioder', 'odwodzenie', 'przywodzenie', 'abduction',
               'adduction', 'sumo', 'kozak', 'cossack', 'frog', 'glute bridge'],
}
AREA_EXCLUDE = {'bark': ['leg press', 'pallof', 'wypychanie', 'calf', 'leg raise', 'knee raise',
                         'hip', 'glute', 'rotating', 'banded rotation', 'cable rotation',
                         'biceps', 'knees raise', 'chop', 'rotacje w', 'rotacje boczne'],
                'kolano': ['calf']}


def classify(name):
    low = name.lower()
    equipment = 'bodyweight'
    for code, keys in EQUIPMENT_RULES:
        if any(k in low for k in keys):
            equipment = code
            break
    areas = [code for code, keys in AREA_RULES.items()
             if any(k in low for k in keys)
             and not any(x in low for x in AREA_EXCLUDE.get(code, []))]
    return equipment, areas


def forwards(apps, schema_editor):
    BodyArea = apps.get_model('training', 'BodyArea')
    Exercise = apps.get_model('training', 'Exercise')
    User = apps.get_model('auth', 'User')
    UserProfile = apps.get_model('training', 'UserProfile')
    HealthProfile = apps.get_model('training', 'HealthProfile')
    WorkoutPlan = apps.get_model('training', 'WorkoutPlan')
    PlanDay = apps.get_model('training', 'PlanDay')

    areas = {code: BodyArea.objects.get_or_create(code=code, defaults={'name': name})[0]
             for code, name in BODY_AREAS}

    for ex in Exercise.objects.all():
        equipment, area_codes = classify(ex.name)
        ex.equipment = equipment
        ex.save(update_fields=['equipment'])
        ex.stressed_areas.set([areas[c] for c in area_codes])

    for user in User.objects.all():
        UserProfile.objects.get_or_create(user=user)
        HealthProfile.objects.get_or_create(user=user)

    for plan in WorkoutPlan.objects.all():
        if plan.exercises.filter(day__isnull=True).exists():
            day = PlanDay.objects.create(plan=plan, week=1, order=0, name='Dzień A')
            plan.exercises.filter(day__isnull=True).update(day=day)


class Migration(migrations.Migration):
    dependencies = [('training', '0005_extended_model')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
