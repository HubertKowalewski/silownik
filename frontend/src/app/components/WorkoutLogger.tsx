// Rejestracja treningu (WF-23 - WF-26, WF-29, WF-30) w module mobilnym.
// - ćwiczenia i ciężary z jednostki planu, z historii ("powtórz") albo dodane ręcznie,
// - zaliczenie serii jednym dotknięciem (WN-02) uruchamia minutnik przerwy,
// - szacowane 1RM każdej serii liczone na bieżąco, z oznaczeniem nowego rekordu,
// - trening w toku (wraz z minutnikiem) zapisywany lokalnie - przetrwa odświeżenie,
// - zapis bez połączenia trafia do kolejki offline (WN-03, WN-04),
// - w trakcie treningu ekran telefonu nie wygasa.
// Logika: workout/useWorkout.ts, model danych: workout/model.ts.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Clock, Dumbbell, Globe, Lock, Save, Timer } from "lucide-react";
import { trainingApi, errorText } from "../../lib/api";
import { fmtDateTime, fmtKg } from "../../lib/format";
import { useWakeLock } from "../../lib/hooks";
import { ErrorText, ExercisePicker, Field, Page } from "./common";
import { RestTimer, startTimer, unlockAudio } from "./RestTimer";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { ExerciseBlockCard } from "./workout/ExerciseBlockCard";
import { Elapsed, ManualRest, PlanDayPicker } from "./workout/StartPanels";
import { useWorkout } from "./workout/useWorkout";
import { WorkoutSummary } from "./workout/WorkoutSummary";

export function WorkoutLogger() {
  const w = useWorkout();
  const { draft, plans } = w;
  const [params, setParams] = useSearchParams();
  const [manualRest, setManualRest] = useState(false);
  useWakeLock(draft.blocks.length > 0 && !draft.editingId);

  // wejście z innych ekranów: ?plan=&day= (start jednostki), ?edit= / ?repeat= (z historii)
  useEffect(() => {
    const planId = Number(params.get("plan"));
    const sessionId = Number(params.get("edit") || params.get("repeat"));
    if (sessionId) {
      if (w.confirmReplace()) {
        trainingApi.session(sessionId).then((s) => w.loadSession(s, params.get("edit") ? "edit" : "repeat"))
          .catch((e) => w.setError(errorText(e)));
      }
      setParams({}, { replace: true });
      return;
    }
    if (!planId || !plans.length) return;
    const p = plans.find((x) => x.id === planId);
    const dayId = Number(params.get("day")) || null;
    const same = draft.planId === planId && (!dayId || draft.dayId === dayId) && draft.blocks.length;
    if (p && !same && w.confirmReplace()) w.loadDay(p, dayId);
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, params]);

  if (w.summary) return <WorkoutSummary summary={w.summary} onNew={() => w.setSummary(null)} />;

  const active = draft.blocks.length > 0;
  return (
    <Page icon={Dumbbell}
      title={draft.editingId ? "Edycja treningu" : "Trening"}
      description={w.plan ? `${w.plan.title} · ${w.plan.days.find((d) => d.id === draft.dayId)?.name ?? ""}`
        : draft.editingId ? `z dnia ${fmtDateTime(draft.startedAt)}`
        : "Wybierz jednostkę z planu, powtórz trening z historii albo dodaj ćwiczenia ręcznie."}
      actions={
        <div className="flex items-center gap-2">
          {active && !draft.editingId && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground" title="Czas treningu">
              <Clock className="h-4 w-4" /> <Elapsed since={draft.startedAt} />
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => { unlockAudio(); setManualRest((v) => !v); }}>
            <Timer className="mr-1 h-4 w-4" /> Minutnik
          </Button>
          {active && <Button variant="ghost" size="sm" onClick={w.reset}>{draft.editingId ? "Anuluj" : "Nowy"}</Button>}
        </div>
      }
    >
      {manualRest && (
        <ManualRest defaultSeconds={w.prefs.default_rest_seconds}
          onStart={(sec) => { w.setTimer(startTimer(sec, "przerwa")); setManualRest(false); }} />
      )}

      {!active && <PlanDayPicker plans={plans} onPick={w.loadDay} />}

      {draft.blocks.map((b, i) => (
        <ExerciseBlockCard key={b.key} block={b} position={i} count={draft.blocks.length} showLegend={i === 0} w={w} />
      ))}

      <Card>
        <CardHeader><CardTitle className="text-lg">{active ? "Dodaj ćwiczenie" : "Trening bez planu"}</CardTitle></CardHeader>
        <CardContent className="max-w-2xl space-y-1.5">
          <ExercisePicker exercises={w.exercises} value={null} onChange={w.addExercise}
            placeholder="Wpisz nazwę, np. wyciskanie, przysiad…" />
          <p className="text-xs text-muted-foreground">Wybrane ćwiczenie od razu pojawi się w treningu.</p>
        </CardContent>
      </Card>

      {active && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Podsumowanie</CardTitle>
            <CardDescription>Zaliczone serie: {w.done.length}/{w.totalSets} · objętość {fmtKg(w.tonnage, 0)}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Tętno po treningu [ud./min]">
              <Input type="number" inputMode="numeric" min={30} max={230} value={draft.hr}
                onChange={(e) => w.setField({ hr: e.target.value })} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Notatki">
                <Textarea maxLength={1000} value={draft.notes} placeholder="Samopoczucie, technika, co poprawić..."
                  onChange={(e) => w.setField({ notes: e.target.value })} />
              </Field>
            </div>
          </CardContent>
        </Card>
      )}

      {active && !draft.editingId && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4">
          <Switch checked={draft.share ?? w.sharing.byDefault} onCheckedChange={(v) => w.setField({ share: v })}
            aria-label="Udostępnij trening" className="mt-0.5" />
          <span className="min-w-0 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              {(draft.share ?? w.sharing.byDefault) ? <Globe className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
              Udostępnij trening w Społeczności
            </span>
            <span className="block text-xs text-muted-foreground">
              {(draft.share ?? w.sharing.byDefault)
                ? w.sharing.profilePublic
                  ? "Zobaczą go wszyscy (masz profil publiczny). Notatki i tętno zostają tylko dla Ciebie."
                  : "Zobaczą go osoby, z którymi obserwujecie się wzajemnie. Notatki i tętno zostają tylko dla Ciebie."
                : "Trening zobaczysz tylko Ty."}
            </span>
          </span>
        </label>
      )}

      <ErrorText>{w.error}</ErrorText>
      {active && (
        <div className={draft.timer ? "pb-24" : ""}>
          <Button onClick={w.save} disabled={w.saving}>
            <Save className="mr-2 h-4 w-4" /> {draft.editingId ? "Zapisz zmiany" : "Zakończ i zapisz"}
          </Button>
        </div>
      )}

      {draft.timer && <RestTimer timer={draft.timer} prefs={w.prefs} onChange={w.setTimer} />}
    </Page>
  );
}
