import { describe, expect, it } from "vitest";
import { epley, estimate1RM, percentTable, repsAtPercent, roundDown, rpeToRir } from "./oneRepMax";

describe("estymacja 1RM (zgodna z backendem)", () => {
  it("liczy wzór Epleya, a 1 powtórzenie to sam ciężar", () => {
    expect(epley(100, 5)).toBeCloseTo(116.67, 2);
    expect(epley(100, 1)).toBe(100);
  });

  it("dolicza RIR do powtórzeń", () => {
    expect(estimate1RM(100, 5, false, 2)).toBe(123.3); // 100 * (1 + 7/30)
    expect(estimate1RM(100, 5)).toBe(116.7);
  });

  it("pomija rozgrzewkę, serie powyżej 10 powt. i RIR > 4", () => {
    expect(estimate1RM(100, 5, true)).toBeNull();
    expect(estimate1RM(60, 12)).toBeNull();
    expect(estimate1RM(100, 5, false, 5)).toBeNull();
    expect(estimate1RM(0, 5)).toBeNull();
  });

  it("zamienia RPE na RIR", () => {
    expect(rpeToRir(8)).toBe(2);
    expect(rpeToRir(10)).toBe(0);
    expect(rpeToRir(null)).toBeNull();
  });
});

describe("zaokrąglanie i tabela procentów", () => {
  it("zaokrągla w dół do dostępnego przyrostu", () => {
    expect(roundDown(79.2)).toBe(77.5);
    expect(roundDown(80)).toBe(80);
    expect(roundDown(81.9, 1.25)).toBe(81.25);
    expect(roundDown(-5)).toBe(0);
  });

  it("odwraca wzór Epleya dla liczby powtórzeń", () => {
    expect(repsAtPercent(100)).toBe(1);
    expect(repsAtPercent(75)).toBe(10);
    const table = percentTable(100);
    expect(table[0]).toEqual({ percent: 100, weight: 100, reps: 1 });
    expect(table.find((r) => r.percent === 80)?.weight).toBe(80);
  });
});
