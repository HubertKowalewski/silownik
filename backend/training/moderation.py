"""Moderacja treści (WF-22): decyzje moderatora wspólne dla panelu w aplikacji i panelu administratora.

Zgłoszenia dotyczą planu albo komentarza. Decyzja zamyka wszystkie otwarte zgłoszenia tej samej treści,
a autor treści i zgłaszający dostają powiadomienie.
"""
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from .models import ContentReport, Notification, PlanComment, ReportDecision, WorkoutPlan


class ModerationError(Exception):
    pass


def target_of(report: ContentReport) -> WorkoutPlan | PlanComment | None:
    return report.plan or report.comment


def author_of(target) -> User:
    return target.creator if isinstance(target, WorkoutPlan) else target.author


def same_target_reports(report: ContentReport):
    return ContentReport.objects.filter(plan=report.plan, comment=report.comment)


def _notify(user, text, url=''):
    Notification.objects.create(user=user, text=text[:300], url=url)


def _target_label(target) -> str:
    if isinstance(target, WorkoutPlan):
        return f'plan „{target.title}”'
    return f'komentarz przy planie „{target.plan.title}”'


@transaction.atomic
def decide(report: ContentReport, decision: str, moderator: User, note: str = '') -> int:
    """Wykonuje decyzję dla treści wskazanej w zgłoszeniu; zwraca liczbę zamkniętych zgłoszeń.

    hidden    - ukrywa treść i zamyka wszystkie otwarte zgłoszenia tej treści,
    dismissed - zamyka zgłoszenia bez zmian w treści,
    restored  - przywraca wcześniej ukrytą treść (np. po odwołaniu autora).
    """
    target = target_of(report)
    if target is None:
        raise ModerationError('Zgłoszona treść już nie istnieje.')
    if decision not in ReportDecision.values:
        raise ModerationError('Nieznana decyzja.')
    if decision == ReportDecision.RESTORED and not target.is_hidden:
        raise ModerationError('Ta treść nie jest ukryta.')

    if decision in (ReportDecision.HIDDEN, ReportDecision.RESTORED):
        target.is_hidden = decision == ReportDecision.HIDDEN
        target.save(update_fields=['is_hidden'])

    now = timezone.now()
    fields = {'decision': decision, 'moderator_note': note[:300], 'resolved_by': moderator, 'resolved_at': now}
    if decision == ReportDecision.RESTORED:
        # przywrócenie dopisujemy do ostatniej decyzji - historia zgłoszeń zostaje zamknięta
        closed = same_target_reports(report).filter(resolved=True).update(**fields)
    else:
        open_reports = same_target_reports(report).filter(resolved=False)
        reporters = set(open_reports.values_list('reporter_id', flat=True))
        closed = open_reports.update(resolved=True, **fields)
        verdict = 'treść została ukryta' if decision == ReportDecision.HIDDEN else 'nie stwierdzono naruszenia'
        for user in User.objects.filter(id__in=reporters):
            _notify(user, f'Rozpatrzono Twoje zgłoszenie: {_target_label(target)} - {verdict}.')

    url = f'/plany/{target.id if isinstance(target, WorkoutPlan) else target.plan_id}'
    if decision == ReportDecision.HIDDEN:
        reason = f' Powód: {note}' if note else ''
        _notify(author_of(target), f'Moderator ukrył {_target_label(target)}.{reason}', url)
    elif decision == ReportDecision.RESTORED:
        _notify(author_of(target), f'Moderator przywrócił {_target_label(target)}.', url)
    return closed


def set_blocked(user: User, blocked: bool, moderator: User):
    """Blokada konta (is_active=False uniemożliwia logowanie). Nie dotyczy kont personelu ani siebie."""
    if user.is_staff or user.is_superuser or user.id == moderator.id:
        raise ModerationError('Nie można zablokować tego konta.')
    user.is_active = not blocked
    user.save(update_fields=['is_active'])
    if blocked:
        # ukryj publiczne treści zablokowanego użytkownika
        WorkoutPlan.objects.filter(creator=user, is_public=True).update(is_hidden=True)
        PlanComment.objects.filter(author=user).update(is_hidden=True)


def report_rows(resolved: bool):
    """Zgłoszenia do listy w panelu - z liczbą zgłoszeń tej samej treści."""
    qs = (ContentReport.objects.filter(resolved=resolved)
          .select_related('reporter', 'resolved_by', 'plan__creator', 'comment__author', 'comment__plan')
          .order_by('-created_at'))
    per_target = {
        (row['plan_id'], row['comment_id']): row['n']
        for row in qs.order_by().values('plan_id', 'comment_id').annotate(n=Count('id'))
    }
    rows = []
    for r in qs[:200]:
        target = target_of(r)
        if target is None:
            continue
        author = author_of(target)
        is_plan = isinstance(target, WorkoutPlan)
        rows.append({
            'id': r.id, 'kind': 'plan' if is_plan else 'comment',
            'reason': r.reason, 'reporter': r.reporter.username, 'created_at': r.created_at,
            'reports_count': per_target.get((r.plan_id, r.comment_id), 1),
            'target_id': target.id,
            'plan_id': target.id if is_plan else target.plan_id,
            'title': target.title if is_plan else target.plan.title,
            'content': (target.description or '')[:500] if is_plan else target.text[:500],
            'author': author.username, 'author_id': author.id, 'author_blocked': not author.is_active,
            'author_is_staff': author.is_staff,
            'is_hidden': target.is_hidden,
            'decision': r.decision, 'moderator_note': r.moderator_note,
            'resolved_by': r.resolved_by.username if r.resolved_by else None, 'resolved_at': r.resolved_at,
        })
    return rows


def open_count() -> int:
    return ContentReport.objects.filter(resolved=False).values('plan_id', 'comment_id').distinct().count()


def has_open_report(reporter: User, *, plan=None, comment=None) -> bool:
    return ContentReport.objects.filter(Q(plan=plan) & Q(comment=comment), reporter=reporter, resolved=False).exists()
