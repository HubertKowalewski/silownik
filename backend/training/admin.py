"""Panel administratora: baza ćwiczeń, moderacja treści, podgląd danych (aktor Administrator)."""
from django.contrib import admin

from . import moderation
from .models import (
    BodyArea,
    ContentReport,
    Exercise,
    PlanComment,
    PlanDay,
    PlanExercise,
    ReportDecision,
    SusResponse,
    WorkoutPlan,
)


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ('name', 'muscle_group', 'equipment', 'created_by')
    list_filter = ('muscle_group', 'equipment', 'stressed_areas')
    search_fields = ('name', 'muscle_group')
    filter_horizontal = ('stressed_areas',)


@admin.register(BodyArea)
class BodyAreaAdmin(admin.ModelAdmin):
    list_display = ('name', 'code')


class PlanExerciseInline(admin.TabularInline):
    model = PlanExercise
    extra = 0
    autocomplete_fields = ('exercise',)


@admin.register(PlanDay)
class PlanDayAdmin(admin.ModelAdmin):
    list_display = ('plan', 'week', 'order', 'name')
    inlines = [PlanExerciseInline]


@admin.register(WorkoutPlan)
class WorkoutPlanAdmin(admin.ModelAdmin):
    list_display = ('title', 'creator', 'is_public', 'is_hidden', 'level', 'goal', 'created_at')
    list_filter = ('is_public', 'is_hidden', 'level', 'goal')
    search_fields = ('title', 'creator__username')
    actions = ['hide', 'unhide']

    @admin.action(description='Ukryj wybrane plany (moderacja)')
    def hide(self, request, queryset):
        queryset.update(is_hidden=True)

    @admin.action(description='Przywróć widoczność')
    def unhide(self, request, queryset):
        queryset.update(is_hidden=False)


@admin.register(PlanComment)
class PlanCommentAdmin(admin.ModelAdmin):
    list_display = ('plan', 'author', 'short_text', 'is_hidden', 'created_at')
    list_filter = ('is_hidden',)
    actions = ['hide']

    @admin.display(description='Treść')
    def short_text(self, obj):
        return obj.text[:60]

    @admin.action(description='Ukryj wybrane wpisy (moderacja)')
    def hide(self, request, queryset):
        queryset.update(is_hidden=True)


@admin.register(ContentReport)
class ContentReportAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'reporter', 'resolved', 'decision', 'resolved_by', 'created_at')
    list_filter = ('resolved', 'decision')
    readonly_fields = ('resolved_by', 'resolved_at')
    actions = ['hide_and_resolve', 'resolve']

    def _decide(self, request, queryset, decision):
        for report in queryset.filter(resolved=False):
            report.refresh_from_db()
            if not report.resolved and moderation.target_of(report):
                moderation.decide(report, decision, request.user)

    @admin.action(description='Ukryj zgłoszoną treść i zamknij zgłoszenia')
    def hide_and_resolve(self, request, queryset):
        self._decide(request, queryset, ReportDecision.HIDDEN)

    @admin.action(description='Odrzuć zgłoszenia bez zmian w treści')
    def resolve(self, request, queryset):
        self._decide(request, queryset, ReportDecision.DISMISSED)


@admin.register(SusResponse)
class SusResponseAdmin(admin.ModelAdmin):
    list_display = ('user', 'score', 'created_at')
    readonly_fields = ('user', 'answers', 'score', 'comment', 'created_at')
