"""Generowanie dokumentacji OpenAPI (drf-spectacular) dla widoków opartych na APIView.

Widoki bez serializera (logowanie, statystyki, raporty, moderacja...) przyjmują i zwracają obiekty JSON;
zamiast ostrzeżeń w dokumentacji opisujemy je ogólnym typem "object" i opisem z docstringu widoku.
"""
from drf_spectacular.openapi import AutoSchema
from drf_spectacular.types import OpenApiTypes


class SilownikSchema(AutoSchema):
    def _without_serializer(self) -> bool:
        return not hasattr(self.view, 'get_serializer')

    def get_request_serializer(self):
        if self._without_serializer():
            return OpenApiTypes.OBJECT if self.method in ('POST', 'PUT', 'PATCH') else None
        return super().get_request_serializer()

    def get_response_serializers(self):
        if self._without_serializer():
            return OpenApiTypes.OBJECT
        return super().get_response_serializers()

    def get_tags(self):
        # grupy w dokumentacji według modułu widoków: account, plans, sessions, stats, moderation...
        module = self.view.__class__.__module__.rsplit('.', 1)[-1]
        return [{'account': 'konto', 'exercises': 'ćwiczenia', 'plans': 'plany', 'sessions': 'treningi i pomiary',
                 'stats': 'statystyki i raporty', 'moderation': 'moderacja', 'spa': 'system'}.get(module, module)]
