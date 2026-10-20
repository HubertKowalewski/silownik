// Nazwa ćwiczenia: polska jako główna, angielska jako mały podpis (pełna nazwa zawsze w podpowiedzi).
import { exerciseName } from "../../lib/format";

export function ExerciseName({ name, secondary = true, wrap = false, className = "" }: {
  name?: string | null; secondary?: boolean; wrap?: boolean; className?: string;
}) {
  const { pl, en } = exerciseName(name);
  const line = wrap ? "block break-words" : "block truncate";
  return (
    <span className={`block min-w-0 ${className}`} title={en ? `${pl} / ${en}` : pl}>
      <span className={line}>{pl}</span>
      {secondary && en && <span className={`${line} text-xs font-normal text-muted-foreground`}>{en}</span>}
    </span>
  );
}
