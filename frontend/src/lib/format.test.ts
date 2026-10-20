import { describe, expect, it } from "vitest";
import { exerciseName, fmtDate, fmtNumber, fmtSet, numOrNull, plural } from "./format";

describe("formatowanie", () => {
  it("parsuje pola liczbowe z przecinkiem", () => {
    expect(numOrNull("82,5")).toBe(82.5);
    expect(numOrNull(" ")).toBeNull();
    expect(numOrNull("abc")).toBeNull();
    expect(numOrNull("0")).toBe(0);
  });

  it("formatuje liczby, daty i serie po polsku", () => {
    expect(fmtNumber(1234.56)).toMatch(/^1\s?234,6$/);
    expect(fmtDate("2026-10-09T10:00:00Z")).toBe("09.10.2026");
    expect(fmtSet(80, 8)).toBe("80×8");
  });

  it("odmienia rzeczowniki po liczebnikach", () => {
    const serie = (n: number) => plural(n, "seria", "serie", "serii");
    expect([1, 2, 4, 5, 12, 14, 22, 25, 0].map(serie)).toEqual(
      ["1 seria", "2 serie", "4 serie", "5 serii", "12 serii", "14 serii", "22 serie", "25 serii", "0 serii"]);
  });

  it("dzieli nazwę ćwiczenia na polską i angielską", () => {
    expect(exerciseName("Wyciskanie leżąc / Bench Press")).toEqual({ pl: "Wyciskanie leżąc", en: "Bench Press" });
    expect(exerciseName("Przysiad")).toEqual({ pl: "Przysiad", en: "" });
  });
});
