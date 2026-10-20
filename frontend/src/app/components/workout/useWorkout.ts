// Stan i logika treningu w toku. Komponenty ekranu treningu tylko wyświetlają dane
// i wywołują akcje zwracane przez ten hook.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  errorText, NewRecord, NewRepRecord, Session, trainingApi, uuid, WorkoutPlan,
} from "../../../lib/api";
import { fmtDate, fmtSet, numOrNull } from "../../../lib/format";
import { warmupSets } from "../../../lib/gym";
import { useExercises } from "../../../lib/hooks";
import { saveOrQueue } from "../../../lib/offline";
import { storage } from "../../../lib/storage";
import { DEFAULT_PREFS, RestPrefs, startTimer, TimerState, unlockAudio } from "../RestTimer";
import {
  Block, blocksFromDay, blocksFromSession, completedSets, completeInBlock, convertEffort, Draft, durationOf, emptyDraft, hasCompletedSets,
  newKey, normalizeDraft, row, Scale, scaleOf, SetRow, setsPayload, shortName, STORAGE, tonnageOf,
} from "./model";

export type Summary = {
  queued: boolean; records: NewRecord[]; repRecords: NewRepRecord[];
  sets: number; tonnage: number; duration: number | null; edited: boolean;
  shared: boolean; profilePublic: boolean;
};

type Range = { reps_min: number; reps_max?: number | null; rir?: number | null };

export function useWorkout() {
  const exercises = useExercises();
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [prefs, setPrefs] = useState<RestPrefs>(() => storage.get(STORAGE.prefs, DEFAULT_PREFS));
  const [records, setRecords] = useState<Record<number, number>>(() => storage.get(STORAGE.records, {}));
  const [increment, setIncrement] = useState<number>(() => storage.get(STORAGE.increment, 2.5));
  const [sharing, setSharing] = useState<{ byDefault: boolean; profilePublic: boolean }>(
    () => storage.get(STORAGE.sharing, { byDefault: true, profilePublic: false }));
  const [scale, setScale] = useState<Scale>(() => storage.get<Scale>(STORAGE.scale, "rir"));
  // sposób zapisu serii wybrany ostatnio dla danego ćwiczenia (np. martwy ciąg zawsze z RIR)
  const [exerciseScales, setExerciseScales] = useState<Record<number, Scale>>(() => storage.get(STORAGE.exerciseScales, {}));
  const [draft, setDraft] = useState<Draft>(() => normalizeDraft(storage.get<Partial<Draft>>(STORAGE.draft, {})));
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ustawienia z profilu i rekordy - zapamiętywane lokalnie, żeby działały także offline
  useEffect(() => {
    trainingApi.plans({ scope: "mine" }).then(setPlans).catch(() => undefined);
    trainingApi.profile().then((p) => {
      const next: RestPrefs = {
        default_rest_seconds: p.default_rest_seconds, rest_step_seconds: p.rest_step_seconds,
        rest_auto_start: p.rest_auto_start, rest_sound: p.rest_sound, rest_vibrate: p.rest_vibrate,
      };
      setPrefs(next);
      setScale(p.effort_scale);
      setIncrement(p.load_increment);
      const nextSharing = { byDefault: p.share_workouts_default, profilePublic: p.profile_public };
      setSharing(nextSharing);
      storage.set(STORAGE.sharing, nextSharing);
      storage.set(STORAGE.prefs, next);
      storage.set(STORAGE.scale, p.effort_scale);
      storage.set(STORAGE.increment, p.load_increment);
    }).catch(() => undefined);
    trainingApi.records().then((list) => {
      const map = Object.fromEntries(list.map((r) => [r.exercise_id, r.value]));
      setRecords(map);
      storage.set(STORAGE.records, map);
    }).catch(() => undefined);
  }, []);

  // trening w toku przetrwa odświeżenie strony i zamknięcie aplikacji
  useEffect(() => {
    if (draft.blocks.length || draft.notes || draft.timer) storage.set(STORAGE.draft, draft);
    else storage.remove(STORAGE.draft);
  }, [draft]);

  const plan = plans.find((p) => p.id === draft.planId) ?? null;
  const isBarbell = useCallback(
    (exerciseId: number) => exercises.find((e) => e.id === exerciseId)?.equipment === "barbell", [exercises]);

  // --- operacje na szkicu -------------------------------------------------------------

  const setTimer = (timer: TimerState | null) => setDraft((d) => ({ ...d, timer }));
  const setField = (patch: Partial<Pick<Draft, "notes" | "hr" | "share">>) => setDraft((d) => ({ ...d, ...patch }));
  const setBlock = (bk: string, patch: Partial<Block>) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b) => (b.key === bk ? { ...b, ...patch } : b)) }));
  const updateSet = (bk: string, sk: string, patch: Partial<SetRow>) =>
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.map((b) => (b.key !== bk ? b : { ...b, sets: b.sets.map((s) => (s.key === sk ? { ...s, ...patch } : s)) })),
    }));
  const removeBlock = (bk: string) => setDraft((d) => ({ ...d, blocks: d.blocks.filter((b) => b.key !== bk) }));
  const moveBlock = (bk: string, delta: -1 | 1) =>
    setDraft((d) => {
      const i = d.blocks.findIndex((b) => b.key === bk);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.blocks.length) return d;
      const blocks = [...d.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...d, blocks };
    });
  const addSet = (b: Block) => {
    const last = b.sets.at(-1);
    setBlock(b.key, { sets: [...b.sets, row(last?.weight, last?.reps, { effort: last?.effort ?? "" })] });
  };
  /** Zmiana sposobu zapisu serii w ćwiczeniu; wpisane oceny są przeliczane (RIR 2 = RPE 8). */
  const setBlockScale = (b: Block, next: Scale) => {
    const from = scaleOf(b, scale);
    if (from === next) return;
    setBlock(b.key, { scale: next, sets: b.sets.map((x) => ({ ...x, effort: convertEffort(x.effort, from, next) })) });
    setExerciseScales((m) => {
      const map = { ...m, [b.exercise]: next };
      storage.set(STORAGE.exerciseScales, map);
      return map;
    });
  };
  const remembered = (blocks: Block[]) =>
    blocks.map((b) => (exerciseScales[b.exercise] ? { ...b, scale: exerciseScales[b.exercise] } : b));

  const removeSet = (b: Block, sk: string) => setBlock(b.key, { sets: b.sets.filter((s) => s.key !== sk) });

  const confirmReplace = () =>
    !hasCompletedSets(draft) || confirm("Masz niezapisany trening w toku. Zastąpić go?");

  /** Ostatnie wykonanie ćwiczenia, notatka i propozycja ciężaru (podwójna progresja). */
  const loadHint = async (exerciseId: number, blockKey: string, range?: Range) => {
    try {
      const d = await trainingApi.lastForExercise(exerciseId, range);
      const hint = d.last_sets.length
        ? `Poprzednio (${fmtDate(d.last_sets[0].date)}): ${d.last_sets.map((s) => fmtSet(s.weight, s.reps)).join(", ")}`
        : "Pierwszy raz wykonujesz to ćwiczenie.";
      setBlock(blockKey, { hint, note: d.note, suggestion: d.suggestion });
      if (d.estimated_1rm) setRecords((r) => ({ ...r, [exerciseId]: d.estimated_1rm! }));
    } catch {
      /* offline - trening działa bez podpowiedzi */
    }
  };

  const loadDay = (p: WorkoutPlan, dayId: number | null) => {
    const day = p.days.find((d) => d.id === dayId) ?? p.days[0];
    if (!day) return;
    const blocks = remembered(blocksFromDay(day, prefs.default_rest_seconds));
    setDraft({ ...emptyDraft(), planId: p.id, dayId: day.id ?? null, blocks });
    setSummary(null);
    blocks.forEach((b) => loadHint(b.exercise, b.key, { reps_min: b.repsMin!, reps_max: b.repsMax, rir: b.targetRir }));
  };

  const loadSession = (s: Session, mode: "edit" | "repeat") => {
    const label = mode === "edit" ? "edycja zapisanego treningu" : `powtórka z ${fmtDate(s.date_completed)}`;
    const blocks = blocksFromSession(s, mode, scale, prefs.default_rest_seconds, label);
    setDraft({
      ...emptyDraft(), blocks, planId: s.plan, dayId: s.plan_day,
      ...(mode === "edit"
        ? { editingId: s.id, notes: s.notes, hr: s.post_workout_hr ? String(s.post_workout_hr) : "",
            startedAt: s.date_completed, duration: s.duration_seconds }
        : {}),
    });
    setSummary(null);
    if (mode === "repeat") blocks.forEach((b) => loadHint(b.exercise, b.key));
  };

  const addExercise = (exerciseId: number) => {
    const ex = exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    const b: Block = { key: newKey(), exercise: ex.id, name: ex.name, target: "poza planem", rest: prefs.default_rest_seconds, sets: [row()],
      scale: exerciseScales[ex.id] };
    setDraft((d) => ({ ...d, blocks: [...d.blocks, b] }));
    loadHint(ex.id, b.key);
  };

  /** Zamiana ćwiczenia w trakcie treningu (np. zajęta maszyna) - serie zostają, ciężary do uzupełnienia (WF-26). */
  const swapExercise = (b: Block, exerciseId: number) => {
    const ex = exercises.find((e) => e.id === exerciseId);
    if (!ex || ex.id === b.exercise) return;
    if (b.sets.some((s) => s.done)) {
      return setError("Ćwiczenie ma już zaliczone serie - dodaj zamiennik jako nowe ćwiczenie.");
    }
    setError(null);
    setBlock(b.key, {
      exercise: ex.id, name: ex.name, target: `zamiast: ${shortName(b.name)} · ${b.target}`,
      hint: undefined, note: undefined, suggestion: null,
      sets: b.sets.map((s) => ({ ...s, weight: "" })),
    });
    loadHint(ex.id, b.key, b.repsMin ? { reps_min: b.repsMin, reps_max: b.repsMax, rir: b.targetRir } : undefined);
  };

  const completeSet = (b: Block, s: SetRow, index: number) => {
    unlockAudio();
    if (s.done) return updateSet(b.key, s.key, { done: false });
    if (numOrNull(s.weight) === null || !numOrNull(s.reps)) return setError("Uzupełnij ciężar i powtórzenia serii.");
    setError(null);
    setDraft((d) => ({ ...d, blocks: d.blocks.map((x) => (x.key === b.key ? completeInBlock(x, s.key) : x)) }));
    const remaining = draft.blocks.reduce((n, x) => n + x.sets.filter((y) => !y.done && y.key !== s.key).length, 0);
    if (prefs.rest_auto_start && b.rest > 0 && remaining > 0 && !draft.editingId) {
      setTimer(startTimer(b.rest, `${shortName(b.name)}, seria ${index + 1}/${b.sets.length}`));
    }
  };

  const applySuggestion = (b: Block) => {
    const sg = b.suggestion;
    if (!sg || sg.weight == null) return;
    const resetReps = sg.action === "increase" || sg.action === "decrease";
    setBlock(b.key, {
      sets: b.sets.map((x) => (x.done || x.warmup ? x : {
        ...x, weight: String(sg.weight), reps: resetReps ? String(sg.reps_min) : x.reps,
      })),
    });
  };

  const addWarmup = (b: Block) => {
    const work = numOrNull(b.sets.find((x) => !x.warmup)?.weight ?? "") ?? b.suggestion?.weight ?? null;
    if (!work) return setError("Wpisz najpierw ciężar serii roboczej - rozgrzewka zostanie do niego dopasowana.");
    const rows = warmupSets(work, increment, isBarbell(b.exercise))
      .map((w) => row(String(w.weight), String(w.reps), { warmup: true }));
    if (!rows.length) return setError("Przy tak małym ciężarze rozgrzewka nie jest potrzebna.");
    setError(null);
    setBlock(b.key, { sets: [...rows, ...b.sets] });
  };

  const reset = () => {
    if (!confirmReplace()) return;
    setDraft(emptyDraft());
    setSummary(null);
  };

  // --- zapis ---------------------------------------------------------------------------

  const done = useMemo(() => completedSets(draft), [draft]);
  const tonnage = tonnageOf(done);
  const totalSets = draft.blocks.reduce((n, b) => n + b.sets.length, 0);

  const save = async () => {
    setError(null);
    if (!done.length) return setError("Zalicz co najmniej jedną serię.");
    const hr = numOrNull(draft.hr);
    if (hr !== null && (hr < 30 || hr > 230)) return setError("Tętno poza zakresem 30-230.");
    const sets = setsPayload(done, scale);
    const share = draft.share ?? sharing.byDefault;
    const duration = durationOf(draft);
    const notes = draft.notes.slice(0, 1000);
    setSaving(true);
    try {
      let result: Pick<Summary, "queued" | "records" | "repRecords">;
      if (draft.editingId) {
        const r = await trainingApi.updateSession(draft.editingId, { notes, post_workout_hr: hr, sets });
        result = { queued: false, records: r.new_records ?? [], repRecords: r.rep_records ?? [] };
      } else {
        const r = await saveOrQueue("session", {
          client_uuid: uuid(), plan: draft.planId, plan_day: draft.dayId, date_completed: new Date().toISOString(),
          notes, post_workout_hr: hr, duration_seconds: duration, sets, shared: share,
        });
        result = { queued: r.status === "queued", records: r.data?.new_records ?? [], repRecords: r.data?.rep_records ?? [] };
      }
      setSummary({ ...result, sets: sets.filter((s) => !s.is_warmup).length, tonnage, duration, edited: !!draft.editingId,
        shared: share, profilePublic: sharing.profilePublic });
      setRecords((m) => ({ ...m, ...Object.fromEntries(result.records.map((r) => [r.exercise_id, r.current])) }));
      setDraft(emptyDraft());
    } catch (e) {
      setError(errorText(e, "Nie udało się zapisać treningu."));
    } finally {
      setSaving(false);
    }
  };

  return {
    exercises, plans, plan, prefs, records, scale, draft, setBlockScale, sharing, summary, error, saving, done, tonnage, totalSets,
    isBarbell, setError, setSummary, setTimer, setField, setBlock, updateSet, removeBlock, moveBlock, addSet,
    removeSet, confirmReplace, loadDay, loadSession, addExercise, swapExercise, completeSet, applySuggestion, addWarmup, reset, save,
  };
}

export type Workout = ReturnType<typeof useWorkout>;
