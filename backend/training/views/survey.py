"""Kwestionariusz użyteczności SUS (WN-10): wypełnianie w aplikacji i zestawienie wyników dla prowadzącego testy."""
import statistics

from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import SusResponse
from ..serializers import SusResponseSerializer

SUS_TARGET = 70  # próg akceptowalności przyjęty w wymaganiu WN-10


class SusAPIView(APIView):
    """GET - własna odpowiedź (lub null), POST - zapis/poprawa odpowiedzi."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        response = SusResponse.objects.filter(user=request.user).first()
        return Response(SusResponseSerializer(response).data if response else None)

    def post(self, request):
        serializer = SusResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        answers = serializer.validated_data['answers']
        response, _ = SusResponse.objects.update_or_create(user=request.user, defaults={
            'answers': answers, 'score': SusResponse.compute_score(answers),
            'comment': serializer.validated_data.get('comment', '')[:1000]})
        return Response(SusResponseSerializer(response).data, status=201)


class SusSummaryAPIView(APIView):
    """Zestawienie wyników (personel): liczba odpowiedzi, średnia, odchylenie, średnie pytań, spełnienie WN-10."""
    permission_classes = [IsAdminUser]

    def get(self, request):
        rows = list(SusResponse.objects.select_related('user').order_by('-created_at'))
        scores = [r.score for r in rows]
        per_question = [round(statistics.mean(r.answers[i] for r in rows), 2) for i in range(10)] if rows else []
        mean = round(statistics.mean(scores), 1) if scores else None
        return Response({
            'count': len(rows),
            'mean': mean,
            'stdev': round(statistics.stdev(scores), 1) if len(scores) > 1 else None,
            'min': min(scores, default=None), 'max': max(scores, default=None),
            'target': SUS_TARGET, 'target_met': mean is not None and mean >= SUS_TARGET,
            'per_question': per_question,
            'responses': [{'user': r.user.username, 'score': r.score, 'answers': r.answers, 'comment': r.comment,
                           'date': r.created_at} for r in rows],
        })
