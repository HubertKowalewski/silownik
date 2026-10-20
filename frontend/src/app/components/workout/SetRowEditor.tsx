// Jeden wiersz serii: ciężar, powtórzenia, RIR/RPE, rozgrzewka, zaliczenie oraz podpowiedzi
// (szacowane 1RM, % maksimum, talerze na gryf).
import { Check, X } from "lucide-react";
import { fmtKg, numOrNull } from "../../../lib/format";
import { platesText } from "../../../lib/gym";
import { estimate1RM } from "../../../lib/oneRepMax";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { rirOf, Scale, SetRow } from "./model";

// kolumny: nr | kg | powt. | RIR/RPE | rozgrzewka | zalicz | usuń - szerokości dobrane pod ekran telefonu (360 px+);
// przy zapisie klasycznym (same powtórzenia) kolumny oceny wysiłku nie ma
const GRID_REPS = "grid grid-cols-[1.25rem_minmax(0,1.25fr)_minmax(0,1fr)_1.25rem_2.75rem_1rem] items-center gap-1.5 sm:gap-2";
const GRID_EFFORT = "grid grid-cols-[1.25rem_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)_1.25rem_2.75rem_1rem] items-center gap-1.5 sm:gap-2";
export const setGrid = (scale: Scale) => (scale === "reps" ? GRID_REPS : GRID_EFFORT);
const NUM = "h-10 px-1 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-80";

type Props = {
  set: SetRow; index: number; scale: Scale; oneRm: number; barbell: boolean; canRemove: boolean;
  onChange: (patch: Partial<SetRow>) => void; onComplete: () => void; onRemove: () => void;
};

export function SetRowEditor({ set: s, index, scale, oneRm, barbell, canRemove, onChange, onComplete, onRemove }: Props) {
  const w = numOrNull(s.weight), r = numOrNull(s.reps);
  const rir = rirOf(s, scale);
  const e1 = estimate1RM(w, r, s.warmup, rir);
  const pct = oneRm && w ? Math.round((w / oneRm) * 100) : null;
  const plates = w && barbell ? platesText(w) : "";

  return (
    <div className={`rounded-md px-1 py-1 ${s.done ? "bg-primary/10" : ""}`}>
      <div className={setGrid(scale)}>
        <span className="text-center text-sm">{s.warmup ? "R" : index + 1}</span>
        <Input type="number" inputMode="decimal" step="0.5" min={0} max={1000} value={s.weight} disabled={s.done} className={NUM}
          onChange={(e) => onChange({ weight: e.target.value })} aria-label="Ciężar" />
        <Input type="number" inputMode="numeric" min={1} max={200} value={s.reps} disabled={s.done} className={NUM}
          onChange={(e) => onChange({ reps: e.target.value })} aria-label="Powtórzenia" />
        {scale !== "reps" && <Input type="number" inputMode={scale === "rir" ? "numeric" : "decimal"} step={scale === "rir" ? "1" : "0.5"}
          min={scale === "rir" ? 0 : 1} max={10} value={s.effort} disabled={s.done} placeholder="–" className={NUM}
          onChange={(e) => onChange({ effort: e.target.value })}
          aria-label={scale === "rir" ? "RIR - powtórzenia w zapasie" : "RPE"} />}
        <input type="checkbox" className="h-4 w-4 justify-self-center" checked={s.warmup} disabled={s.done}
          onChange={(e) => onChange({ warmup: e.target.checked })} aria-label="Seria rozgrzewkowa" />
        <Button size="icon" className="h-10 w-11" variant={s.done ? "default" : "outline"}
          aria-label={s.done ? "Cofnij zaliczenie" : "Zalicz serię"} onClick={onComplete}>
          <Check className="h-5 w-5" />
        </Button>
        {canRemove && !s.done
          ? <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Usuń serię" onClick={onRemove}>
              <X className="h-4 w-4" />
            </button>
          : <span />}
      </div>
      {(e1 || pct || plates) && (
        <p className="pl-7 pt-0.5 text-[11px] text-muted-foreground">
          {e1 ? `≈ 1RM ${fmtKg(e1)}${rir ? ` (z ${rir} w zapasie)` : ""}`
            : rir !== null && rir > 4 ? "RIR > 4 - za daleko od upadku, bez estymacji 1RM"
            : "powyżej 10 powt. - bez estymacji 1RM"}
          {pct ? ` · ${pct}% Twojego 1RM` : ""}
          {plates ? ` · ${plates}` : ""}
          {e1 && oneRm > 0 && e1 > oneRm ? " · nowy rekord!" : ""}
        </p>
      )}
    </div>
  );
}
