// Ułatwienia na siłowni liczone lokalnie (działają także offline).
import { roundDown } from "./oneRepMax";

export const BAR_WEIGHT = 20;
export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

/** Talerze na jedną stronę gryfu dla danego ciężaru całkowitego (algorytm zachłanny). */
export function platesPerSide(total: number, bar = BAR_WEIGHT, plates = PLATES): { plates: number[]; rest: number } | null {
  if (!total || total < bar) return null;
  let side = Math.round(((total - bar) / 2) * 100) / 100;
  const out: number[] = [];
  for (const p of plates) {
    while (side >= p - 1e-9) {
      out.push(p);
      side = Math.round((side - p) * 100) / 100;
    }
  }
  return { plates: out, rest: side * 2 };
}

export function platesText(total: number): string | null {
  const r = platesPerSide(total);
  if (!r) return null;
  const list = r.plates.length ? r.plates.map((p) => String(p).replace(".", ",")).join(" + ") : "sam gryf";
  return `na stronę: ${list}${r.rest > 0 ? ` (brakuje ${String(r.rest).replace(".", ",")} kg)` : ""}`;
}

/**
 * Serie rozgrzewkowe przed ciężarem roboczym: sam gryf (sztanga) lub ok. 40%, potem 60% i 80%.
 * Dla lekkich ciężarów liczba serii maleje - rozgrzewka nie powinna męczyć.
 */
export function warmupSets(work: number, increment = 2.5, barbell = false): { weight: number; reps: number }[] {
  if (!work || work <= 0) return [];
  const steps: [number, number][] = work >= 60 ? [[0.4, 8], [0.6, 5], [0.8, 3]] : work >= 30 ? [[0.5, 8], [0.75, 4]] : [[0.6, 8]];
  const sets = steps.map(([p, reps]) => ({ weight: roundDown(work * p, increment), reps }));
  if (barbell && work > BAR_WEIGHT * 1.5) sets.unshift({ weight: BAR_WEIGHT, reps: 10 });
  const seen = new Set<number>();
  return sets.filter((s) => s.weight > 0 && s.weight < work && !seen.has(s.weight) && seen.add(s.weight));
}
