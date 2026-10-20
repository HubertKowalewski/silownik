"""Serializery REST API."""
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .analytics import goal_status
from .models import (
    BodyArea,
    BodyMeasurement,
    Equipment,
    Exercise,
    ExerciseSet,
    HealthProfile,
    Notification,
    PlanComment,
    PlanDay,
    PlanExercise,
    StrengthTest,
    SusResponse,
    TrainingGoal,
    UserProfile,
    WorkoutPlan,
    WorkoutSession,
)


def in_range(lo, hi, message=None):
    """Walidator pola liczbowego: wartość pusta jest dozwolona, inna musi mieścić się w [lo, hi]."""
    def validator(value):
        if value is not None and not lo <= value <= hi:
            raise serializers.ValidationError(message or f'Wartość poza zakresem {lo}-{hi}.')
    return validator


# --- KONTO -------------------------------------------------------------------

class UserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'is_staff', 'avatar_url']

    def get_avatar_url(self, obj) -> str | None:
        from .avatars import avatar_url_for
        return avatar_url_for(obj)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password2 = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'password2']

    email = serializers.EmailField(required=True)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Konto z tym adresem e-mail już istnieje.")
        return value

    def validate_username(self, value):
        value = value.strip()
        if len(value) < 3:
            raise serializers.ValidationError("Nazwa użytkownika musi mieć min. 3 znaki.")
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("Ta nazwa użytkownika jest już zajęta.")
        return value

    def validate(self, attrs):
        if attrs['password'] != attrs.pop('password2'):
            raise serializers.ValidationError({'password2': "Hasła nie są identyczne."})
        return attrs

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=validated_data['password'],
        )
        return user  # profile tworzy sygnał post_save (signals.py)


class AccountSerializer(serializers.ModelSerializer):
    """Zmiana adresu e-mail używanego m.in. do odzyskiwania hasła."""
    email = serializers.EmailField(required=True)

    class Meta:
        model = User
        fields = ['email', 'first_name']

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError('Ten adres e-mail jest już używany.')
        return value


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True)
    password2 = serializers.CharField(write_only=True)

    def validate(self, attrs):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_str
        from django.utils.http import urlsafe_base64_decode
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(attrs['uid'])))
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            user = None
        if user is None or not default_token_generator.check_token(user, attrs['token']):
            raise serializers.ValidationError('Link do zmiany hasła jest nieprawidłowy lub wygasł.')
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError({'password2': 'Hasła nie są identyczne.'})
        validate_password(attrs['password'], user)
        attrs['user'] = user
        return attrs


class BodyAreaSerializer(serializers.ModelSerializer):
    class Meta:
        model = BodyArea
        fields = ['id', 'code', 'name']


class ProfileSerializer(serializers.ModelSerializer):
    """Profil treningowy (WF-02) + ankieta zdrowotna (WF-03)."""
    health_consent = serializers.BooleanField(source='user.health.consent_given', required=False)
    health_consent_date = serializers.DateTimeField(source='user.health.consent_date', read_only=True)
    restrictions = serializers.PrimaryKeyRelatedField(
        source='user.health.restrictions', many=True, queryset=BodyArea.objects.all(), required=False)
    health_notes = serializers.CharField(source='user.health.notes', required=False, allow_blank=True,
                                         max_length=1000)

    class Meta:
        model = UserProfile
        fields = ['birth_year', 'sex', 'height_cm', 'level', 'goal', 'days_per_week', 'equipment',
                  'load_increment', 'default_rest_seconds', 'rest_step_seconds', 'rest_auto_start',
                  'rest_sound', 'rest_vibrate', 'effort_scale', 'profile_public', 'trainings_public', 'share_workouts_default', 'health_consent', 'health_consent_date', 'restrictions',
                  'health_notes']
        extra_kwargs = {
            'days_per_week': {'validators': [in_range(1, 7, 'Liczba dni musi mieścić się w zakresie 1-7.')]},
            'load_increment': {'validators': [in_range(0.25, 10, 'Przyrost obciążenia: 0,25-10 kg.')]},
            'default_rest_seconds': {'validators': [in_range(10, 900, 'Przerwa: 10-900 s.')]},
            'rest_step_seconds': {'validators': [in_range(5, 60, 'Krok zmiany przerwy: 5-60 s.')]},
        }

    def validate_equipment(self, value):
        valid = set(Equipment.values)
        if not isinstance(value, list) or not set(value) <= valid:
            raise serializers.ValidationError('Nieznany rodzaj sprzętu.')
        return value





    def update(self, instance, validated_data):
        user_data = validated_data.pop('user', {})
        health_data = user_data.get('health', {})
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if not instance.profile_public:
            instance.trainings_public = False  # treningi widoczne tylko w publicznym profilu
        instance.save()

        health, _ = HealthProfile.objects.get_or_create(user=instance.user)
        consent = health_data.get('consent_given', health.consent_given)
        if not consent:
            # bez zgody nie przechowujemy żadnych danych o zdrowiu (WN-09)
            if health.consent_given or health.restrictions.exists() or health.notes:
                health.withdraw_consent()
            return instance
        if not health.consent_given:
            health.consent_given = True
            health.consent_date = timezone.now()
        if 'notes' in health_data:
            health.notes = health_data['notes']
        health.save()
        if 'restrictions' in health_data:
            health.restrictions.set(health_data['restrictions'])
        return instance


# --- ĆWICZENIA ---------------------------------------------------------------

class ExerciseSerializer(serializers.ModelSerializer):
    stressed_areas = serializers.PrimaryKeyRelatedField(many=True, queryset=BodyArea.objects.all(),
                                                        required=False)
    is_custom = serializers.SerializerMethodField()
    times_used = serializers.SerializerMethodField()

    class Meta:
        model = Exercise
        fields = ['id', 'name', 'muscle_group', 'secondary_muscles', 'equipment', 'description',
                  'stressed_areas', 'is_custom', 'times_used']

    def get_times_used(self, obj) -> int:
        return getattr(obj, 'times_used', 0)

    def get_is_custom(self, obj) -> bool:
        return obj.created_by_id is not None


# --- SESJE -------------------------------------------------------------------

class ExerciseSetSerializer(serializers.ModelSerializer):
    exercise_name = serializers.ReadOnlyField(source='exercise.name')

    class Meta:
        model = ExerciseSet
        fields = ['id', 'exercise', 'exercise_name', 'set_number', 'weight', 'reps', 'rpe', 'rir', 'is_warmup']
        extra_kwargs = {
            'weight': {'validators': [in_range(0, 1000, 'Ciężar musi mieścić się w zakresie 0-1000 kg.')]},
            'reps': {'validators': [in_range(1, 200, 'Liczba powtórzeń musi mieścić się w zakresie 1-200.')]},
            'rir': {'validators': [in_range(0, 10, 'RIR musi mieścić się w zakresie 0-10.')]},
            'rpe': {'validators': [in_range(1, 10, 'RPE musi mieścić się w zakresie 1-10.')]},
        }




    def validate(self, attrs):
        # RIR i RPE opisują to samo (RPE = 10 - RIR) - uzupełniamy brakującą wartość
        rir, rpe = attrs.get('rir'), attrs.get('rpe')
        if rir is not None and rpe is None:
            attrs['rpe'] = float(max(1, 10 - rir))
        elif rpe is not None and rir is None:
            attrs['rir'] = round(10 - rpe)
        return attrs



class WorkoutSessionSerializer(serializers.ModelSerializer):
    sets = ExerciseSetSerializer(many=True, required=False)
    plan_title = serializers.ReadOnlyField(source='plan.title')
    day_name = serializers.ReadOnlyField(source='plan_day.name')
    total_tonnage = serializers.SerializerMethodField()

    class Meta:
        model = WorkoutSession
        fields = ['id', 'client_uuid', 'plan', 'plan_title', 'plan_day', 'day_name', 'date_completed',
                  'notes', 'post_workout_hr', 'duration_seconds', 'sets', 'total_tonnage', 'shared']
        extra_kwargs = {
            'client_uuid': {'validators': []}, 'date_completed': {'required': False},
            'post_workout_hr': {'validators': [in_range(30, 230, 'Tętno poza zakresem 30-230.')]},
            'duration_seconds': {'validators': [in_range(0, 6 * 3600, 'Czas treningu nie może przekraczać 6 godzin.')]},
        }

    def get_total_tonnage(self, obj) -> int:
        return int(sum(s.weight * s.reps for s in obj.sets.all() if not s.is_warmup))

    def validate_plan(self, plan):
        user = self.context['request'].user
        if plan and plan.creator_id != user.id and not plan.is_public:
            raise serializers.ValidationError("Nie masz dostępu do tego planu.")
        return plan

    def validate_date_completed(self, value):
        if value and value > timezone.now() + timezone.timedelta(minutes=5):
            raise serializers.ValidationError('Data treningu nie może być z przyszłości.')
        return value



    def validate(self, attrs):
        day, plan = attrs.get('plan_day'), attrs.get('plan')
        if day and plan and day.plan_id != plan.id:
            raise serializers.ValidationError({'plan_day': 'Jednostka nie należy do wybranego planu.'})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        sets_data = validated_data.pop('sets', [])
        user = self.context['request'].user
        if 'shared' not in validated_data:   # bez wyboru w aplikacji - ustawienie domyślne z profilu
            profile = getattr(user, 'profile', None)
            validated_data['shared'] = bool(getattr(profile, 'share_workouts_default', False))
        session = WorkoutSession.objects.create(user=user, **validated_data)
        ExerciseSet.objects.bulk_create([ExerciseSet(session=session, **s) for s in sets_data])
        return session

    @transaction.atomic
    def update(self, instance, validated_data):
        sets_data = validated_data.pop('sets', None)
        validated_data.pop('client_uuid', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if sets_data is not None:
            instance.sets.all().delete()
            ExerciseSet.objects.bulk_create([ExerciseSet(session=instance, **s) for s in sets_data])
        return instance


# --- POMIARY I TESTY ---------------------------------------------------------

class BodyMeasurementSerializer(serializers.ModelSerializer):
    class Meta:
        model = BodyMeasurement
        fields = ['id', 'client_uuid', 'measured_at', 'body_weight', 'chest', 'waist', 'hips', 'arm',
                  'thigh', 'resting_hr']
        RANGES = {'body_weight': (20, 400), 'chest': (30, 250), 'waist': (30, 250), 'hips': (30, 250),
                  'arm': (10, 100), 'thigh': (20, 150), 'resting_hr': (25, 220)}
        extra_kwargs = {'client_uuid': {'validators': []}, 'measured_at': {'required': False},
                        **{f: {'validators': [in_range(lo, hi)]} for f, (lo, hi) in RANGES.items()}}

    def validate(self, attrs):
        if all(attrs.get(field) is None for field in self.Meta.RANGES):
            raise serializers.ValidationError('Podaj co najmniej jeden pomiar.')
        return attrs


class StrengthTestSerializer(serializers.ModelSerializer):
    exercise_name = serializers.ReadOnlyField(source='exercise.name')
    protocol_name = serializers.ReadOnlyField(source='get_protocol_display')

    class Meta:
        model = StrengthTest
        fields = ['id', 'client_uuid', 'exercise', 'exercise_name', 'protocol', 'protocol_name', 'weight',
                  'reps', 'estimated_1rm', 'performed_at']
        read_only_fields = ['estimated_1rm']
        extra_kwargs = {'client_uuid': {'validators': []}, 'performed_at': {'required': False}}

    def validate(self, attrs):
        protocol, reps, weight = attrs.get('protocol'), attrs.get('reps', 0), attrs.get('weight', 0)
        expected = {'1rm': 1, '3rm': 3, '5rm': 5, 'manual': 1}.get(protocol)
        if expected and reps != expected:
            raise serializers.ValidationError({'reps': f'Protokół {protocol.upper()} wymaga {expected} powt.'})
        if not 0 <= weight <= 1000:
            raise serializers.ValidationError({'weight': 'Ciężar poza zakresem 0-1000 kg.'})
        if not 1 <= reps <= 200:
            raise serializers.ValidationError({'reps': 'Powtórzenia poza zakresem 1-200.'})
        return attrs


# --- PLANY -------------------------------------------------------------------

class PlanExerciseSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
    exercise_name = serializers.ReadOnlyField(source='exercise.name')
    muscle_group = serializers.ReadOnlyField(source='exercise.muscle_group')

    class Meta:
        model = PlanExercise
        fields = ['id', 'exercise', 'exercise_name', 'muscle_group', 'order', 'target_sets', 'target_reps',
                  'target_reps_max', 'target_rir',
                  'load_type', 'load_value', 'rest_seconds', 'notes', 'calculated_weight',
                  'needs_calibration']
        read_only_fields = ['calculated_weight', 'needs_calibration']

    def validate(self, attrs):
        load_type, value = attrs.get('load_type', 'percent'), attrs.get('load_value', 75)
        limits = {'percent': (1, 110), 'rpe': (1, 10), 'kg': (0, 1000)}[load_type]
        if not limits[0] <= value <= limits[1]:
            raise serializers.ValidationError({'load_value': f'Wartość poza zakresem {limits[0]}-{limits[1]}.'})
        if not 1 <= attrs.get('target_sets', 3) <= 20:
            raise serializers.ValidationError({'target_sets': 'Liczba serii: 1-20.'})
        if not 1 <= attrs.get('target_reps', 8) <= 100:
            raise serializers.ValidationError({'target_reps': 'Liczba powtórzeń: 1-100.'})
        reps_max = attrs.get('target_reps_max')
        if reps_max is not None and not attrs.get('target_reps', 8) <= reps_max <= 100:
            raise serializers.ValidationError({'target_reps_max': 'Górna granica zakresu musi być ≥ dolnej i ≤ 100.'})
        if attrs.get('target_rir') is not None and attrs['target_rir'] > 10:
            raise serializers.ValidationError({'target_rir': 'Docelowy RIR: 0-10.'})
        return attrs


class PlanDaySerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
    exercises = PlanExerciseSerializer(many=True, required=False)

    class Meta:
        model = PlanDay
        fields = ['id', 'week', 'order', 'name', 'exercises']


class WorkoutPlanSerializer(serializers.ModelSerializer):
    days = PlanDaySerializer(many=True, required=False)
    creator_name = serializers.ReadOnlyField(source='creator.username')
    parent_title = serializers.ReadOnlyField(source='parent_plan.title')
    parent_creator = serializers.ReadOnlyField(source='parent_plan.creator.username')
    fork_count = serializers.SerializerMethodField()
    exercise_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = WorkoutPlan
        fields = ['id', 'title', 'description', 'is_public', 'goal', 'level', 'days_per_week',
                  'duration_weeks', 'required_equipment', 'creator_name', 'parent_plan', 'parent_title',
                  'parent_creator', 'share_progress_with_author', 'created_at', 'updated_at', 'days',
                  'fork_count', 'exercise_count', 'comment_count', 'is_owner', 'is_hidden']
        read_only_fields = ['created_at', 'updated_at', 'parent_plan', 'is_hidden']

    # liczniki z adnotacji zapytania (views.plans.with_details); bez niej - osobne zapytanie
    def get_fork_count(self, obj) -> int:
        return obj.n_forks if hasattr(obj, 'n_forks') else obj.forks.count()

    def get_exercise_count(self, obj) -> int:
        return obj.n_exercises if hasattr(obj, 'n_exercises') else obj.exercises.count()

    def get_comment_count(self, obj) -> int:
        return obj.n_comments if hasattr(obj, 'n_comments') else obj.comments.filter(is_hidden=False).count()

    def get_is_owner(self, obj) -> bool:
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.creator_id == request.user.id)

    def validate_title(self, value):
        value = value.strip()
        if len(value) < 3:
            raise serializers.ValidationError('Nazwa planu musi mieć min. 3 znaki.')
        return value

    def validate_required_equipment(self, value):
        if not isinstance(value, list) or not set(value) <= set(Equipment.values):
            raise serializers.ValidationError('Nieznany rodzaj sprzętu.')
        return value

    def validate(self, attrs):
        if attrs.get('is_public') and self.instance is None and not attrs.get('days'):
            raise serializers.ValidationError('Nie można opublikować pustego planu.')
        return attrs

    def _write_days(self, plan, days):
        plan.days.all().delete()  # kaskadowo usuwa pozycje
        for d_index, day in enumerate(days):
            exercises = day.pop('exercises', [])
            day.pop('id', None)
            day.setdefault('order', d_index)
            day_obj = PlanDay.objects.create(plan=plan, **day)
            PlanExercise.objects.bulk_create([
                PlanExercise(plan=plan, day=day_obj,
                             **{**{k: v for k, v in e.items() if k != 'id'}, 'order': e.get('order', i)})
                for i, e in enumerate(exercises)
            ])

    @transaction.atomic
    def create(self, validated_data):
        days = validated_data.pop('days', [])
        plan = WorkoutPlan.objects.create(creator=self.context['request'].user, **validated_data)
        self._write_days(plan, days)
        return plan

    @transaction.atomic
    def update(self, instance, validated_data):
        days = validated_data.pop('days', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if days is not None:
            self._write_days(instance, days)
        return instance


class PlanCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.ReadOnlyField(source='author.username')
    author_avatar = serializers.SerializerMethodField()
    is_plan_author = serializers.SerializerMethodField()

    class Meta:
        model = PlanComment
        fields = ['id', 'plan', 'author_name', 'author_avatar', 'is_plan_author', 'parent', 'text', 'created_at']
        read_only_fields = ['plan', 'created_at']

    def get_author_avatar(self, obj) -> str | None:
        from .avatars import avatar_url_for
        return avatar_url_for(obj.author)

    def get_is_plan_author(self, obj) -> bool:
        return obj.author_id == obj.plan.creator_id

    def validate_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Treść nie może być pusta.')
        return value


class TrainingGoalSerializer(serializers.ModelSerializer):
    exercise_name = serializers.ReadOnlyField(source='exercise.name')
    status = serializers.SerializerMethodField()

    class Meta:
        model = TrainingGoal
        fields = ['id', 'exercise', 'exercise_name', 'target_1rm', 'deadline', 'start_1rm', 'created_at',
                  'achieved_at', 'status']
        read_only_fields = ['start_1rm', 'created_at', 'achieved_at']

    def get_status(self, obj) -> dict:
        return goal_status(obj)

    def validate_target_1rm(self, value):
        if not 1 <= value <= 1000:
            raise serializers.ValidationError('Cel 1RM: 1-1000 kg.')
        return value

    def validate_deadline(self, value):
        if value and value <= timezone.localdate():
            raise serializers.ValidationError('Termin musi być w przyszłości.')
        return value


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'text', 'url', 'is_read', 'created_at']


class SusResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = SusResponse
        fields = ['answers', 'score', 'comment', 'created_at']
        read_only_fields = ['score', 'created_at']

    def validate_answers(self, value):
        if not isinstance(value, list) or len(value) != 10 or any(
                not isinstance(a, int) or isinstance(a, bool) or not 1 <= a <= 5 for a in value):
            raise serializers.ValidationError('Podaj 10 odpowiedzi w skali 1-5.')
        return value
