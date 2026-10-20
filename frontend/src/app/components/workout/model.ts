// Model treningu w toku: typy, budowanie bloków z planu lub historii i przygotowanie danych do zapisu.
// Same funkcje czyste - bez Reacta - więc łatwo je testować.
import { loadText, PlanDay, Session, Suggestion } from "../../../lib/api";
import { numOrNull } from "../../../lib/format";
import { rpeToRir } from "../../../lib/oneRepMax";
import { TimerState } from "../RestTimer";

/**
 * Sposób zapisu serii: "reps" - klasycznie (ciężar × powtórzenia), "rir" - z powtórzeniami w zapasie,
 * "rpe" - z odczuwanym wysiłkiem 1-10. Domyślny z profilu, zmieniany osobno dla każdego ćwiczenia.
 */
export type Scale = "reps" | "rir" | "rpe";

export const SCALE_INFO: Record<Scale, { label: string; short: string; help: string }> = {
  reps: { label: "Powtórzenia", short: "", help: "Klasycznie: tylko ciężar i liczba powtórzeń." },
  rir: { label: "RIR", short: "RIR", help: "RIR: ile powtórzeń mogłeś jeszcze zrobić (0 = do upadku). Uwzględniany w 1RM." },
  rpe: { label: "RPE", short: "RPE", help: "RPE: wysiłek w skali 1-10 (10 = do upadku, 8 = dwa powtórzenia w zapasie)." },
};

// effort = ocena wysiłku w skali wybranej w profilu: RIR (powtórzenia w zapasie) albo RPE
export type SetRow = { key: string; weight: string; reps: string; effort: string; warmup: boolean; done: boolean };

export type Block = {
  key: string; exercise: number; name: string; target: string; rest: number; hint?: string; sets: SetRow[];
  // zakres powtórzeń i docelowy RIR z planu - podstawa sugestii progresji
  repsMin?: number; repsMax?: number | null; targetRir?: number | null;
  suggestion?: Suggestion | null; note?: string;
  scale?: Scale;   // brak = domyślny sposób z profilu
};

export type Draft = {
  planId: number | null;
  dayId: number | null;
  editingId: number | null;
  blocks: Block[];
  notes: string;
  hr: string;
  startedAt: string;
  duration: number | null;   // przy edycji - zachowany czas oryginalnego treningu
  timer: TimerState | null;
};

export const STORAGE = {
  draft: "workout-draft", prefs: "rest-prefs", scale: "effort-scale", records: "records", increment: "increment",
  exerciseScales: "exercise-scales",   // zapamiętany sposób zapisu dla konkretnych ćwiczeń
};
export const MAX_DURATION = 6 * 3600;

export const newKey = () => Math.random().toString(36).slice(2);

export const row = (weight = "", reps = "", extra: Partial<SetRow> = {}): SetRow =>
  ({ key: newKey(), weight, reps, effort: "", warmup: false, done: false, ...extra });

export const emptyDraft = (): Draft => ({
  planId: null, dayId: null, editingId: null, blocks: [], notes: "", hr: "",
  startedAt: new Date().toISOString(), duration: null, timer: null,
});

/** Nazwa ćwiczenia bez części po „ / ” (w bazie: „Polska nazwa / English name”). */
export const shortName = (name: string) => name.split(" / ")[0];

/** Szkic zapisany w starszej wersji aplikacji miał pole `rpe` zamiast `effort`. */
export function normalizeDraft(saved: Partial<Draft>): Draft {
  const draft = { ...emptyDraft(), ...saved };
  draft.blocks = draft.blocks.map((b) => ({
    ...b,
    sets: b.sets.map((s) => {
      const legacy = s as SetRow & { rpe?: string };
      return { ...s, effort: s.effort ?? legacy.rpe ?? "" };
    }),
  }));
  return draft;
}

export const scaleOf = (b: Pick<Block, "scale">, fallback: Scale): Scale => b.scale ?? fallback;

export const rirOf = (s: SetRow, scale: Scale) =>
  scale === "reps" ? null : scale === "rir" ? numOrNull(s.effort) : rpeToRir(numOrNull(s.effort));

/** Przeliczenie wpisanych ocen wysiłku przy zmianie skali (RIR 2 <-> RPE 8); przy "reps" ocena znika. */
export function convertEffort(value: string, from: Scale, to: Scale): string {
  const v = numOrNull(value);
  if (v === null || from === to) return from === to ? value : "";
  if (from === "reps" || to === "reps") return "";
  if (to === "rpe") return String(Math.min(10, Math.max(1, 10 - v)));
  return String(Math.max(0, Math.round(10 - v)));
}

/**
 * Zaliczenie serii w bloku. Ciężar zaliczonej serii roboczej trafia do kolejnych, jeszcze pustych
 * serii roboczych tego ćwiczenia - wpisuje się go raz, a nie przy każdej serii.
 */
export function completeInBlock(block: Block, setKey: string): Block {
  const index = block.sets.findIndex((x) => x.key === setKey);
  const done = block.sets[index];
  if (!done) return block;
  return {
    ...block,
    sets: block.sets.map((x, j) => {
      if (j === index) return { ...x, done: true };
      if (j > index && !done.warmup && !x.done && !x.warmup && x.weight.trim() === "") return { ...x, weight: done.weight };
      return x;
    }),
  };
}

export const hasCompletedSets = (draft: Draft) => draft.blocks.some((b) => b.sets.some((s) => s.done));

// --- budowanie treningu ------------------------------------------------------------

export function blocksFromDay(day: PlanDay, defaultRest: number): Block[] {
  return day.exercises.map((e) => ({
    key: newKey(), exercise: e.exercise, name: e.exercise_name ?? "",
    target: `${e.target_sets}×${e.target_reps}${e.target_reps_max && e.target_reps_max !== e.target_reps ? `-${e.target_reps_max}` : ""}`
      + ` · ${loadText(e)}${e.target_rir != null ? ` · RIR ${e.target_rir}` : ""}${e.notes ? ` · ${e.notes}` : ""}`,
    repsMin: e.target_reps, repsMax: e.target_reps_max ?? null, targetRir: e.target_rir ?? null,
    rest: e.rest_seconds || defaultRest,
    sets: Array.from({ length: e.target_sets }, () =>
      row(e.calculated_weight != null ? String(e.calculated_weight) : "", String(e.target_reps))),
  }));
}

export function blocksFromSession(s: Session, mode: "edit" | "repeat", scale: Scale, defaultRest: number, label: string): Block[] {
  const order: number[] = [];
  s.sets.forEach((x) => !order.includes(x.exercise) && order.push(x.exercise));
  return order.map((exId) => {
    const sets = s.sets.filter((x) => x.exercise === exId);
    // skala, w której ćwiczenie zostało zapisane; bez ocen wysiłku - klasycznie (o ile profil nie mówi inaczej)
    const has = (k: "rir" | "rpe") => sets.some((x) => x[k] != null);
    const own: Scale = scale !== "reps" && has(scale) ? scale : has("rir") ? "rir" : has("rpe") ? "rpe"
      : mode === "edit" ? "reps" : scale;
    return {
      key: newKey(), exercise: exId, name: sets[0].exercise_name, target: label, rest: defaultRest, scale: own,
      sets: sets.map((x) => row(String(x.weight), String(x.reps), {
        effort: effortText(x, own), warmup: !!x.is_warmup, done: mode === "edit",
      })),
    };
  });
}

function effortText(x: Session["sets"][number], scale: Scale) {
  const value = scale === "reps" ? null : scale === "rir" ? x.rir : x.rpe;
  return value != null ? String(value) : "";
}

// --- podsumowanie i zapis -----------------------------------------------------------

export type CompletedSet = { b: Block; s: SetRow };

export const completedSets = (draft: Draft): CompletedSet[] =>
  draft.blocks.flatMap((b) => b.sets.filter((s) => s.done).map((s) => ({ b, s })));

export const tonnageOf = (sets: CompletedSet[]) =>
  sets.reduce((sum, { s }) => sum + (s.warmup ? 0 : (numOrNull(s.weight) ?? 0) * (numOrNull(s.reps) ?? 0)), 0);

/** Serie w formacie API; numer serii liczony osobno dla każdego ćwiczenia. */
export function setsPayload(done: CompletedSet[], scale: Scale) {
  const counters: Record<number, number> = {};
  return done.map(({ b, s }) => {
    counters[b.exercise] = (counters[b.exercise] ?? 0) + 1;
    const bs = scaleOf(b, scale);
    const effort = bs === "reps" ? null : numOrNull(s.effort);
    return {
      exercise: b.exercise, set_number: counters[b.exercise], weight: numOrNull(s.weight) ?? 0,
      reps: Number(s.reps), is_warmup: s.warmup,
      ...(bs === "rir"
        ? { rir: effort === null ? null : Math.round(effort), rpe: null }
        : { rpe: effort, rir: null }),
    };
  });
}

/** Czas treningu: przy edycji zachowany, w nowym treningu liczony od rozpoczęcia (maks. 6 h). */
export const durationOf = (draft: Draft, now = Date.now()) =>
  draft.editingId ? draft.duration : Math.min(MAX_DURATION, Math.round((now - Date.parse(draft.startedAt)) / 1000));
