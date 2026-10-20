// Statystyki (WF-31 - WF-33) i raporty okresowe (WF-34).
import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Activity, BarChart3, CalendarDays, FileDown, FileSpreadsheet, Flame, Gauge, ListChecks, Trophy, Weight } from "lucide-react";
import { PeriodReport, Stats, trainingApi } from "../../lib/api";
import { ErrorText, ExercisePicker, Field, NativeSelect, Page, Spinner, StatTile } from "./common";
import { fmtDate, fmtKg, fmtNumber, plural } from "../../lib/format";
import { useExercises } from "../../lib/hooks";
import { ExerciseName } from "./ExerciseName";

const SOURCE: Record<string, string> = { test: "test", manual: "ręcznie", estimate: "szacunek", none: "–" };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Kolejne liczby powtórzeń z tym samym rekordem (ta sama seria) łączone w jeden wiersz: „1–6 powt. → 62,5 kg”. */
export function groupRepRecords<T extends { reps: number; weight: number; date: string }>(records: T[]) {
  const out: { from: number; to: number; weight: number; date: string }[] = [];
  for (const r of [...records].sort((a, b) => a.reps - b.reps)) {
    const last = out.at(-1);
    if (last && last.weight === r.weight && last.date === r.date && last.to === r.reps - 1) last.to = r.reps;
    else out.push({ from: r.reps, to: r.reps, weight: r.weight, date: r.date });
  }
  return out;
}

export function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const exercises = useExercises();
  const [exerciseId, setExerciseId] = useState<number | null>(null);
  const [weeks, setWeeks] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [report, setReport] = useState<PeriodReport | null>(null);


  useEffect(() => {
    trainingApi.stats(weeks, exerciseId ?? undefined).then(setStats)
      .catch((e) => setError(e?.message ?? "Nie udało się pobrać statystyk."));
  }, [weeks, exerciseId]);

  // Bez wybranego ćwiczenia wykres progresji byłby pusty - wybierz pierwsze ćwiczenie z danymi.
  useEffect(() => {
    if (exerciseId == null && stats?.personalRecords.length) setExerciseId(stats.personalRecords[0].exercise_id);
  }, [stats, exerciseId]);

  // Ćwiczenia, dla których są zapisane serie - na górze listy.
  const withData = useMemo(() => {
    const ids = new Set(stats?.personalRecords.map((r) => r.exercise_id));
    return [...exercises.filter((e) => ids.has(e.id)), ...exercises.filter((e) => !ids.has(e.id))];
  }, [exercises, stats]);

  const progressionData = useMemo(() => {
    if (!stats) return [];
    const base = stats.progression.map((p) => ({ week: p.week, "Szac. 1RM": p.e1rm, "Najcięższa seria": p.weight }));
    const pred = stats.prediction.map((p) => ({ week: p.week, Prognoza: p.predicted }));
    if (base.length && pred.length) (base[base.length - 1] as any).Prognoza = base[base.length - 1]["Szac. 1RM"];
    return [...base, ...pred];
  }, [stats]);

  const loadReport = () => {
    setError(null);
    trainingApi.report(from, to).then(setReport).catch((e) => setError(e.message));
  };

  if (!stats) return error ? <Page icon={BarChart3} title="Statystyki"><ErrorText>{error}</ErrorText></Page> : <Spinner text="Liczenie statystyk..." />;

  return (
    <Page icon={BarChart3}
      title="Statystyki i progresja"
      description="Dane liczone z zapisanych serii roboczych, testów i pomiarów."
      actions={
        <NativeSelect className="w-44" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          <option value={4}>Ostatnie 4 tyg.</option>
          <option value={12}>Ostatnie 12 tyg.</option>
          <option value={26}>Ostatnie 26 tyg.</option>
          <option value={52}>Ostatni rok</option>
        </NativeSelect>
      }
    >
      <ErrorText>{error}</ErrorText>

      <Card>
        <CardHeader>
          <CardTitle>Progresja siły i prognoza</CardTitle>
          <CardDescription>Szacowane 1RM (wzór Epleya) tydzień po tygodniu; prognoza na 4 tygodnie metodą regresji liniowej.</CardDescription>
          <ExercisePicker exercises={withData} value={exerciseId} onChange={setExerciseId} />
        </CardHeader>
        <CardContent className="h-72">
          {progressionData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={progressionData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="week" fontSize={12} />
                <YAxis fontSize={12} domain={["auto", "auto"]} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Szac. 1RM" stroke="var(--chart-1)" strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="Najcięższa seria" stroke="var(--chart-2)" strokeDasharray="4 4" connectNulls />
                <Line type="monotone" dataKey="Prognoza" stroke="var(--chart-3)" strokeDasharray="6 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground">Wybierz ćwiczenie, dla którego masz zapisane serie.</p>
          )}
        </CardContent>
        {exerciseId && (
          <CardContent className="pt-0 text-sm text-muted-foreground">
            Siła względna (1RM / masa ciała):{" "}
            <strong className="text-foreground">{stats.relativeStrength ?? "brak pomiaru masy ciała"}</strong>
            {stats.prediction.length === 0 && stats.progression.length > 0 && " · prognoza wymaga danych z min. 3 tygodni"}
          </CardContent>
        )}
      </Card>

      {exerciseId && stats.repRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rekordy powtórzeniowe</CardTitle>
            <CardDescription>Najcięższy ciężar podniesiony na co najmniej N powtórzeń w wybranym ćwiczeniu</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Powtórzenia</th><th className="py-1">Ciężar</th><th className="py-1">Data</th></tr></thead>
              <tbody>
                {groupRepRecords(stats.repRecords).map((r) => (
                  <tr key={r.from} className="border-t border-border">
                    <td className="py-1.5">{r.from === r.to ? r.from : `${r.from}–${r.to}`}</td>
                    <td className="py-1.5 font-medium">{fmtKg(r.weight)}</td>
                    <td className="py-1.5 text-muted-foreground">{fmtDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Obciążenie i regularność</CardTitle>
          <CardDescription>
            ACWR - stosunek objętości z ostatnich 7 dni do średniej tygodniowej z ostatnich 28 dni. Wartości
            0,8-1,3 oznaczają obciążenie zgodne z Twoim zwykłym poziomem; gwałtowny wzrost powyżej 1,5 bywa
            wiązany z większym ryzykiem przeciążenia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="ACWR" icon={Gauge} tone={stats.load.zone === "high" ? 3 : 0}
              value={<span className={stats.load.zone === "high" ? "text-destructive" : stats.load.zone === "elevated" ? "text-warning" : ""}>{stats.load.acwr ?? "–"}</span>} />
            <StatTile label="Tygodni z rzędu" icon={Flame} tone={1} value={stats.load.streak_weeks} />
            <StatTile label="Treningów / tydzień" icon={CalendarDays} tone={2}
              value={`${fmtNumber(stats.load.sessions_per_week_4w)}${stats.load.target_per_week ? ` / ${stats.load.target_per_week}` : ""}`} hint="średnio z 4 tygodni" />
            <StatTile label="Objętość 7 dni" icon={Weight} tone={0} value={fmtNumber(stats.load.acute_tonnage, 0)} unit="kg" />
          </div>
          <p className="text-sm">{stats.load.zone_text}</p>
          <div>
            <p className="mb-1 text-sm font-medium">Kalendarz treningów (26 tygodni)</p>
            <div className="overflow-x-auto">
              <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
                {(() => {
                  const map = new Map(stats.load.calendar.map((d) => [d.date, d]));
                  const max = Math.max(1, ...stats.load.calendar.map((d) => d.tonnage));
                  const start = new Date();
                  start.setDate(start.getDate() - 181 - ((start.getDay() + 6) % 7));
                  return Array.from({ length: 189 }, (_, i) => {
                    const d = new Date(start);
                    d.setDate(start.getDate() + i);
                    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    const day = map.get(iso);
                    const level = day ? 0.3 + 0.7 * (day.tonnage / max) : 0;
                    return (
                      <div key={iso} title={`${fmtDate(d)}${day ? `: ${plural(day.sessions, "trening", "treningi", "treningów")}, ${fmtNumber(day.tonnage, 0)} kg` : ""}`}
                        className="h-3 w-3 rounded-sm bg-muted" style={day ? { backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(Math.max(0.2, level) * 100)}%, transparent)` } : undefined} />
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Objętość tygodniowa</CardTitle>
            <CardDescription>Σ ciężar × powtórzenia [kg]</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {stats.weeklyTonnage.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.weeklyTonnage}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="week" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="tonnage" name="Objętość" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">Brak danych - zapisz pierwszy trening.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Objętość miesięczna</CardTitle>
            <CardDescription>Ostatnie 6 miesięcy [kg]</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {stats.monthlyTonnage.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.monthlyTonnage}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="tonnage" name="Objętość" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">Brak danych.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Rozkład partii (4 tyg.)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {stats.muscleSplit.length ? stats.muscleSplit.map((m) => (
              <div key={m.group} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{m.group}</span>
                  <span className="text-muted-foreground">{m.percent}% · {fmtKg(m.tonnage)}</span>
                </div>
                <Progress value={m.percent} />
              </div>
            )) : <p className="text-sm text-muted-foreground">Brak danych.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4" /> Aktualne 1RM</CardTitle>
            <CardDescription>Wynik testu ma pierwszeństwo przed szacunkiem z treningów</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.personalRecords.length ? stats.personalRecords.map((pr) => (
              <div key={pr.exercise_id} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
                <ExerciseName name={pr.exercise} />
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">{SOURCE[pr.source] ?? pr.source}</Badge>
                  <strong>{fmtKg(pr.e1rm)}</strong>
                </span>
              </div>
            )) : <p className="text-sm text-muted-foreground">Brak rekordów.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4" /> Bliskość upadku (RIR)</CardTitle>
          <CardDescription>
            RIR to liczba powtórzeń, które zostały w zapasie: 0 oznacza serię do upadku mięśniowego. Liczone z serii
            roboczych, przy których wpisano RIR lub RPE ({stats.effort.rated_sets} z {stats.effort.total_sets} serii).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats.effort.rated_sets === 0 ? (
            <p className="text-sm text-muted-foreground">
              Wpisuj RIR przy seriach w trakcie treningu, a zobaczysz tu, jak blisko upadku trenujesz.
            </p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile label="Średni RIR" icon={Gauge} tone={0} value={stats.effort.avg_rir} hint="powtórzenia w zapasie" />
                <StatTile label="Serie do upadku" icon={Flame} tone={1} value={`${stats.effort.to_failure_percent}%`} />
                <StatTile label="Ocenione serie" icon={ListChecks} tone={2} value={stats.effort.rated_sets} hint={`z ${stats.effort.total_sets} serii roboczych`} />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="h-52">
                  <p className="mb-1 text-sm font-medium">Rozkład serii według RIR</p>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={stats.effort.distribution}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="rir" fontSize={12} />
                      <YAxis fontSize={12} allowDecimals={false} />
                      <Tooltip formatter={(v, _n, item: any) => [`${v} serii (${item.payload.percent}%)`, "Liczba"]}
                        labelFormatter={(l) => `RIR ${l}`} />
                      <Bar dataKey="sets" name="Serie" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-52">
                  <p className="mb-1 text-sm font-medium">Średni RIR w kolejnych tygodniach</p>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={stats.effort.weekly}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="week" fontSize={12} />
                      <YAxis fontSize={12} domain={[0, "auto"]} allowDecimals={false} />
                      <Tooltip formatter={(v) => [v, "Średni RIR"]} />
                      <Line type="monotone" dataKey="avg_rir" stroke="var(--chart-1)" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <p className="font-medium">Średni RIR w najczęstszych ćwiczeniach</p>
                {stats.effort.by_exercise.map((e) => (
                  <div key={e.exercise} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
                    <span className="truncate" title={e.exercise}>{e.exercise.split(" / ")[0]}</span>
                    <span className="shrink-0 text-muted-foreground">RIR {e.avg_rir} · {e.sets} serii</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raport okresowy</CardTitle>
          <CardDescription>Realizacja planu, zmiana 1RM, objętość i pomiary w wybranym okresie (maks. 1 rok).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Od"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Do"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Button onClick={loadReport}>Pokaż</Button>
            <Button variant="outline" asChild>
              <a href={trainingApi.reportUrl(from, to, "pdf")}><FileDown className="mr-2 h-4 w-4" /> PDF</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={trainingApi.reportUrl(from, to, "csv")}><FileSpreadsheet className="mr-2 h-4 w-4" /> CSV</a>
            </Button>
          </div>
          {report && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {report.comparison.map((c, i) => (
                  <StatTile key={c.metric} label={c.metric} tone={i} value={fmtNumber(c.current)}
                    hint={<span className={(c.change_percent ?? 0) > 0 ? "text-primary" : (c.change_percent ?? 0) < 0 ? "text-destructive" : ""}>
                      {c.change_percent == null ? "brak porównania" : `${(c.change_percent ?? 0) > 0 ? "+" : ""}${c.change_percent}% vs poprzedni okres`}
                    </span>} />
                ))}
                <StatTile label="Realizacja planu" tone={3}
                  value={report.avg_plan_completion_percent != null ? `${report.avg_plan_completion_percent}%` : "–"}
                  hint={`regularność: ${report.adherence_percent ?? "–"}%`} />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="font-medium">Serie efektywne na partię tygodniowo</p>
                  {report.muscle_split.length === 0 && <p className="text-muted-foreground">Brak danych.</p>}
                  {report.muscle_split.map((m) => (
                    <div key={m.group} className="flex justify-between gap-2">
                      <span>{m.group}</span>
                      <span className="text-muted-foreground">{m.hard_sets_per_week} / tydz. · {m.sets} serii</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <p className="font-medium">Zmiana 1RM</p>
                  {report.progress.length === 0 && <p className="text-muted-foreground">Brak danych o 1RM w tym okresie.</p>}
                  {report.progress.slice(0, 8).map((p) => (
                    <div key={p.exercise} className="flex justify-between gap-2">
                      <span className="truncate">{p.exercise.split(" / ")[0]}{p.record ? " ★" : ""}</span>
                      <span className={p.change > 0 ? "text-primary" : ""}>{fmtNumber(p.start_1rm, 2)} → {fmtKg(p.best_1rm)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {report.rep_records.length > 0 && (
                <p>
                  <span className="font-medium">Rekordy powtórzeniowe w okresie: </span>
                  {report.rep_records.slice(0, 8).map((r) => `${r.exercise.split(" / ")[0]} ${fmtKg(r.weight)} × ${r.reps}`).join(" · ")}
                  {report.rep_records.length > 8 ? ` i ${report.rep_records.length - 8} więcej` : ""}
                </p>
              )}
              <details>
                <summary className="cursor-pointer font-medium">Treningi w okresie ({report.session_list.length})</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2">Data</th><th className="py-1 pr-2">Trening</th><th className="py-1 pr-2">Czas</th>
                      <th className="py-1 pr-2">Serie</th><th className="py-1 pr-2">Objętość</th><th className="py-1">Plan</th>
                    </tr></thead>
                    <tbody>
                      {report.session_list.map((s, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-1 pr-2">{s.date}</td><td className="py-1 pr-2">{s.name}</td>
                          <td className="py-1 pr-2">{s.duration_min ? `${s.duration_min} min` : "–"}</td>
                          <td className="py-1 pr-2">{s.sets}</td><td className="py-1 pr-2">{fmtKg(s.tonnage)}</td>
                          <td className="py-1">{s.completion_percent != null ? `${s.completion_percent}%` : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <p className="text-xs text-muted-foreground">
                Pełny raport z wykresami, celami i pomiarami pobierzesz jako PDF, a wszystkie dane jako CSV.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
