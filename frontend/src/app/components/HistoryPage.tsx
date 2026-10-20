// Historia treningów: podgląd, edycja, usunięcie, powtórzenie i zapis jako plan (WF-23 - WF-26).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { ChevronDown, ChevronUp, Edit, History, ListPlus, Repeat, Trash2 } from "lucide-react";
import { PlanComparison, Session, trainingApi, errorText } from "../../lib/api";
import { estimate1RM } from "../../lib/oneRepMax";
import { ErrorText, Page, Spinner } from "./common";
import { fmtClock } from "./RestTimer";
import { fmtKg, fmtLongDate, fmtNumber, plural } from "../../lib/format";
import { ExerciseName } from "./ExerciseName";

function SessionDetails({ s }: { s: Session }) {
  const order: number[] = [];
  s.sets.forEach((x) => !order.includes(x.exercise) && order.push(x.exercise));
  return (
    <div className="space-y-3">
      {order.map((exId) => {
        const sets = s.sets.filter((x) => x.exercise === exId);
        const best = Math.max(0, ...sets.map((x) => estimate1RM(x.weight, x.reps, x.is_warmup, x.rir ?? null) ?? 0));
        return (
          <div key={exId} className="text-sm">
            <div className="flex justify-between gap-2">
              <strong className="min-w-0"><ExerciseName name={sets[0].exercise_name} /></strong>
              {best > 0 && <span className="shrink-0 text-muted-foreground">≈ 1RM {fmtKg(best)}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 text-muted-foreground">
              {sets.map((x) => (
                <span key={x.id}>
                  {x.is_warmup ? "R: " : ""}{fmtKg(x.weight)} × {x.reps}{x.rir != null ? ` · RIR ${x.rir}` : x.rpe ? ` @${x.rpe}` : ""}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {s.notes && <p className="whitespace-pre-wrap border-t border-border pt-2 text-sm">{s.notes}</p>}
    </div>
  );
}

const STATUS: Record<string, string> = { done: "wykonane", partial: "częściowo", skipped: "pominięte", added: "spoza planu" };

function Comparison({ id }: { id: number }) {
  const [data, setData] = useState<PlanComparison | null>(null);
  useEffect(() => { trainingApi.compareSession(id).then(setData).catch(() => {}); }, [id]);
  if (!data) return null;
  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
      <p className="font-medium">Realizacja planu ({data.plan_day}): {data.completion_percent ?? "–"}% serii</p>
      {data.items.map((i) => (
        <div key={i.exercise} className="flex flex-wrap justify-between gap-x-3 text-xs">
          <span className="truncate">{i.exercise.split(" / ")[0]}</span>
          <span className="text-muted-foreground">plan {i.planned} · wykonano {i.done} · <strong>{STATUS[i.status]}</strong></span>
        </div>
      ))}
    </div>
  );
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (page = 1) =>
    trainingApi.sessions(page).then((d) => {
      setSessions((prev) => (page === 1 ? d.results : [...(prev ?? []), ...d.results]));
      setNext(d.next ? page + 1 : null);
    }).catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const remove = async (s: Session) => {
    if (!confirm("Usunąć ten trening? Rekordy 1RM zostaną przeliczone bez niego.")) return;
    try {
      await trainingApi.deleteSession(s.id);
      setSessions((list) => list?.filter((x) => x.id !== s.id) ?? null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toPlan = async (s: Session) => {
    const title = prompt("Nazwa nowego planu:", s.plan_title ? `${s.plan_title} (mój)` : "Mój trening");
    if (!title) return;
    try {
      const plan = await trainingApi.sessionToPlan(s.id, title);
      navigate(`/plany/${plan.id}`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!sessions) return error ? <Page icon={History} title="Historia treningów"><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  return (
    <Page icon={History} title="Historia treningów" description="Kliknij trening, aby zobaczyć serie. Edycja i usunięcie przeliczają rekordy 1RM.">
      <ErrorText>{error}</ErrorText>
      {sessions.length === 0 && <p className="text-sm text-muted-foreground">Nie masz jeszcze zapisanych treningów.</p>}
      {sessions.map((s) => {
        const working = s.sets.filter((x) => !x.is_warmup).length;
        const exercises = new Set(s.sets.map((x) => x.exercise)).size;
        return (
          <Card key={s.id} className="gap-0">
            <CardHeader className="p-0">
              <button type="button" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}
                className="flex w-full items-start justify-between gap-2 rounded-xl px-6 py-5 text-left hover:bg-muted/40">
                <div className="min-w-0">
                  <CardTitle className="text-lg">
                    {fmtLongDate(s.date_completed)}
                  </CardTitle>
                  <CardDescription>
                    {s.plan_title ? `${s.plan_title}${s.day_name ? ` · ${s.day_name}` : ""}` : "Trening bez planu"}
                    {" · "}{plural(exercises, "ćwiczenie", "ćwiczenia", "ćwiczeń")} · {plural(working, "seria", "serie", "serii")} · {fmtNumber(s.total_tonnage, 0)} kg
                    {s.duration_seconds ? ` · ${fmtClock(s.duration_seconds)}` : ""}
                    {s.post_workout_hr ? ` · tętno ${s.post_workout_hr}` : ""}
                  </CardDescription>
                </div>
                {open === s.id ? <ChevronUp className="mt-1 h-4 w-4 shrink-0" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0" />}
              </button>
            </CardHeader>
            {open === s.id && (
              <CardContent className="space-y-4">
                {s.plan_day && <Comparison id={s.id} />}
                <SessionDetails s={s} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate(`/trening?repeat=${s.id}`)}><Repeat className="mr-1 h-4 w-4" /> Powtórz</Button>
                  <Button size="sm" variant="outline" onClick={() => navigate(`/trening?edit=${s.id}`)}><Edit className="mr-1 h-4 w-4" /> Edytuj</Button>
                  <Button size="sm" variant="outline" onClick={() => toPlan(s)}><ListPlus className="mr-1 h-4 w-4" /> Zapisz jako plan</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s)}><Trash2 className="mr-1 h-4 w-4" /> Usuń</Button>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
      {next && <Button variant="outline" onClick={() => load(next)}>Wczytaj starsze</Button>}
    </Page>
  );
}
