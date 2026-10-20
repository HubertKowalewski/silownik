"""Model danych systemu planowania i analizy treningu siłowego.

Identyfikatory w komentarzach (WF-nn, WN-nn) odnoszą się do wymagań
z rozdziału 2 pracy.
"""
from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone

# --- SŁOWNIKI -------------------------------------------------------------

class Level(models.TextChoices):
    BEGINNER = 'beginner', 'Początkujący'
    INTERMEDIATE = 'intermediate', 'Średniozaawansowany'
    ADVANCED = 'advanced', 'Zaawansowany'


class Goal(models.TextChoices):
    STRENGTH = 'strength', 'Siła'
    HYPERTROPHY = 'hypertrophy', 'Masa mięśniowa'
    REDUCTION = 'reduction', 'Redukcja'
    GENERAL = 'general', 'Ogólna sprawność'


class Equipment(models.TextChoices):
    BARBELL = 'barbell', 'Sztanga'
    DUMBBELL = 'dumbbell', 'Hantle'
    MACHINE = 'machine', 'Maszyna'
    CABLE = 'cable', 'Wyciąg'
    KETTLEBELL = 'kettlebell', 'Kettlebell'
    BAND = 'band', 'Guma / TRX'
    BODYWEIGHT = 'bodyweight', 'Masa ciała'


class BodyArea(models.Model):
    """Struktura ciała, którą ćwiczenie obciąża i której może dotyczyć
    ograniczenie zdrowotne (WF-03, WF-06, WF-14)."""
    code = models.SlugField(max_length=40, unique=True)
    name = models.CharField(max_length=80)

    class Meta:
        ordering = ['name']
        verbose_name = 'obszar ciała'
        verbose_name_plural = 'obszary ciała'

    def __str__(self):
        return self.name


# --- ĆWICZENIA ------------------------------------------------------------

class Exercise(models.Model):
    """Baza ćwiczeń (WF-06, WF-07)."""
    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    muscle_group = models.CharField(max_length=50)  # mięśnie główne, np. "Plecy"
    secondary_muscles = models.CharField(max_length=200, blank=True)
    equipment = models.CharField(max_length=20, choices=Equipment.choices,
                                 default=Equipment.BODYWEIGHT)
    stressed_areas = models.ManyToManyField(BodyArea, blank=True, related_name='exercises')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='custom_exercises')

    class Meta:
        ordering = ['muscle_group', 'name']

    def __str__(self):
        return self.name


# --- PROFIL I ZDROWIE -----------------------------------------------------

class UserProfile(models.Model):
    """Parametry użytkownika wykorzystywane przy doborze planu (WF-02)."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    birth_year = models.PositiveIntegerField(null=True, blank=True)
    sex = models.CharField(max_length=1, blank=True, choices=[('K', 'Kobieta'), ('M', 'Mężczyzna')])
    height_cm = models.PositiveIntegerField(null=True, blank=True)
    level = models.CharField(max_length=20, choices=Level.choices, default=Level.BEGINNER)
    goal = models.CharField(max_length=20, choices=Goal.choices, default=Goal.GENERAL)
    days_per_week = models.PositiveSmallIntegerField(default=3)
    equipment = models.JSONField(default=list, blank=True)  # lista kodów Equipment
    load_increment = models.FloatField(default=2.5)  # najmniejszy przyrost obciążenia [kg]

    # preferencje minutnika przerw między seriami
    default_rest_seconds = models.PositiveIntegerField(default=120)
    rest_step_seconds = models.PositiveSmallIntegerField(default=15)
    rest_auto_start = models.BooleanField(default=True)
    rest_sound = models.BooleanField(default=True)
    rest_vibrate = models.BooleanField(default=True)
    # skala oceny wysiłku przy zapisie serii: RIR albo RPE
    effort_scale = models.CharField(max_length=4, choices=[('reps', 'Tylko powtórzenia'), ('rir', 'RIR'), ('rpe', 'RPE')], default='rir')

    # widoczność dla innych użytkowników (WF-04); dane o zdrowiu nigdy nie są udostępniane
    profile_public = models.BooleanField(default=False)
    trainings_public = models.BooleanField(default=False)
    # nowo zapisany trening jest domyślnie udostępniany (kto go zobaczy - patrz training/social.py)
    share_workouts_default = models.BooleanField(default=True)
    # wersja zdjęcia profilowego (znacznik czasu) - część adresu obrazka, więc przeglądarka może go
    # trzymać w pamięci na stałe, a po zmianie zdjęcia pobiera nowe; None = brak zdjęcia
    avatar_version = models.PositiveBigIntegerField(null=True, blank=True)

    def __str__(self):
        return f'Profil {self.user.username}'


class Follow(models.Model):
    """Obserwowanie użytkownika. Obserwowanie wzajemne daje wgląd w udostępnione treningi także
    przy profilu prywatnym - odwzajemnienie jest zgodą obserwowanej osoby."""
    follower = models.ForeignKey(User, on_delete=models.CASCADE, related_name='following_set')
    following = models.ForeignKey(User, on_delete=models.CASCADE, related_name='followers_set')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['follower', 'following'], name='unique_follow'),
            models.CheckConstraint(condition=~models.Q(follower=models.F('following')), name='no_self_follow'),
        ]
        indexes = [models.Index(fields=['following', 'follower'])]

    def __str__(self):
        return f'{self.follower_id} -> {self.following_id}'


class Avatar(models.Model):
    """Zdjęcie profilowe: kwadrat 256×256 px w formacie WebP (kilkanaście KB), przechowywany w bazie danych -
    darmowy hosting nie ma trwałego dysku, a baza przenosi się razem z resztą danych."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, primary_key=True, related_name='avatar')
    image = models.BinaryField()
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Zdjęcie {self.user_id}'


class HealthProfile(models.Model):
    """Ankieta zdrowotna - dane szczególnej kategorii (art. 9 RODO, WN-09).

    Przechowywana osobno od profilu, aby nigdy nie trafiała do danych
    udostępnianych autorom planów i aby można ją było w całości wyczyścić
    po cofnięciu zgody.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='health')
    consent_given = models.BooleanField(default=False)
    consent_date = models.DateTimeField(null=True, blank=True)
    restrictions = models.ManyToManyField(BodyArea, blank=True, related_name='restricted_users')
    notes = models.TextField(blank=True, max_length=1000)

    def withdraw_consent(self):
        self.consent_given = False
        self.consent_date = None
        self.notes = ''
        self.save()
        self.restrictions.clear()

    def __str__(self):
        return f'Ankieta zdrowotna {self.user.username}'


# --- PLANY ------------------------------------------------------------------

class WorkoutPlan(models.Model):
    """Plan treningowy (WF-08 - WF-12, WF-16)."""
    title = models.CharField(max_length=150)
    creator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_plans')
    description = models.TextField(blank=True)
    is_public = models.BooleanField(default=False)
    is_hidden = models.BooleanField(default=False)  # ukryty przez moderatora (WF-22)

    # metadane do wyszukiwania i doboru (WF-10)
    goal = models.CharField(max_length=20, choices=Goal.choices, default=Goal.GENERAL)
    level = models.CharField(max_length=20, choices=Level.choices, default=Level.BEGINNER)
    days_per_week = models.PositiveSmallIntegerField(default=3)
    duration_weeks = models.PositiveSmallIntegerField(default=8)
    required_equipment = models.JSONField(default=list, blank=True)

    # klonowanie (WF-16) i zgoda na wgląd autora w postępy (WF-04, WF-20)
    parent_plan = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='forks')
    share_progress_with_author = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} ({self.creator.username})"


class PlanDay(models.Model):
    """Jednostka treningowa w planie: plan -> tydzień -> jednostka (WF-08)."""
    plan = models.ForeignKey(WorkoutPlan, on_delete=models.CASCADE, related_name='days')
    week = models.PositiveSmallIntegerField(default=1)
    order = models.PositiveSmallIntegerField(default=0)
    name = models.CharField(max_length=100)

    class Meta:
        ordering = ['week', 'order', 'id']

    def __str__(self):
        return f'{self.plan.title}: tydz. {self.week}, {self.name}'


class LoadType(models.TextChoices):
    PERCENT = 'percent', '% 1RM'
    RPE = 'rpe', 'RPE'
    KG = 'kg', 'kg'


class PlanExercise(models.Model):
    """Pozycja planu: ćwiczenie z parametrami (WF-08, WF-09)."""
    plan = models.ForeignKey(WorkoutPlan, on_delete=models.CASCADE, related_name='exercises')
    day = models.ForeignKey(PlanDay, on_delete=models.CASCADE, null=True, blank=True,
                            related_name='exercises')
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    target_sets = models.PositiveIntegerField(default=3)
    target_reps = models.PositiveIntegerField(default=8)          # dolna granica zakresu powtórzeń
    target_reps_max = models.PositiveIntegerField(null=True, blank=True)  # górna granica (np. 8-12)
    target_rir = models.PositiveSmallIntegerField(null=True, blank=True)  # docelowy zapas powtórzeń
    load_type = models.CharField(max_length=10, choices=LoadType.choices, default=LoadType.PERCENT)
    load_value = models.FloatField(default=75.0)  # %1RM, RPE albo kg - zależnie od load_type
    rest_seconds = models.PositiveIntegerField(default=120)
    notes = models.CharField(max_length=300, blank=True)
    # ciężar wyliczony dla właściciela planu (po klonowaniu lub z jego 1RM)
    calculated_weight = models.FloatField(null=True, blank=True)
    needs_calibration = models.BooleanField(default=False)  # brak 1RM (WF-18)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.plan.title}: {self.exercise.name} {self.target_sets}x{self.target_reps}"


# --- REJESTRACJA TRENINGU ---------------------------------------------------

class WorkoutSession(models.Model):
    """Wykonana sesja treningowa (WF-23, WF-29)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')
    plan = models.ForeignKey(WorkoutPlan, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name='sessions')
    plan_day = models.ForeignKey(PlanDay, on_delete=models.SET_NULL, null=True, blank=True)
    date_completed = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True)
    post_workout_hr = models.PositiveSmallIntegerField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    # identyfikator nadany na urządzeniu - chroni przed duplikatami przy synchronizacji (WN-04)
    client_uuid = models.UUIDField(null=True, blank=True, unique=True)
    # udostępniony w Społeczności: przy profilu publicznym widzą go wszyscy, przy prywatnym tylko osoby
    # obserwowane wzajemnie; nieudostępniony widzi wyłącznie właściciel
    shared = models.BooleanField(default=False)

    class Meta:
        # historia, statystyki i raporty zawsze filtrują treningi użytkownika po dacie
        indexes = [models.Index(fields=['user', '-date_completed']),
                   # tablica Społeczności: udostępnione treningi od najnowszych
                   models.Index(fields=['shared', '-date_completed'])]

    def __str__(self):
        return f"Trening {self.user.username} - {self.date_completed:%Y-%m-%d}"


class Kudos(models.Model):
    """„Brawo” pod udostępnionym treningiem innej osoby."""
    session = models.ForeignKey('WorkoutSession', on_delete=models.CASCADE, related_name='kudos')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='kudos_given')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['session', 'user'], name='unique_kudos')]


class ExerciseSet(models.Model):
    """Pojedyncza seria (WF-24)."""
    session = models.ForeignKey(WorkoutSession, on_delete=models.CASCADE, related_name='sets')
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE)
    set_number = models.PositiveIntegerField()
    weight = models.FloatField()
    reps = models.PositiveIntegerField()
    rpe = models.FloatField(null=True, blank=True)
    # powtórzenia w zapasie do upadku mięśniowego (Reps In Reserve); RPE ≈ 10 - RIR
    rir = models.PositiveSmallIntegerField(null=True, blank=True)
    is_warmup = models.BooleanField(default=False)

    class Meta:
        ordering = ['exercise_id', 'set_number']

    def __str__(self):
        return f"{self.exercise.name} - seria {self.set_number}: {self.weight}kg x {self.reps}"


# --- POMIARY I TESTY --------------------------------------------------------

class PersonalRecord(models.Model):
    """Aktualne 1RM użytkownika w ćwiczeniu. Źródłem jest test, wpis ręczny
    albo estymacja z serii; test i wpis ręczny mają pierwszeństwo (WF-27, WF-30)."""
    SOURCES = [('test', 'Ćwiczenie testowe'), ('manual', 'Wpis ręczny'), ('estimate', 'Estymacja')]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='records')
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE)
    best_1rm = models.FloatField(default=0)
    best_weight = models.FloatField(default=0)
    source = models.CharField(max_length=10, choices=SOURCES, default='estimate')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'exercise')

    def __str__(self):
        return f"1RM {self.user.username} {self.exercise.name}: {self.best_1rm:.1f} kg ({self.source})"


class StrengthTest(models.Model):
    """Wynik ćwiczenia testowego (WF-27)."""
    PROTOCOLS = [
        ('1rm', 'Test 1RM'),
        ('3rm', 'Test 3RM'),
        ('5rm', 'Test 5RM'),
        ('amrap', 'Maks. liczba powtórzeń'),
        ('manual', 'Wpis ręczny 1RM'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='strength_tests')
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE)
    protocol = models.CharField(max_length=10, choices=PROTOCOLS)
    weight = models.FloatField(default=0)  # 0 = masa własnego ciała
    reps = models.PositiveIntegerField()
    estimated_1rm = models.FloatField(default=0)
    performed_at = models.DateTimeField(default=timezone.now)
    client_uuid = models.UUIDField(null=True, blank=True, unique=True)

    class Meta:
        ordering = ['-performed_at']
        indexes = [models.Index(fields=['user', 'exercise', '-performed_at'])]

    def __str__(self):
        return f'{self.get_protocol_display()} {self.exercise.name}: {self.weight}kg x {self.reps}'


class BodyMeasurement(models.Model):
    """Pomiary parametrów fizycznych (WF-28)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='measurements')
    measured_at = models.DateTimeField(default=timezone.now)
    body_weight = models.FloatField(null=True, blank=True)
    chest = models.FloatField(null=True, blank=True)
    waist = models.FloatField(null=True, blank=True)
    hips = models.FloatField(null=True, blank=True)
    arm = models.FloatField(null=True, blank=True)
    thigh = models.FloatField(null=True, blank=True)
    resting_hr = models.PositiveSmallIntegerField(null=True, blank=True)
    client_uuid = models.UUIDField(null=True, blank=True, unique=True)

    class Meta:
        ordering = ['-measured_at']
        indexes = [models.Index(fields=['user', '-measured_at'])]

    def __str__(self):
        return f'Pomiar {self.user.username} {self.measured_at:%Y-%m-%d}'


# --- KONSULTACJE, POWIADOMIENIA, MODERACJA ----------------------------------

class PlanComment(models.Model):
    """Wpis w wątku konsultacji przy planie (WF-19)."""
    plan = models.ForeignKey(WorkoutPlan, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='plan_comments')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE,
                               related_name='replies')
    text = models.TextField(max_length=2000)
    is_hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.author.username} @ {self.plan.title}: {self.text[:40]}'


class ExerciseNote(models.Model):
    """Prywatna notatka użytkownika do ćwiczenia, np. ustawienie maszyny."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='exercise_notes')
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE, related_name='notes')
    text = models.CharField(max_length=500)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'exercise')


class TrainingGoal(models.Model):
    """Cel siłowy: docelowe 1RM w ćwiczeniu, opcjonalnie z terminem."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='goals')
    exercise = models.ForeignKey(Exercise, on_delete=models.CASCADE)
    target_1rm = models.FloatField()
    deadline = models.DateField(null=True, blank=True)
    start_1rm = models.FloatField(default=0)  # 1RM w chwili ustawienia celu - punkt startowy postępu
    created_at = models.DateTimeField(auto_now_add=True)
    achieved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['achieved_at', '-created_at']

    def __str__(self):
        return f'Cel {self.user.username}: {self.exercise.name} {self.target_1rm} kg'


class Notification(models.Model):
    """Powiadomienie w aplikacji (WF-19)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    text = models.CharField(max_length=300)
    url = models.CharField(max_length=200, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class ReportDecision(models.TextChoices):
    HIDDEN = 'hidden', 'Treść ukryta'
    DISMISSED = 'dismissed', 'Zgłoszenie odrzucone'
    RESTORED = 'restored', 'Treść przywrócona'


class ContentReport(models.Model):
    """Zgłoszenie nieodpowiedniej treści (WF-22) wraz z decyzją moderatora."""
    reporter = models.ForeignKey(User, on_delete=models.CASCADE, related_name='content_reports')
    plan = models.ForeignKey(WorkoutPlan, null=True, blank=True, on_delete=models.CASCADE)
    comment = models.ForeignKey(PlanComment, null=True, blank=True, on_delete=models.CASCADE)
    reason = models.CharField(max_length=300)
    resolved = models.BooleanField(default=False)
    decision = models.CharField(max_length=10, choices=ReportDecision.choices, blank=True)
    moderator_note = models.CharField(max_length=300, blank=True)
    resolved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='resolved_reports')
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['resolved', '-created_at'])]

    def __str__(self):
        target = self.plan or self.comment
        return f'Zgłoszenie: {target} - {self.reason[:40]}'


class SusResponse(models.Model):
    """Odpowiedź na kwestionariusz SUS (System Usability Scale) - weryfikacja wymagania WN-10.
    Każdy użytkownik ma jedną odpowiedź (może ją poprawić); wynik 0-100 liczony przy zapisie."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='sus_response')
    answers = models.JSONField()  # 10 ocen 1-5 w kolejności pytań
    score = models.FloatField()
    comment = models.TextField(blank=True, max_length=1000)
    created_at = models.DateTimeField(auto_now=True)

    @staticmethod
    def compute_score(answers: list[int]) -> float:
        """Pytania nieparzyste: ocena - 1, parzyste: 5 - ocena; suma x 2,5 (Brooke 1996)."""
        return 2.5 * sum((a - 1) if i % 2 == 0 else (5 - a) for i, a in enumerate(answers))

    def __str__(self):
        return f'SUS {self.user.username}: {self.score:g}'
