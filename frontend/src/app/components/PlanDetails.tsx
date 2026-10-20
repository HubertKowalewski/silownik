// Szczegóły planu: dopasowanie (WF-14/15), klonowanie ze skalowaniem (WF-16 - WF-18),
// wątek konsultacji (WF-19), osoby realizujące plan (WF-20), zgoda (WF-04), zgłoszenia (WF-22).
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { AlertTriangle, Calculator, ClipboardList, Copy, Edit, Flag, GitFork, Loader2, MessageSquare, Play, Reply, Sparkles, Trash2, Users } from "lucide-react";
import {
  Follower, label, loadText, Match, PlanComment, ScaledItem, trainingApi, WorkoutPlan, errorText,
} from "../../lib/api";
import { ErrorText, NativeSelect, Page, Spinner } from "./common";
import { fmtDate, fmtDateTime, fmtKg, plural } from "../../lib/format";
import { useMeta } from "../../lib/hooks";
import { ExerciseName } from "./ExerciseName";
import { Avatar } from "./Avatar";

function ForkPanel({ plan, onClose }: { plan: WorkoutPlan; onClose: () => void }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<(Match & { items: ScaledItem[] }) | null>(null);
  const [subs, setSubs] = useState<Record<string, number>>({});
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trainingApi.forkPreview(plan.id).then(setPreview).catch((e) => setError(e.message));
  }, [plan.id]);

  const fork = async () => {
    setBusy(true);
    try {
      const r = await trainingApi.forkPlan(plan.id, { substitutions: subs, share_progress: share });
      navigate(`/plany/${r.forked_plan_id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const warnings = new Map(preview?.warnings.map((w) => [w.plan_exercise_id, w]) ?? []);
  const calibrate = preview?.items.filter((i) => i.needs_calibration) ?? [];

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GitFork className="h-4 w-4" /> Klonowanie planu</CardTitle>
        <CardDescription>
          Obciążenia zostaną przeliczone na podstawie Twojego 1RM (wynik testu, wpis ręczny albo szacunek z treningów).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!preview && !error && <Spinner text="Przeliczanie obciążeń..." />}
        {preview && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2">Jednostka</th><th className="py-1 pr-2">Ćwiczenie</th>
                  <th className="py-1 pr-2">Serie</th><th className="py-1 pr-2">W planie</th>
                  <th className="py-1 pr-2">Dla Ciebie</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((it) => {
                  const w = warnings.get(it.plan_exercise_id);
                  return (
                    <tr key={it.plan_exercise_id} className="border-t border-border align-top">
                      <td className="py-2 pr-2">{it.day_name}</td>
                      <td className="py-2 pr-2">
                        <ExerciseName name={it.exercise_name} />
                        {w && (
                          <div className="mt-1 space-y-1 text-xs text-warning">
                            <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> obciąża: {w.areas.join(", ")}</span>
                            {w.substitutes.length > 0 && (
                              <NativeSelect className="h-8 text-xs" value={subs[it.plan_exercise_id] ?? ""}
                                onChange={(e) => {
                                  const next = { ...subs };
                                  if (e.target.value) next[it.plan_exercise_id] = Number(e.target.value);
                                  else delete next[it.plan_exercise_id];
                                  setSubs(next);
                                }}>
                                <option value="">Zostaw ćwiczenie z planu</option>
                                {w.substitutes.map((s) => <option key={s.id} value={s.id}>Zamień na: {s.name}</option>)}
                              </NativeSelect>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2">{it.sets}×{it.reps}</td>
                      <td className="py-2 pr-2">{loadText(it)}</td>
                      <td className="py-2 pr-2">
                        {it.suggested_weight != null ? <strong>{fmtKg(it.suggested_weight)}</strong>
                          : it.needs_calibration ? <Badge variant="destructive">kalibracja</Badge> : "wg RPE"}
                        <span className="block text-xs text-muted-foreground">{it.based_on}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {calibrate.length > 0 && (
          <p className="rounded-md bg-muted p-3 text-sm">
            Dla {calibrate.length} ćwiczeń nie znamy Twojego 1RM. Po sklonowaniu wykonaj{" "}
            <Link className="underline" to="/pomiary">ćwiczenie testowe</Link> albo wpisz 1RM ręcznie, a następnie
            użyj przycisku „Przelicz obciążenia”.
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={share} onCheckedChange={(v) => setShare(v === true)} />
          <span>Udostępnij autorowi planu ({plan.creator_name}) moje postępy w ramach tego planu (liczba treningów i 1RM
            ćwiczeń z planu). Dane o zdrowiu nigdy nie są udostępniane. Zgodę można cofnąć.</span>
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button onClick={fork} disabled={!preview || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitFork className="mr-2 h-4 w-4" />} Sklonuj plan
          </Button>
          <Button variant="ghost" onClick={onClose}>Anuluj</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Consultation({ plan }: { plan: WorkoutPlan }) {
  const [thread, setThread] = useState<{ plan_id: number; plan_title: string; comments: PlanComment[] } | null>(null);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<PlanComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => trainingApi.comments(plan.id).then(setThread).catch((e) => setError(e.message)), [plan.id]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!text.trim()) return;
    try {
      await trainingApi.addComment(plan.id, text, replyTo?.id ?? null);
      setText("");
      setReplyTo(null);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const flag = async (c: PlanComment) => {
    const reason = prompt("Dlaczego zgłaszasz ten wpis?");
    if (reason?.trim()) await sendReport(trainingApi.flagComment(c.id, reason));
  };

  const roots = thread?.comments.filter((c) => !c.parent) ?? [];
  const replies = (id: number) => thread?.comments.filter((c) => c.parent === id) ?? [];
  const Item = ({ c, nested }: { c: PlanComment; nested?: boolean }) => (
    <div className={`rounded-md border border-border p-3 text-sm ${nested ? "ml-6 bg-muted/40" : ""}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link to={`/uzytkownicy/${encodeURIComponent(c.author_name)}`} className="flex items-center gap-1.5 hover:underline">
          <Avatar name={c.author_name} url={c.author_avatar} size="xs" />
          <strong className="text-foreground">{c.author_name}</strong>
        </Link>
        {c.is_plan_author && <Badge variant="secondary">autor planu</Badge>}
        {fmtDateTime(c.created_at)}
        <span className="ml-auto flex gap-1">
          {!nested && <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setReplyTo(c)}><Reply className="mr-1 h-3 w-3" /> Odpowiedz</Button>}
          <Button variant="ghost" size="sm" className="h-6 px-2" aria-label="Zgłoś wpis" onClick={() => flag(c)}><Flag className="h-3 w-3" /></Button>
        </span>
      </div>
      <p className="whitespace-pre-wrap">{c.text}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Konsultacje z autorem</CardTitle>
        <CardDescription>
          {thread && thread.plan_id !== plan.id
            ? `Wątek planu oryginalnego „${thread.plan_title}” - pytania trafiają do jego autora.`
            : "Zadaj pytanie autorowi planu. Autor otrzyma powiadomienie."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {roots.length === 0 && <p className="text-sm text-muted-foreground">Brak pytań - bądź pierwszy.</p>}
        {roots.map((c) => (
          <div key={c.id} className="space-y-2">
            <Item c={c} />
            {replies(c.id).map((r) => <Item key={r.id} c={r} nested />)}
          </div>
        ))}
        {replyTo && (
          <p className="text-xs text-muted-foreground">
            Odpowiedź do: {replyTo.author_name} <button className="underline" onClick={() => setReplyTo(null)}>anuluj</button>
          </p>
        )}
        <Textarea placeholder="Twoje pytanie lub odpowiedź..." maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <Button onClick={send} disabled={!text.trim()}>Wyślij</Button>
      </CardContent>
    </Card>
  );
}

function Followers({ planId }: { planId: number }) {
  const [list, setList] = useState<Follower[] | null>(null);
  useEffect(() => { trainingApi.followers(planId).then(setList).catch(() => setList([])); }, [planId]);
  if (!list) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Osoby realizujące plan ({list.length})</CardTitle>
        <CardDescription>Postępy widzisz tylko u osób, które wyraziły na to zgodę.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 && <p className="text-sm text-muted-foreground">Nikt jeszcze nie sklonował tego planu.</p>}
        {list.map((f, i) => (
          <div key={i} className="border-b border-border py-2 text-sm last:border-0">
            <div className="flex justify-between">
              <strong>{f.username}</strong>
              <span className="text-muted-foreground">od {fmtDate(f.forked_at)}</span>
            </div>
            {f.shares_progress ? (
              <div className="text-muted-foreground">
                {plural(f.sessions ?? 0, "trening", "treningi", "treningów")}{f.last_session ? `, ostatni ${fmtDate(f.last_session)}` : ""}
                {f.progress?.length ? ` · ${f.progress.map((p) => `${p.exercise.split(" / ")[0]}: ${p.current_1rm || "–"} kg`).join(", ")}` : ""}
              </div>
            ) : (
              <div className="text-muted-foreground">Brak zgody na udostępnianie postępów.</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Wysyła zgłoszenie treści i pokazuje odpowiedź serwera (np. „już zgłoszone”). */
async function sendReport(request: Promise<{ detail: string }>) {
  try {
    alert((await request).detail);
  } catch (e) {
    alert(errorText(e, "Nie udało się wysłać zgłoszenia."));
  }
}

/** Przerwa czytelnie: 90 s -> "1:30 min", 120 s -> "2 min". */
function restText(sec: number) {
  const m = Math.floor(sec / 60), r = sec % 60;
  return m === 0 ? `${r} s` : r ? `${m}:${String(r).padStart(2, "0")} min` : `${m} min`;
}

export function PlanDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meta = useMeta();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    trainingApi.plan(Number(id)).then((p) => {
      setPlan(p);
      if (!p.is_owner) trainingApi.match(p.id).then(setMatch).catch(() => {});
    }).catch((e) => setError(e.status === 404 ? "Plan nie istnieje albo nie masz do niego dostępu." : e.message));
  }, [id]);

  useEffect(() => {
    setForking(false);
    load();
  }, [load]);

  if (!plan) return error ? <Page icon={ClipboardList} title="Plan"><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  const remove = async () => {
    if (!confirm(`Usunąć plan „${plan.title}”?`)) return;
    await trainingApi.deletePlan(plan.id);
    navigate("/plany");
  };
  const recalc = async () => setPlan(await trainingApi.recalculate(plan.id));
  const flagPlan = async () => {
    const reason = prompt("Dlaczego zgłaszasz ten plan?");
    if (reason?.trim()) await sendReport(trainingApi.flagPlan(plan.id, reason));
  };
  const needsCalibration = plan.days.some((d) => d.exercises.some((e) => e.needs_calibration));
  const weeks = [...new Set(plan.days.map((d) => d.week))];

  return (
    <Page icon={ClipboardList}
      title={plan.title}
      description={<>autor: <Link className="font-medium underline-offset-2 hover:underline" to={`/uzytkownicy/${encodeURIComponent(plan.creator_name)}`}>{plan.creator_name}</Link>
        {plan.parent_title ? ` · kopia planu „${plan.parent_title}” (${plan.parent_creator})` : ""}</>}
      actions={
        <div className="flex flex-wrap gap-2">
          {plan.is_owner ? (
            <>
              <Button onClick={() => navigate(`/trening?plan=${plan.id}`)}><Play className="mr-2 h-4 w-4" /> Trenuj</Button>
              <Button variant="outline" onClick={() => navigate(`/plany/${plan.id}/edycja`)}><Edit className="mr-2 h-4 w-4" /> Edytuj</Button>
              <Button variant="outline" onClick={recalc}><Calculator className="mr-2 h-4 w-4" /> Przelicz obciążenia</Button>
              <Button variant="outline" onClick={async () => navigate(`/plany/${(await trainingApi.duplicatePlan(plan.id)).id}`)}>
                <Copy className="mr-2 h-4 w-4" /> Duplikuj
              </Button>
              <Button variant="ghost" size="icon" aria-label="Usuń plan" onClick={remove}><Trash2 className="h-4 w-4" /></Button>
            </>
          ) : (
            <>
              <Button onClick={() => setForking(true)} disabled={forking}><GitFork className="mr-2 h-4 w-4" /> Sklonuj i dostosuj</Button>
              <Button variant="ghost" size="icon" aria-label="Zgłoś plan" onClick={flagPlan}><Flag className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      }
    >
      {plan.is_hidden && (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          {plan.is_owner
            ? "Plan został ukryty przez moderatora - widzisz go tylko Ty. Szczegóły znajdziesz w powiadomieniach."
            : "Plan jest ukryty przez moderatora - pozostali użytkownicy go nie widzą."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{label(meta?.goals, plan.goal)}</Badge>
        <Badge variant="outline">{label(meta?.levels, plan.level)}</Badge>
        <Badge variant="outline">{plan.days_per_week} dni/tydz.</Badge>
        <Badge variant="outline">{plan.duration_weeks} tyg.</Badge>
        {plan.required_equipment.map((e) => <Badge key={e} variant="secondary">{label(meta?.equipment, e)}</Badge>)}
        <Badge variant={plan.is_public ? "default" : "secondary"}>{plan.is_public ? "publiczny" : "prywatny"}</Badge>
      </div>
      {!plan.is_owner && (
        <p className="text-sm">
          <Link className="underline" to={`/uzytkownicy/${plan.creator_name}`}>Profil autora: {plan.creator_name}</Link>
          <span className="text-muted-foreground"> (widoczny, jeśli autor go udostępnia)</span>
        </p>
      )}
      {plan.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{plan.description}</p>}

      {match && (
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Zgodność z Twoim profilem: <strong>{match.score}%</strong>
            </div>
            {match.reasons.length > 0 && <p className="text-muted-foreground">Różnice: {match.reasons.join("; ")}.</p>}
            {match.warnings.map((w) => (
              <p key={w.plan_exercise_id} className="flex items-start gap-2 text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {w.exercise_name.split(" / ")[0]} obciąża: {w.areas.join(", ")}.
                {w.substitutes.length > 0 && ` Możliwe zamienniki: ${w.substitutes.map((s) => s.name).join(", ")}.`}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {forking && <ForkPanel plan={plan} onClose={() => setForking(false)} />}

      {plan.is_owner && needsCalibration && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Część pozycji wymaga kalibracji - brakuje Twojego 1RM. Wykonaj <Link className="underline" to="/pomiary">ćwiczenie testowe</Link>,
          a potem kliknij „Przelicz obciążenia”.
        </p>
      )}

      {plan.is_owner && plan.parent_plan && (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={plan.share_progress_with_author}
            onCheckedChange={async (v) => {
              await trainingApi.shareProgress(plan.id, v);
              setPlan({ ...plan, share_progress_with_author: v });
            }} />
          Udostępniaj autorowi planu oryginalnego moje postępy w ramach tego planu
        </label>
      )}

      {weeks.map((week) => (
        <div key={week} className="space-y-3">
          {weeks.length > 1 && <h2 className="text-lg font-semibold">Tydzień {week}</h2>}
          {plan.days.filter((d) => d.week === week).map((day) => (
            <Card key={day.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{day.name}</CardTitle>
                {plan.is_owner && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/trening?plan=${plan.id}&day=${day.id}`)}>
                    <Play className="mr-1 h-3.5 w-3.5" /> Rozpocznij
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <table className="hidden w-full text-sm md:table">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2">Ćwiczenie</th><th className="py-1 pr-2">Serie</th>
                      <th className="py-1 pr-2">Obciążenie</th>{plan.is_owner && <th className="py-1 pr-2">Twój ciężar</th>}
                      <th className="py-1 pr-2">Przerwa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.exercises.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="py-2 pr-2"><ExerciseName name={e.exercise_name} />{e.notes && <span className="block text-xs text-muted-foreground">{e.notes}</span>}</td>
                        <td className="py-2 pr-2">
                          {e.target_sets}×{e.target_reps}{e.target_reps_max && e.target_reps_max !== e.target_reps ? `-${e.target_reps_max}` : ""}
                          {e.target_rir != null && <span className="block text-xs text-muted-foreground">RIR {e.target_rir}</span>}
                        </td>
                        <td className="py-2 pr-2">{loadText(e)}</td>
                        {plan.is_owner && (
                          <td className="py-2 pr-2">
                            {e.calculated_weight != null ? <strong>{fmtKg(e.calculated_weight)}</strong>
                              : e.needs_calibration ? <Badge variant="destructive">kalibracja</Badge> : "–"}
                          </td>
                        )}
                        <td className="py-2 pr-2">{restText(e.rest_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="divide-y divide-border md:hidden">
                  {day.exercises.map((e) => (
                    <li key={e.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0 text-sm">
                      <ExerciseName name={e.exercise_name} className="block font-medium" />
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        <Badge variant="secondary">
                          {e.target_sets}×{e.target_reps}{e.target_reps_max && e.target_reps_max !== e.target_reps ? `-${e.target_reps_max}` : ""}
                          {e.target_rir != null ? ` · RIR ${e.target_rir}` : ""}
                        </Badge>
                        <Badge variant="outline">{loadText(e)}</Badge>
                        {plan.is_owner && (e.calculated_weight != null
                          ? <Badge>{fmtKg(e.calculated_weight)}</Badge>
                          : e.needs_calibration ? <Badge variant="destructive">kalibracja</Badge> : null)}
                        <Badge variant="outline">przerwa {restText(e.rest_seconds)}</Badge>
                      </div>
                      {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      ))}

      {(plan.is_public || plan.parent_plan) && <Consultation plan={plan} />}
      {plan.is_owner && plan.is_public && <Followers planId={plan.id} />}
    </Page>
  );
}
