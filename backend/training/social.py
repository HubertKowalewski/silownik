"""Społeczność: obserwowanie, widoczność treningów i tablica (feed).

Zasady widoczności treningu (WorkoutSession) dla oglądającego `viewer`:
  * trening nieudostępniony (shared=False) - widzi tylko właściciel,
  * udostępniony, profil publiczny właściciela - widzą wszyscy zalogowani,
  * udostępniony, profil prywatny - widzą tylko osoby, z którymi właściciel obserwuje się wzajemnie,
  * treningi zablokowanych kont (is_active=False) nie są pokazywane.
Na tablicy nie są pokazywane notatki ani tętno - tylko ćwiczenia, serie robocze, objętość i czas.
"""
from __future__ import annotations

from collections import OrderedDict

from django.contrib.auth.models import User
from django.db.models import Count, Exists, OuterRef, Q

from .avatars import avatar_url
from .models import Follow, Kudos, Notification, WorkoutSession

FEED_PAGE = 20


# --- obserwowanie ------------------------------------------------------------

def following_ids(user) -> set[int]:
    return set(Follow.objects.filter(follower=user).values_list('following_id', flat=True))


def follower_ids(user) -> set[int]:
    return set(Follow.objects.filter(following=user).values_list('follower_id', flat=True))


def mutual_ids(user) -> set[int]:
    return following_ids(user) & follower_ids(user)


def relation(viewer, other) -> dict:
    """Stan obserwowania między oglądającym a inną osobą."""
    if viewer.id == other.id:
        return {'is_self': True, 'i_follow': False, 'follows_me': False, 'mutual': False}
    i_follow = Follow.objects.filter(follower=viewer, following=other).exists()
    follows_me = Follow.objects.filter(follower=other, following=viewer).exists()
    return {'is_self': False, 'i_follow': i_follow, 'follows_me': follows_me, 'mutual': i_follow and follows_me}


def follow(viewer, other) -> dict:
    if viewer.id == other.id:
        raise ValueError('Nie możesz obserwować samego siebie.')
    _, created = Follow.objects.get_or_create(follower=viewer, following=other)
    rel = relation(viewer, other)
    if created:
        text = (f'{viewer.username} też Cię obserwuje - obserwujecie się wzajemnie.' if rel['mutual']
                else f'{viewer.username} obserwuje Cię od teraz.')
        Notification.objects.create(user=other, text=text[:300], url=f'/uzytkownicy/{viewer.username}')
    return rel


def unfollow(viewer, other) -> dict:
    Follow.objects.filter(follower=viewer, following=other).delete()
    return relation(viewer, other)


def counts(user) -> dict:
    return {'followers': Follow.objects.filter(following=user).count(),
            'following': Follow.objects.filter(follower=user).count()}


# --- widoczność treningów ----------------------------------------------------

def visible_sessions(viewer, owners=None):
    """Treningi innych osób (i własne udostępnione), które `viewer` może zobaczyć."""
    mutual = mutual_ids(viewer)
    qs = (WorkoutSession.objects.filter(shared=True, user__is_active=True)
          .filter(Q(user__profile__profile_public=True) | Q(user_id__in=mutual) | Q(user=viewer)))
    if owners is not None:
        qs = qs.filter(user_id__in=owners)
    return qs


def can_see_session(viewer, session) -> bool:
    if session.user_id == viewer.id:
        return True
    return visible_sessions(viewer).filter(pk=session.pk).exists()


def feed(viewer, tab='all', before=None, owner=None):
    """Strona tablicy (od najnowszych). tab: 'all' - wszystko, co widzę; 'following' - tylko obserwowani."""
    owners = None
    if owner is not None:
        owners = [owner.id]
    elif tab == 'following':
        owners = following_ids(viewer)
    qs = visible_sessions(viewer, owners)
    if before:
        # kursor (data, id): treningi z identyczną godziną na granicy stron nie znikają
        when, last_id = before
        qs = qs.filter(Q(date_completed__lt=when) | Q(date_completed=when, id__lt=last_id) if last_id
                       else Q(date_completed__lt=when))
    qs = (qs.select_related('user__profile', 'plan', 'plan_day')
          .prefetch_related('sets__exercise')
          .annotate(n_kudos=Count('kudos', distinct=True),
                    my_kudos=Exists(Kudos.objects.filter(session=OuterRef('pk'), user=viewer)))
          .order_by('-date_completed', '-id')[:FEED_PAGE + 1])
    items = list(qs)
    has_more = len(items) > FEED_PAGE
    items = items[:FEED_PAGE]
    return {
        'results': [feed_item(s, viewer) for s in items],
        'next': f'{items[-1].date_completed.isoformat()}~{items[-1].id}' if has_more and items else None,
    }


def _fmt(weight: float) -> str:
    return f'{weight:g}'.replace('.', ',')


def feed_item(session, viewer) -> dict:
    """Trening na tablicy: kto, kiedy, plan, czas, objętość i ćwiczenia z seriami roboczymi."""
    exercises: OrderedDict[int, dict] = OrderedDict()
    tonnage, working = 0.0, 0
    for s in sorted(session.sets.all(), key=lambda x: (x.id,)):
        if s.is_warmup:
            continue
        working += 1
        tonnage += s.weight * s.reps
        entry = exercises.setdefault(s.exercise_id, {'name': s.exercise.name, 'sets': [], 'best': 0.0})
        entry['sets'].append(f'{_fmt(s.weight)}×{s.reps}' if s.weight else f'{s.reps}')
        entry['best'] = max(entry['best'], s.weight)
    owner = session.user
    profile = getattr(owner, 'profile', None)
    return {
        'id': session.id,
        'user': {'username': owner.username,
                 'avatar_url': avatar_url(owner.id, getattr(profile, 'avatar_version', None))},
        'is_own': owner.id == viewer.id,
        'date': session.date_completed.isoformat(),
        'title': session.plan_day.name if session.plan_day_id else (session.plan.title if session.plan_id else 'Trening'),
        'plan_title': session.plan.title if session.plan_id else None,
        'duration_seconds': session.duration_seconds,
        'tonnage': round(tonnage),
        'sets': working,
        'exercises': [{'name': e['name'], 'sets': e['sets']} for e in exercises.values()],
        'kudos': session.n_kudos if hasattr(session, 'n_kudos') else session.kudos.count(),
        'my_kudos': bool(getattr(session, 'my_kudos', False)),
    }


# --- brawa -------------------------------------------------------------------

def give_kudos(viewer, session) -> None:
    _, created = Kudos.objects.get_or_create(session=session, user=viewer)
    if created and session.user_id != viewer.id:
        Notification.objects.create(
            user=session.user, url='/spolecznosc',
            text=f'{viewer.username} bije brawo za Twój trening z {session.date_completed:%d.%m}.')


def take_kudos(viewer, session) -> None:
    Kudos.objects.filter(session=session, user=viewer).delete()


# --- wyszukiwanie ludzi ------------------------------------------------------

def search_people(viewer, query: str, limit=20):
    """Profile publiczne po fragmencie nazwy; profil prywatny tylko po dokładnej nazwie
    (trzeba ją znać - np. od znajomego), aby dało się go obserwować i odwzajemnić obserwowanie."""
    query = query.strip()
    base = User.objects.filter(is_active=True).exclude(pk=viewer.pk).select_related('profile')
    if not query:
        return []
    qs = base.filter(Q(username__icontains=query, profile__profile_public=True) | Q(username__iexact=query))
    return list(qs.order_by('username')[:limit])


def person(viewer, user, following=None, followers=None) -> dict:
    following = following_ids(viewer) if following is None else following
    followers = follower_ids(viewer) if followers is None else followers
    profile = getattr(user, 'profile', None)
    return {
        'username': user.username,
        'avatar_url': avatar_url(user.id, getattr(profile, 'avatar_version', None)),
        'profile_public': bool(getattr(profile, 'profile_public', False)),
        'i_follow': user.id in following,
        'follows_me': user.id in followers,
        'mutual': user.id in following and user.id in followers,
    }
