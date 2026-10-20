"""Magazyn plików statycznych na produkcji: nazwy z hashem + kompresja (WhiteNoise).

Różnica względem standardowego magazynu: brak pojedynczego pliku w manifeście (np. ikony, która nie
trafiła do repozytorium) nie kończy się błędem 500 całej strony. Adres jest wtedy podawany bez hasha
(przeglądarka dostanie 404 tylko dla tego pliku), a w dzienniku serwera pojawia się ostrzeżenie.
"""
import logging

from whitenoise.storage import CompressedManifestStaticFilesStorage

logger = logging.getLogger(__name__)


class StaticStorage(CompressedManifestStaticFilesStorage):
    def stored_name(self, name):
        try:
            return super().stored_name(name)
        except ValueError:
            logger.warning('Brak pliku statycznego „%s” w manifeście - sprawdź, czy jest w repozytorium.', name)
            return name
