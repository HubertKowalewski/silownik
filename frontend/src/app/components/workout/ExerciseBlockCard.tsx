// Karta jednego ćwiczenia w treningu: cel z planu, przerwa, podpowiedzi, notatka i lista serii.
import { useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, Flame, History, Minus, Plus, StickyNote, Timer, Trash2, TrendingUp, Trophy } from "lucide-react";
import { Substitute, trainingApi } from "../../../lib/api";
import { fmtKg, numOrNull } from "../../../lib/format";
import { estimate1RM } from "../../../lib/oneRepMax";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ExercisePicker } from "../common";
import { fmtClock, REST_PRESETS } from "../RestTimer";
import { Block, rirOf, Scale, SCALE_INFO, scaleOf } from "./model";
import { setGrid, SetRowEditor } from "./SetRowEditor";
import { Workout } from "./useWorkout";
import { ExerciseName } from "../ExerciseName";

type Props = { block: Block; position: number; count: number; showLegend: boolean; w: Workout };

export function ExerciseBlockCard({ block: b, position, count, showLegend, w }: Props) {
  const [restOpen, setRestOpen] = useState(false);
  const [explain, setExplain] = useState(false);   // objaśnienie skali po jej zmianie
  const scale = scaleOf(b, w.scale);
  const [swap, setSwap] = useState<Substitute[] | null>(null);
  const openSwap = () => {
    if (swap) return setSwap(null);
    setSwap([]);
    trainingApi.substitutes(b.exercise).then(setSwap).catch(() => setSwap([]));
  };
  const chooseSwap = (id: number | null) => {
    if (!id) return;
    w.swapExercise(b, id);
    setSwap(null);
  };
  const oneRm = w.records[b.exercise] ?? 0;
  const barbell = w.isBarbell(b.exercise);
  const bestToday = Math.max(0, ...b.sets.map((s) =>
    estimate1RM(numOrNull(s.weight), numOrNull(s.reps), s.warmup, rirOf(s, scale)) ?? 0));
  const step = w.prefs.rest_step_seconds;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
          <div className="min-w-0">
            <CardTitle className="font-sans text-base font-semibold leading-snug tracking-normal"><ExerciseName name={b.name} wrap /></CardTitle>
            <CardDescription className="text-xs sm:text-sm">{b.target}</CardDescription>
          </div>
          <div className="-ml-2 flex shrink-0 items-center sm:ml-0">
            <Button size="sm" variant="ghost" aria-label="Ustaw przerwę" onClick={() => setRestOpen((v) => !v)}>
              <Timer className="mr-1 h-4 w-4" /> {fmtClock(b.rest)}
            </Button>
            <Button size="icon" variant="ghost" aria-label="Zamień ćwiczenie" title="Zamień ćwiczenie" onClick={openSwap}>
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Przesuń wyżej" disabled={position === 0}
              onClick={() => w.moveBlock(b.key, -1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label="Przesuń niżej" disabled={position === count - 1}
              onClick={() => w.moveBlock(b.key, 1)}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label="Usuń ćwiczenie"
              onClick={() => (!b.sets.some((s) => s.done) || confirm(`Usunąć ${b.name.split(" / ")[0]} wraz z zaliczonymi seriami?`)) && w.removeBlock(b.key)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {restOpen && (
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted/50 p-2">
            <span className="mr-1 text-xs text-muted-foreground">Przerwa po serii:</span>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Krótsza przerwa"
              onClick={() => w.setBlock(b.key, { rest: Math.max(0, b.rest - step) })}><Minus className="h-3 w-3" /></Button>
            <span className="w-14 text-center font-mono text-sm">{fmtClock(b.rest)}</span>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Dłuższa przerwa"
              onClick={() => w.setBlock(b.key, { rest: Math.min(900, b.rest + step) })}><Plus className="h-3 w-3" /></Button>
            {REST_PRESETS.map((sec) => (
              <Button key={sec} size="sm" className="h-8 px-2" variant={b.rest === sec ? "default" : "outline"}
                onClick={() => w.setBlock(b.key, { rest: sec })}>{fmtClock(sec)}</Button>
            ))}
            <Button size="sm" className="h-8 px-2" variant={b.rest === 0 ? "default" : "outline"}
              onClick={() => w.setBlock(b.key, { rest: 0 })}>bez przerwy</Button>
          </div>
        )}

        {swap && (
          <div className="min-w-0 space-y-2 rounded-md bg-muted/50 p-2 text-xs">
            <p className="text-muted-foreground">Zamień na ćwiczenie tej samej partii (z uwzględnieniem ankiety zdrowotnej i sprzętu):</p>
            <div className="flex flex-wrap gap-1">
              {swap.map((s) => (
                <Button key={s.id} size="sm" variant="outline" className="h-auto max-w-full whitespace-normal px-2 py-1 text-left text-xs"
                  onClick={() => chooseSwap(s.id)}>{s.name.split(" / ")[0]}</Button>
              ))}
            </div>
            <ExercisePicker exercises={w.exercises} value={null} onChange={chooseSwap} />
          </div>
        )}
        {b.hint && <p className="flex items-center gap-1 text-xs text-muted-foreground"><History className="h-3 w-3" /> {b.hint}</p>}
        {b.suggestion && b.suggestion.weight != null && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/5 p-2 text-xs">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <span>
              <strong>Na dziś: {fmtKg(b.suggestion.weight)} × {b.suggestion.reps_min}{b.suggestion.reps_max !== b.suggestion.reps_min ? `-${b.suggestion.reps_max}` : ""}</strong>
              {" - "}{b.suggestion.reason}
            </span>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => w.applySuggestion(b)}>Zastosuj</Button>
          </div>
        )}
        {b.suggestion && b.suggestion.weight == null && b.suggestion.action !== "start" && (
          <p className="text-xs text-muted-foreground">{b.suggestion.reason}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => w.addWarmup(b)}
            disabled={b.sets.some((x) => x.warmup)}>
            <Flame className="mr-1 h-3.5 w-3.5" /> Rozgrzewka
          </Button>
          <label className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
            <StickyNote className="h-3.5 w-3.5 shrink-0" />
            <input className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-border focus:outline-none"
              placeholder="notatka, np. siedzisko na 4" maxLength={500} value={b.note ?? ""}
              onChange={(e) => w.setBlock(b.key, { note: e.target.value })}
              onBlur={(e) => trainingApi.saveNote(b.exercise, e.target.value).catch(() => undefined)} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Twoje 1RM: {oneRm ? <strong className="text-foreground">{fmtKg(oneRm)}</strong> : "jeszcze nieznane"}
          {bestToday > 0 && <> · dziś ≈ <strong className="text-foreground">{fmtKg(bestToday)}</strong></>}
          {oneRm > 0 && bestToday > oneRm && <Badge className="ml-2 h-5"><Trophy className="mr-1 h-3 w-3" /> rekord</Badge>}
        </p>
      </CardHeader>

      <CardContent className="max-w-2xl space-y-1">
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <span className="text-xs text-muted-foreground" id={`scale-${b.key}`}>Zapis serii:</span>
          <div role="radiogroup" aria-labelledby={`scale-${b.key}`} className="inline-flex rounded-lg bg-muted p-0.5">
            {(["reps", "rir", "rpe"] as Scale[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={scale === k} title={SCALE_INFO[k].help}
                onClick={() => { w.setBlockScale(b, k); setExplain(true); }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${scale === k
                  ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {SCALE_INFO[k].label}
              </button>
            ))}
          </div>
        </div>
        {(showLegend || explain) && <p className="text-[11px] text-muted-foreground">{SCALE_INFO[scale].help}</p>}
        <div className={`${setGrid(scale)} text-center text-xs text-muted-foreground`}>
          <span>#</span><span>kg</span><span>powt.</span>
          {scale !== "reps" && <span title={SCALE_INFO[scale].help}>{SCALE_INFO[scale].short}</span>}
          <span title="Seria rozgrzewkowa">R</span><span /><span />
        </div>
        {b.sets.map((s, i) => (
          <SetRowEditor key={s.key} set={s} index={i} scale={scale} oneRm={oneRm} barbell={barbell}
            canRemove={b.sets.length > 1}
            onChange={(patch) => w.updateSet(b.key, s.key, patch)}
            onComplete={() => w.completeSet(b, s, i)}
            onRemove={() => w.removeSet(b, s.key)} />
        ))}
        <Button size="sm" variant="ghost" onClick={() => w.addSet(b)}>
          <Plus className="mr-1 h-4 w-4" /> Seria
        </Button>
      </CardContent>
    </Card>
  );
}
