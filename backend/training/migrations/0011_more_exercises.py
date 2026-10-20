"""Uzupełnienie bazy o popularne ćwiczenia, których brakowało (głównie maszyny i odmiany bojów).

Jeżeli użytkownik utworzył wcześniej ćwiczenie własne o tej samej nazwie (np. przez komendę
importu planu), zostaje ono przeniesione do wspólnej bazy - zachowuje historię serii.
"""
from django.db import migrations

K, P, B, T = 'Klatka piersiowa', 'Plecy', 'Barki', 'Triceps'
Q, H, BI, C, A = 'Czworogłowe Uda', 'Dwugłowe Uda / Pośladki', 'Biceps', 'Łydki', 'Brzuch'

# (polska nazwa, angielska nazwa, grupa główna, mięśnie pomocnicze, sprzęt, obciążane obszary, opis)
EXERCISES = [
    ('Wyciskanie na maszynie siedząc', 'Chest press machine', K, 'Triceps, przednie aktony barków', 'machine', ['bark'],
     'Wypychanie uchwytów maszyny przed siebie w pozycji siedzącej z oparciem pleców.'),
    ('Wyciskanie na maszynie na skosie dodatnim', 'Incline chest press machine', K, 'Przednie aktony barków, triceps', 'machine', ['bark'],
     'Wyciskanie na maszynie prowadzącej ruch skośnie w górę - akcent na górną część klatki.'),
    ('Unoszenie ramion bokiem na maszynie', 'Lateral raise machine', B, 'Czworoboczny grzbietu', 'machine', ['bark'],
     'Odwodzenie ramion w bok na maszynie z podparciem ramion.'),
    ('Odwrotne rozpiętki na maszynie', 'Rear delt machine', B, 'Czworoboczny, równoległoboczne', 'machine', ['bark'],
     'Odwodzenie ramion w tył na maszynie butterfly ustawionej przodem do oparcia.'),
    ('Wiosłowanie na maszynie z podparciem klatki', 'Machine row', P, 'Biceps, tylne aktony barków', 'machine', [],
     'Przyciąganie uchwytów do tułowia z klatką opartą o podporę - bez obciążania odcinka lędźwiowego.'),
    ('Wiosłowanie T-sztangą', 'T-bar row', P, 'Biceps, tylne aktony barków, prostowniki grzbietu', 'barbell',
     ['kregoslup-ledzwiowy'], 'Przyciąganie końca sztangi z uchwytem do klatki w opadzie tułowia.'),
    ('Podciąganie na maszynie z odciążeniem', 'Assisted pull up machine', P, 'Biceps', 'machine', ['bark'],
     'Podciąganie nachwytem z częściowym odciążeniem masy ciała przez maszynę.'),
    ('Pompki na poręczach na maszynie z odciążeniem', 'Assisted dip machine', T, 'Klatka piersiowa, przednie aktony barków',
     'machine', ['bark', 'lokiec'], 'Pompki na poręczach z odciążeniem masy ciała przez maszynę.'),
    ('Przysiad na maszynie hack', 'Hack squat', Q, 'Pośladki', 'machine', ['kolano'],
     'Przysiad na maszynie z oparciem pleców o ruchomą platformę prowadzoną po skosie.'),
    ('Przysiad na maszynie wahadłowej', 'Pendulum squat', Q, 'Pośladki', 'machine', ['kolano'],
     'Przysiad na maszynie z ruchem po łuku - duży zakres pracy kolan przy małym obciążeniu kręgosłupa.'),
    ('Przysiad z pasem biodrowym', 'Belt squat', Q, 'Pośladki, przywodziciele', 'machine', ['kolano', 'biodro'],
     'Przysiad z obciążeniem zawieszonym na pasie biodrowym - odciąża kręgosłup.'),
    ('Martwy ciąg z trap bar', 'Trap bar deadlift', H, 'Czworogłowe uda, plecy, przedramiona', 'barbell',
     ['kregoslup-ledzwiowy', 'biodro', 'kolano'], 'Martwy ciąg ze sztangą heksagonalną, z uchwytami po bokach ciała.'),
    ('Martwy ciąg ze stojaków (rack pull)', 'Rack pull', P, 'Pośladki, dwugłowe uda, przedramiona', 'barbell',
     ['kregoslup-ledzwiowy'], 'Martwy ciąg rozpoczynany z podwyższenia na wysokości kolan lub tuż pod nimi.'),
    ('Martwy ciąg z deficytu', 'Deficit deadlift', H, 'Plecy, czworogłowe uda', 'barbell',
     ['kregoslup-ledzwiowy', 'biodro', 'kolano'], 'Martwy ciąg stojąc na podwyższeniu - wydłużony zakres ruchu.'),
    ('Wyciskanie sztangi leżąc z pauzą', 'Paused bench press', K, 'Triceps, przednie aktony barków', 'barbell', ['bark'],
     'Wyciskanie leżąc z zatrzymaniem sztangi na klatce na 1-2 sekundy.'),
    ('Wyciskanie sztangi leżąc wąskim chwytem', 'Close grip bench press', T, 'Klatka piersiowa, przednie aktony barków',
     'barbell', ['bark', 'lokiec', 'nadgarstek'], 'Wyciskanie leżąc chwytem na szerokość barków - akcent na triceps.'),
    ('Wyciskanie żołnierskie z podrzutem (push press)', 'Push press', B, 'Triceps, czworogłowe uda', 'barbell',
     ['bark', 'kolano', 'kregoslup-ledzwiowy'], 'Wyciskanie sztangi nad głowę z inicjacją ruchu z nóg.'),
    ('Wyciskanie JM', 'JM press', T, 'Klatka piersiowa', 'barbell', ['lokiec'],
     'Hybryda wyciskania wąskim chwytem i wyciskania francuskiego.'),
    ('Unoszenie bioder na maszynie', 'Hip thrust machine', H, 'Dwugłowe uda', 'machine', ['biodro'],
     'Wyprost bioder na maszynie z oparciem pleców i pasem obciążającym biodra.'),
    ('Wspięcia na palce stojąc na maszynie', 'Standing calf raise machine', C, '', 'machine', [],
     'Wspięcia na palce stojąc z obciążeniem na barkach przenoszonym przez maszynę.'),
    ('Zginanie nóg siedząc na maszynie', 'Seated leg curl', H, 'Łydki', 'machine', ['kolano'],
     'Zginanie kolan w pozycji siedzącej - dwugłowe uda pracują w rozciągnięciu.'),
    ('Zginanie nóg leżąc na maszynie', 'Lying leg curl machine', H, 'Łydki', 'machine', ['kolano'],
     'Zginanie kolan w leżeniu przodem na maszynie.'),
    ('Uginanie ramion z drążkiem wyciągu dolnego', 'Cable biceps curl', BI, 'Przedramiona', 'cable', ['lokiec'],
     'Uginanie ramion stojąc z prostym lub łamanym drążkiem na wyciągu dolnym.'),
    ('Uginanie nadgarstków podchwytem', 'Wrist curl', BI, 'Zginacze przedramion', 'dumbbell', ['nadgarstek'],
     'Zginanie nadgarstków z hantlami przy przedramionach opartych o ławkę.'),
    ('Prostowanie nadgarstków nachwytem', 'Reverse wrist curl', BI, 'Prostowniki przedramion', 'dumbbell', ['nadgarstek'],
     'Prostowanie nadgarstków z hantlami trzymanymi nachwytem.'),
    ('Russian twist', 'Russian twist', A, 'Skośne brzucha', 'bodyweight', ['kregoslup-ledzwiowy'],
     'Skręty tułowia w siadzie z uniesionymi stopami, opcjonalnie z obciążeniem.'),
    ('Brzuszki na ławce skośnej', 'Decline crunch', A, '', 'bodyweight', [],
     'Spięcia brzucha na ławce skośnej głową w dół.'),
    ('Wymachy kettlebell', 'Kettlebell swing', H, 'Plecy, barki, brzuch', 'kettlebell', ['kregoslup-ledzwiowy', 'biodro'],
     'Dynamiczny wyprost bioder z kettlebell wymachiwanym do wysokości klatki.'),
]


def forwards(apps, schema_editor):
    Exercise = apps.get_model('training', 'Exercise')
    BodyArea = apps.get_model('training', 'BodyArea')
    for pl, en, group, secondary, equipment, areas, description in EXERCISES:
        name = f'{pl} / {en}'
        ex = Exercise.objects.filter(name=name).first() or Exercise.objects.filter(name__endswith=f' / {en}').first()
        if ex is None:
            ex = Exercise.objects.create(name=name, muscle_group=group, secondary_muscles=secondary,
                                         equipment=equipment, description=description)
        else:  # ćwiczenie własne z tą nazwą staje się częścią wspólnej bazy
            ex.name, ex.muscle_group, ex.secondary_muscles = name, group, secondary
            ex.equipment, ex.description, ex.created_by = equipment, description, None
            ex.save()
        ex.stressed_areas.set(BodyArea.objects.filter(code__in=areas))


class Migration(migrations.Migration):
    dependencies = [('training', '0010_progression_goals_notes')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
