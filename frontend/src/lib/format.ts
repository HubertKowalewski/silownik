/** Wspólne formatowanie liczb i dat w polskiej konwencji (jedno miejsce zamiast wielu toLocale*). */
const LOCALE = "pl-PL";

/** 09.10.2026 */
export function fmtDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** piątek, 9 października 2026 */
export function fmtLongDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** 09.10.2026, 14:05 */
export function fmtDateTime(iso: string | Date) {
  return new Date(iso).toLocaleString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 12 345,5 - separator tysięcy i przecinek dziesiętny */
export function fmtNumber(value: number, maxFractionDigits = 1) {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: maxFractionDigits });
}

/** Ciężar po polsku: 62,5 kg, 13 932 kg; brak wartości -> „–”. */
export function fmtKg(value: number | null | undefined, maxFractionDigits = 2) {
  return value == null || Number.isNaN(value) ? "–" : `${fmtNumber(value, maxFractionDigits)} kg`;
}

/** Zapis serii „80×8”, „62,5×8” */
export function fmtSet(weight: number, reps: number) {
  return `${fmtNumber(weight, 2)}×${reps}`;
}

/** Parsuje pole liczbowe formularza (akceptuje przecinek); pusty tekst -> null. */
export function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Liczba z rzeczownikiem w poprawnej formie, np. plural(n, "seria", "serie", "serii"):
 * 1 seria, 3 serie, 22 serie, 5 serii, 12 serii (końcówki 2-4 poza 12-14 -> forma druga).
 */
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100;
  const word = n === 1 ? one : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many;
  return `${n} ${word}`;
}

/**
 * Nazwy w atlasie mają postać "Polska nazwa / English name". Zwraca część polską (główną)
 * i angielską (pomocniczą, do podpisu lub podpowiedzi); bez separatora - całość jako polska.
 */
export function exerciseName(name: string | null | undefined): { pl: string; en: string } {
  const [pl, ...rest] = (name ?? "").split(" / ");
  return { pl: pl.trim(), en: rest.join(" / ").trim() };
}
