import { describe, expect, it } from "vitest";
import { groupRepRecords } from "./StatsPage";

describe("rekordy powtórzeniowe", () => {
  it("łączy kolejne liczby powtórzeń z tą samą serią w zakres", () => {
    const d = "2026-10-19";
    const rows = groupRepRecords([
      { reps: 1, weight: 62.5, date: d }, { reps: 2, weight: 62.5, date: d }, { reps: 3, weight: 62.5, date: d },
      { reps: 4, weight: 60, date: d }, { reps: 5, weight: 60, date: "2026-10-01" },
    ]);
    expect(rows.map((r) => [r.from, r.to, r.weight])).toEqual([[1, 3, 62.5], [4, 4, 60], [5, 5, 60]]);
  });
});
