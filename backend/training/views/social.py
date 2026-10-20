"""Społeczność: tablica udostępnionych treningów, obserwowanie, wyszukiwanie ludzi i brawa."""
from django.contrib.auth.models import User
from django.http import Http404
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import social
from ..models import WorkoutSession


def _before(request):
    """Kursor kolejnej strony tablicy: „<data ISO>~<id>” -> (data, id)."""
    # „+” strefy czasowej w niezakodowanym adresie przychodzi jako spacja
    raw = (request.query_params.get('before') or '').strip().replace(' ', '+')
    if not raw:
        return None
    when, _, last_id = raw.partition('~')
    parsed = parse_datetime(when)
    return (parsed, int(last_id) if last_id.isdigit() else None) if parsed else None


def _active_user(username):
    user = User.objects.filter(username__iexact=username, is_active=True).select_related('profile').first()
    if not user:
        raise Http404
    return user


class FeedAPIView(APIView):
    """Tablica: ?tab=all (wszystko, co widzę) albo ?tab=following (tylko obserwowani); ?before=<data> - kolejna strona."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tab = request.query_params.get('tab', 'all')
        if tab not in ('all', 'following'):
            tab = 'all'
        return Response(social.feed(request.user, tab=tab, before=_before(request)))


class UserWorkoutsAPIView(APIView):
    """Udostępnione treningi jednej osoby - według zasad widoczności (social.py)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, username):
        user = _active_user(username)
        return Response(social.feed(request.user, owner=user, before=_before(request)))


class FollowAPIView(APIView):
    """POST - obserwuj, DELETE - przestań obserwować."""
    permission_classes = [IsAuthenticated]

    def post(self, request, username):
        user = _active_user(username)
        try:
            rel = social.follow(request.user, user)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({**rel, **social.counts(user)})

    def delete(self, request, username):
        user = _active_user(username)
        return Response({**social.unfollow(request.user, user), **social.counts(user)})


class PeopleAPIView(APIView):
    """?q=<nazwa> - wyszukiwanie; ?list=following|followers - moje listy obserwowanych / obserwujących."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        me = request.user
        following, followers = social.following_ids(me), social.follower_ids(me)
        kind = request.query_params.get('list')
        if kind in ('following', 'followers'):
            ids = following if kind == 'following' else followers
            users = User.objects.filter(pk__in=ids, is_active=True).select_related('profile').order_by('username')
        else:
            users = social.search_people(me, request.query_params.get('q', ''))
        return Response([social.person(me, u, following, followers) for u in users])


class KudosAPIView(APIView):
    """POST - brawo za trening, DELETE - cofnięcie."""
    permission_classes = [IsAuthenticated]

    def _session(self, request, pk):
        session = WorkoutSession.objects.filter(pk=pk).select_related('user').first()
        if not session or not social.can_see_session(request.user, session):
            raise Http404
        return session

    def post(self, request, pk):
        session = self._session(request, pk)
        if session.user_id == request.user.id:
            return Response({'detail': 'Nie możesz bić brawa za własny trening.'}, status=status.HTTP_400_BAD_REQUEST)
        social.give_kudos(request.user, session)
        return Response({'kudos': session.kudos.count(), 'my_kudos': True})

    def delete(self, request, pk):
        session = self._session(request, pk)
        social.take_kudos(request.user, session)
        return Response({'kudos': session.kudos.count(), 'my_kudos': False})
