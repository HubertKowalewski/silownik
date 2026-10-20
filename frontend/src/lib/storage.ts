// Bezpieczny dostęp do pamięci lokalnej przeglądarki.
// - klucze mają wspólny prefiks aplikacji,
// - dane zapisane pod starym prefiksem (sprzed zmiany nazwy) są przenoszone przy pierwszym odczycie,
//   więc kolejka offline ani trening w toku nie giną po aktualizacji,
// - tryb prywatny / zablokowana pamięć nie wywraca aplikacji (odczyt zwraca wartość domyślną).
const PREFIX = "silownik-";
const LEGACY_PREFIX = "pa-";

function raw(name: string): string | null {
  try {
    const current = localStorage.getItem(PREFIX + name);
    if (current !== null) return current;
    const legacy = localStorage.getItem(LEGACY_PREFIX + name);
    if (legacy !== null) {
      localStorage.setItem(PREFIX + name, legacy);
      localStorage.removeItem(LEGACY_PREFIX + name);
    }
    return legacy;
  } catch {
    return null;
  }
}

export const storage = {
  get<T>(name: string, fallback: T): T {
    const value = raw(name);
    if (value === null) return fallback;
    try {
      return (JSON.parse(value) as T) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(name: string, value: unknown) {
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify(value));
    } catch {
      /* pełna lub zablokowana pamięć - dane zostają tylko w stanie aplikacji */
    }
  },
  remove(name: string) {
    try {
      localStorage.removeItem(PREFIX + name);
      localStorage.removeItem(LEGACY_PREFIX + name);
    } catch {
      /* brak dostępu do pamięci */
    }
  },
};
