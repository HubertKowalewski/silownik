import { describe, expect, it } from "vitest";
import { platesPerSide, platesText, warmupSets } from "./gym";

describe("kalkulator talerzy", () => {
  it("dobiera talerze zachłannie na jedną stronę", () => {
    expect(platesPerSide(100)).toEqual({ plates: [25, 15], rest: 0 });
    expect(platesPerSide(62.5)).toEqual({ plates: [20, 1.25], rest: 0 });
  });

  it("zgłasza brakującą resztę i sam gryf", () => {
    expect(platesPerSide(21)?.rest).toBe(1);
    expect(platesText(20)).toBe("na stronę: sam gryf");
    expect(platesPerSide(15)).toBeNull();
  });
});

describe("serie rozgrzewkowe", () => {
  it("dla ciężkiej sztangi: gryf + 40/60/80%", () => {
    expect(warmupSets(100, 2.5, true)).toEqual([
      { weight: 20, reps: 10 }, { weight: 40, reps: 8 }, { weight: 60, reps: 5 }, { weight: 80, reps: 3 },
    ]);
  });

  it("dla lekkich ciężarów mniej serii, bez duplikatów i bez ciężaru roboczego", () => {
    expect(warmupSets(20)).toEqual([{ weight: 10, reps: 8 }]); // 60% z 20 kg = 12 kg -> w dół do 10 kg
    expect(warmupSets(0)).toEqual([]);
    const sets = warmupSets(40, 2.5, true);
    expect(new Set(sets.map((s) => s.weight)).size).toBe(sets.length);
    expect(sets.every((s) => s.weight < 40)).toBe(true);
  });
});
