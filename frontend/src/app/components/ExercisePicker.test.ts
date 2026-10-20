import { describe, expect, it } from "vitest";
import { Exercise } from "../../lib/api";
import { normalize, searchExercises } from "./ExercisePicker";

const ex = (id: number, name: string, muscle_group: string, times_used = 0): Exercise =>
  ({ id, name, muscle_group, equipment: "barbell", stressed_areas: [], times_used });

const atlas = [
  ex(1, "Wyciskanie sztangi na ławce płaskiej / Barbell bench press", "Klatka piersiowa"),
  ex(2, "Rozpiętki na maszynie butterfly / Pec dec fly", "Klatka piersiowa"),
  ex(3, "Martwy ciąg na prostych nogach / Romanian deadlift", "Dwugłowe Uda / Pośladki"),
  ex(4, "Szrugsy z hantlami / Dumbbell shrugs", "Plecy", 5),
  ex(5, "Ściąganie drążka nachwytem / Lat pulldown", "Plecy"),
];

describe("wyszukiwanie ćwiczeń", () => {
  it("ignoruje wielkość liter i polskie znaki", () => {
    expect(normalize("Ściąganie ŁAWKA")).toBe("sciaganie lawka");
    expect(searchExercises(atlas, "lawce", null).map((e) => e.id)).toEqual([1]);
    expect(searchExercises(atlas, "sciaganie", null).map((e) => e.id)).toEqual([5]);
  });

  it("szuka po nazwie angielskiej i kilku słowach w dowolnej kolejności", () => {
    expect(searchExercises(atlas, "bench", null).map((e) => e.id)).toEqual([1]);
    expect(searchExercises(atlas, "ciąg martwy", null).map((e) => e.id)).toEqual([3]);
  });

  it("filtruje po partii mięśni i stawia na początku nazwy zaczynające się od frazy", () => {
    expect(searchExercises(atlas, "", "Plecy").map((e) => e.id)).toEqual([4, 5]);
    expect(searchExercises(atlas, "s", "Plecy").map((e) => e.id)[0]).toBe(4);
  });
});
