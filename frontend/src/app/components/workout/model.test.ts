import { describe, expect, it } from "vitest";
import { Session } from "../../../lib/api";
import {
  blocksFromSession, completedSets, completeInBlock, convertEffort, durationOf, emptyDraft, normalizeDraft, row, setsPayload, tonnageOf,
} from "./model";

const session: Session = {
  id: 7, client_uuid: null, plan: null, plan_day: null, plan_title: null, day_name: null,
  date_completed: "2026-10-01T10:00:00Z", notes: "", post_workout_hr: null, duration_seconds: 3600, total_tonnage: 0,
  sets: [
    { id: 1, exercise: 3, exercise_name: "Przysiad / Squat", set_number: 1, weight: 100, reps: 5, rpe: 8, rir: 2 },
    { id: 2, exercise: 4, exercise_name: "Wyciskanie / Bench", set_number: 1, weight: 80, reps: 8, rpe: null, rir: null },
    { id: 3, exercise: 3, exercise_name: "Przysiad / Squat", set_number: 2, weight: 100, reps: 4, rpe: 9, rir: 1 },
  ],
};

describe("model treningu", () => {
  it("grupuje serie z historii w bloki w kolejności wykonania", () => {
    const blocks = blocksFromSession(session, "edit", "rir", 120, "edycja");
    expect(blocks.map((b) => b.exercise)).toEqual([3, 4]);
    expect(blocks[0].sets.map((s) => [s.weight, s.reps, s.effort, s.done])).toEqual([["100", "5", "2", true], ["100", "4", "1", true]]);
    expect(blocksFromSession(session, "repeat", "rpe", 120, "x")[0].sets[0]).toMatchObject({ effort: "8", done: false });
    expect(blocksFromSession(session, "repeat", "rpe", 120, "x")[1].scale).toBe("rpe");   // powtórka - skala z profilu
  });

  it("buduje dane do API: numeracja serii na ćwiczenie, RIR albo RPE", () => {
    const draft = { ...emptyDraft(), blocks: blocksFromSession(session, "edit", "rir", 120, "") };
    const payload = setsPayload(completedSets(draft), "rir");
    expect(payload.map((s) => [s.exercise, s.set_number, s.rir])).toEqual([[3, 1, 2], [3, 2, 1], [4, 1, null]]);
    const noScale = { ...draft, blocks: draft.blocks.map((b) => ({ ...b, scale: undefined })) };
    expect(setsPayload(completedSets(noScale), "rpe")[0]).toMatchObject({ rpe: 2, rir: null });
  });

  it("każde ćwiczenie ma własny sposób zapisu serii", () => {
    const blocks = blocksFromSession(session, "edit", "rir", 120, "");
    expect(blocks.map((b) => b.scale)).toEqual(["rir", "reps"]);   // bez ocen wysiłku -> klasycznie
    const mixed = { ...emptyDraft(), blocks: [{ ...blocks[0], scale: "rpe" as const }, { ...blocks[1], sets: blocks[1].sets.map((s) => ({ ...s, effort: "7" })) }] };
    const payload = setsPayload(completedSets(mixed), "rir");
    expect(payload[0]).toMatchObject({ rpe: 2, rir: null });
    expect(payload[2]).toMatchObject({ rpe: null, rir: null });   // "reps" - wysiłek nie jest wysyłany
  });

  it("przelicza ocenę wysiłku przy zmianie skali", () => {
    expect(convertEffort("2", "rir", "rpe")).toBe("8");
    expect(convertEffort("8.5", "rpe", "rir")).toBe("2");
    expect(convertEffort("2", "rir", "reps")).toBe("");
    expect(convertEffort("", "rir", "rpe")).toBe("");
    expect(convertEffort("3", "rir", "rir")).toBe("3");
  });

  it("objętość pomija serie rozgrzewkowe", () => {
    const b = { key: "b", exercise: 1, name: "x", target: "", rest: 60,
      sets: [row("40", "8", { warmup: true, done: true }), row("100", "5", { done: true }), row("100", "5")] };
    expect(tonnageOf(completedSets({ ...emptyDraft(), blocks: [b] }))).toBe(500);
  });

  it("czas: przy edycji zachowany, w nowym treningu ograniczony do 6 h", () => {
    const started = { ...emptyDraft(), startedAt: new Date(0).toISOString() };
    expect(durationOf(started, 90_000)).toBe(90);
    expect(durationOf(started, 10 * 3600 * 1000)).toBe(6 * 3600);
    expect(durationOf({ ...started, editingId: 1, duration: 1234 })).toBe(1234);
  });

  it("wczytuje szkic ze starszej wersji (pole rpe zamiast effort)", () => {
    const old = { blocks: [{ key: "k", exercise: 1, name: "x", target: "", rest: 60,
      sets: [{ key: "s", weight: "50", reps: "5", rpe: "8", warmup: false, done: false }] }] };
    expect(normalizeDraft(old as never).blocks[0].sets[0].effort).toBe("8");
  });

  it("ciężar zaliczonej serii wpisuje się do kolejnych pustych serii", () => {
    const b = { key: "b", exercise: 1, name: "x", target: "", rest: 60,
      sets: [row("40", "8", { warmup: true }), row("80", "8"), row("", "8"), row("75", "8"), row("", "8")] };
    const afterWarmup = completeInBlock(b, b.sets[0].key);
    expect(afterWarmup.sets.map((s) => s.weight)).toEqual(["40", "80", "", "75", ""]);   // rozgrzewka nie kopiuje
    const after = completeInBlock(afterWarmup, b.sets[1].key);
    expect(after.sets.map((s) => [s.weight, s.done])).toEqual(
      [["40", true], ["80", true], ["80", false], ["75", false], ["80", false]]);         // wpisany ciężar zostaje
  });
});
