"""Moduł analityczny oparty o bibliotekę Pandas.

Realizuje obliczenia opisane w rozdziale 2.2 (WF-17, WF-30 - WF-34, WF-38 - WF-43)
oraz algorytmy z rozdziału 3.4. Podział na moduły:
- core       - DataFrame serii, estymacja i wyznaczanie 1RM,
- planning   - skalowanie planu, dobór planu, podwójna progresja, realizacja planu,
- statistics - statystyki, bliskość upadku, rekordy powtórzeniowe, obciążenie, cele,
- report     - raport okresowy.
"""
from .core import *  # noqa: F403
from .planning import *  # noqa: F403
from .report import *  # noqa: F403
from .statistics import *  # noqa: F403
from .statistics import _effort_summary  # noqa: F401
