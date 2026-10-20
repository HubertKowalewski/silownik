// Obliczenia 1RM po stronie klienta - te same wzory co w backend/training/analytics.py.
// Liczone lokalnie, więc podpowiedzi działają także bez połączenia.

export const MAX_REPS_FOR_ESTIMATE = 10;
export const MAX_RIR_FOR_ESTIMATE = 4;

export const epley = (w: number, r: number) => (w <= 0 || r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30));
export const brzycki = (w: number, r: number) => (w <= 0 || r <= 0 || r >= 37 ? 0 : (w * 36) / (37 - r));
export const lombardi = (w: number, r: number) => (w <= 0 || r <= 0 ? 0 : w * Math.pow(r, 0.1));

/** Szacowane 1RM z serii albo null, gdy seria się nie nadaje (rozgrzewka, >10 powt., RIR > 4).
 *  RIR (powtórzenia w zapasie) doliczany jest do powtórzeń - jak w backend/training/analytics.py. */
export function estimate1RM(weight: number | null, reps: number | null, warmup = false, rir: number | null = null): number | null {
  if (warmup || !weight || !reps || weight <= 0 || reps <= 0 || reps > MAX_REPS_FOR_ESTIMATE) return null;
  if (rir !== null && rir > MAX_RIR_FOR_ESTIMATE) return null;
  return Math.round(epley(weight, reps + (rir ?? 0)) * 10) / 10;
}

export const rpeToRir = (rpe: number | null) => (rpe === null ? null : Math.max(0, Math.round(10 - rpe)));

export function roundDown(value: number, increment = 2.5): number {
  if (value <= 0) return 0;
  return Math.round(increment * Math.floor(value / increment + 1e-9) * 100) / 100;
}

/** Przybliżona liczba powtórzeń możliwa przy danym % 1RM (odwrócony wzór Epleya). */
export function repsAtPercent(percent: number): number {
  if (percent >= 100) return 1;
  return Math.max(1, Math.round(30 * (100 / percent - 1)));
}

export function percentTable(oneRm: number, increment = 2.5) {
  return [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50].map((p) => ({
    percent: p,
    weight: roundDown((oneRm * p) / 100, increment),
    reps: repsAtPercent(p),
  }));
}
