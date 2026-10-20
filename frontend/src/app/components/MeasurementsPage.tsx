// Pomiary parametrów fizycznych (WF-28) i ćwiczenia testowe (WF-27, WF-18).
// Zapisy działają także bez połączenia - trafiają do kolejki offline (WN-03).
import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Ruler, Save, Trash2 } from "lucide-react";
import { Exercise, Goal, Measurement, OneRepMaxRecord, StrengthTest, trainingApi, uuid, errorText } from "../../lib/api";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";
import { saveOrQueue, SaveResult } from "../../lib/offline";
import { brzycki, epley, lombardi, percentTable } from "../../lib/oneRepMax";
import { ErrorText, ExercisePicker, Field, NativeSelect, Page, StatTile } from "./common";
import { exerciseName, fmtDate, fmtKg, fmtNumber, numOrNull } from "../../lib/format";
import { useMeta, useExercises } from "../../lib/hooks";
import { ExerciseName } from "./ExerciseName";
import { toast } from "../../lib/toast";

const FIELDS: { key: keyof Measurement; label: string; unit: string }[] = [
  { key: "body_weight", label: "Masa ciała", unit: "kg" },
  { key: "resting_hr", label: "Tętno spoczynkowe", unit: "ud./min" },
  { key: "chest", label: "Klatka piersiowa", unit: "cm" },
  { key: "waist", label: "Talia", unit: "cm" },
  { key: "hips", label: "Biodra", unit: "cm" },
  { key: "arm", label: "Ramię", unit: "cm" },
  { key: "thigh", label: "Udo", unit: "cm" },
];

const REPS_FOR: Record<string, number | null> = { "1rm": 1, "3rm": 3, "5rm": 5, amrap: null };
const SOURCE: Record<string, string> = { test: "test", manual: "wpis ręczny", estimate: "z treningów" };
const r1 = (v: number) => Math.round(v * 10) / 10;

function Goals({ exercises }: { exercises: Exercise[] }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [form, setForm] = useState({ exercise: null as number | null, target: "", deadline: "" });
  const [error, setError] = useState<string | null>(null);
  const load = () => trainingApi.goals().then(setGoals).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async () => {
    const target = numOrNull(form.target);
    if (!form.exercise || !target) return setError("Wybierz ćwiczenie i podaj docelowe 1RM.");
    try {
      await trainingApi.createGoal({ exercise: form.exercise, target_1rm: target, deadline: form.deadline || null });
      setForm({ exercise: null, target: "", deadline: "" });
      setError(null);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Nowy cel</CardTitle>
          <CardDescription>Np. „wyciskanie leżąc 100 kg”. Postęp liczony jest od Twojego obecnego 1RM, a data osiągnięcia z trendu ostatnich tygodni.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-4">
            <ExercisePicker exercises={exercises} value={form.exercise} onChange={(id) => setForm({ ...form, exercise: id })} />
          </div>
          <Field label="Docelowe 1RM [kg]">
            <Input type="number" inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </Field>
          <Field label="Termin (opcjonalnie)">
            <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </Field>
          <div className="flex items-end"><Button onClick={add}><Save className="mr-2 h-4 w-4" /> Dodaj cel</Button></div>
          <div className="md:col-span-4"><ErrorText>{error}</ErrorText></div>
        </CardContent>
      </Card>
      {goals.length === 0 && <p className="text-sm text-muted-foreground">Nie masz jeszcze celów.</p>}
      {goals.map((g) => (
        <Card key={g.id}>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{g.exercise_name.split(" / ")[0]}: {fmtKg(g.target_1rm)}{g.achieved_at ? " ✓" : ""}</p>
                <p className="text-xs text-muted-foreground">
                  start {fmtKg(g.start_1rm)} · teraz {fmtKg(g.status.current_1rm)}{g.deadline ? ` · termin ${fmtDate(g.deadline)}` : ""}
                </p>
              </div>
              <Button size="icon" variant="ghost" aria-label="Usuń cel" onClick={() => trainingApi.deleteGoal(g.id).then(load)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Progress value={g.status.progress_percent} />
            <p className="text-sm">
              {g.status.progress_percent}% · {g.status.message}
              {g.status.on_track === false && <span className="text-warning"> Przy obecnym tempie termin nie zostanie dotrzymany.</span>}
              {g.status.on_track === true && <span className="text-primary"> Termin jest realny.</span>}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Calculator({ increment }: { increment: number }) {
  const [w, setW] = useState("100");
  const [r, setR] = useState("5");
  const weight = numOrNull(w) ?? 0, reps = numOrNull(r) ?? 0;
  const valid = weight > 0 && reps >= 1 && reps <= 36;
  const values = valid ? [epley(weight, reps), brzycki(weight, reps), lombardi(weight, reps)] : [];
  const oneRm = valid ? r1(epley(weight, reps)) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Kalkulator 1RM</CardTitle>
        <CardDescription>
          Wpisz ciężar i liczbę powtórzeń wykonanej serii. Aplikacja używa wzoru Epleya; dla porównania
          pokazano też wzory Brzyckiego i Lombardiego. Estymacja jest najdokładniejsza do 10 powtórzeń.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Ciężar [kg]"><Input className="w-32" type="number" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} /></Field>
          <Field label="Powtórzenia"><Input className="w-32" type="number" inputMode="numeric" min={1} max={36} value={r} onChange={(e) => setR(e.target.value)} /></Field>
        </div>
        {valid && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile label="Epley" tone={0} value={`${fmtKg(r1(values[0]))}`} hint="używany w aplikacji" />
              <StatTile label="Brzycki" tone={1} value={`${fmtKg(r1(values[1]))}`} />
              <StatTile label="Lombardi" tone={2} value={`${fmtKg(r1(values[2]))}`} />
            </div>
            {reps > 10 && <p className="text-sm text-warning">Powyżej 10 powtórzeń wynik jest mało dokładny.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1">% 1RM</th><th className="py-1">Ciężar</th><th className="py-1">Ok. powtórzeń</th></tr></thead>
                <tbody>
                  {percentTable(oneRm, increment).map((p) => (
                    <tr key={p.percent} className="border-t border-border">
                      <td className="py-1">{p.percent}%</td><td className="py-1 font-medium">{fmtKg(p.weight)}</td><td className="py-1">{p.reps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pt-1 text-xs text-muted-foreground">Ciężary zaokrąglone w dół do {fmtKg(increment)} (ustawienie w profilu).</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MeasurementsPage() {
  const meta = useMeta();
  const exercises = useExercises();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [records, setRecords] = useState<OneRepMaxRecord[]>([]);
  const [increment, setIncrement] = useState(2.5);
  const [form, setForm] = useState<Record<string, string>>({});
  const [test, setTest] = useState({ exercise: null as number | null, protocol: "3rm", weight: "", reps: "3" });
  const [manual, setManual] = useState({ exercise: null as number | null, value: "" });
  const setMsg = (text: string | null) => text && toast(text, text.includes("w urządzeniu") ? "info" : "success");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    trainingApi.measurements().then(setMeasurements).catch(() => {});
    trainingApi.tests().then(setTests).catch(() => {});
    trainingApi.records().then(setRecords).catch(() => {});
  };
  useEffect(() => {
    trainingApi.profile().then((p) => setIncrement(p.load_increment)).catch(() => {});
    load();
  }, []);

  const info = ({ status }: SaveResult, what: string) => {
    setError(null);
    setMsg(status === "sent" ? `${what} zapisano.` : `${what} zapisano w urządzeniu - zostanie wysłany po odzyskaniu połączenia.`);
  };

  const saveMeasurement = async () => {
    const payload: Measurement = {
      client_uuid: uuid(),
      measured_at: new Date().toISOString(),
      body_weight: null, chest: null, waist: null, hips: null, arm: null, thigh: null, resting_hr: null,
    };
    FIELDS.forEach((f) => ((payload as any)[f.key] = numOrNull(form[f.key] ?? "")));
    try {
      info(await saveOrQueue("measurement", payload), "Pomiar");
      setForm({});
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const saveTest = async () => {
    if (!test.exercise) return setError("Wybierz ćwiczenie.");
    const payload: StrengthTest = {
      client_uuid: uuid(),
      exercise: test.exercise,
      protocol: test.protocol,
      weight: numOrNull(test.weight) ?? 0,
      reps: Number(test.reps),
      performed_at: new Date().toISOString(),
    };
    try {
      info(await saveOrQueue("test", payload), "Wynik testu");
      setTest({ ...test, weight: "" });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const saveManual = async () => {
    const value = numOrNull(manual.value);
    if (!manual.exercise || !value) return setError("Wybierz ćwiczenie i podaj wartość 1RM.");
    try {
      await trainingApi.setOneRepMax(manual.exercise, value);
      setMsg("Zapisano 1RM. Plany z pozycjami wymagającymi kalibracji możesz teraz przeliczyć.");
      setManual({ exercise: null, value: "" });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const chartData = [...measurements].reverse().map((m) => ({
    date: m.measured_at ? fmtDate(m.measured_at) : "",
    "Masa ciała": m.body_weight,
    Talia: m.waist,
    "Tętno spocz.": m.resting_hr,
  }));

  return (
    <Page icon={Ruler} title="1RM i pomiary" description="Twoje 1RM, kalkulator, ćwiczenia testowe i pomiary ciała.">
      <ErrorText>{error}</ErrorText>

      <Tabs defaultValue="records">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="records">Moje 1RM</TabsTrigger>
          <TabsTrigger value="calculator">Kalkulator</TabsTrigger>
          <TabsTrigger value="goals">Cele</TabsTrigger>
          <TabsTrigger value="tests">Testy</TabsTrigger>
          <TabsTrigger value="measurements">Pomiary ciała</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Aktualne 1RM</CardTitle>
              <CardDescription>
                Liczone automatycznie po każdym treningu. Wynik testu lub wpis ręczny jest punktem odniesienia;
                późniejsze treningi mogą go podnieść. Usunięcie treningu lub testu cofa wynikający z niego rekord.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {records.length === 0 && <p className="text-sm text-muted-foreground">Brak danych - zapisz trening lub wykonaj test.</p>}
              {records.map((r) => (
                <div key={r.exercise_id} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
                  <ExerciseName name={r.exercise} />
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{SOURCE[r.source] ?? r.source}</span>
                    <strong>{fmtKg(r.value)}</strong>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calculator"><Calculator increment={increment} /></TabsContent>
        <TabsContent value="goals"><Goals exercises={exercises} /></TabsContent>

        <TabsContent value="measurements" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Nowy pomiar</CardTitle>
              <CardDescription>Wypełnij dowolne pola - puste zostaną pominięte.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {FIELDS.map((f) => (
                  <Field key={f.key} label={`${f.label} [${f.unit}]`}>
                    <Input type="number" inputMode="decimal" step="0.1" value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <Button onClick={saveMeasurement}><Save className="mr-2 h-4 w-4" /> Zapisz pomiar</Button>
            </CardContent>
          </Card>

          {chartData.length > 1 && (
            <Card>
              <CardHeader><CardTitle>Zmiany w czasie</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="Masa ciała" stroke="var(--chart-1)" strokeWidth={2} connectNulls />
                    <Line type="monotone" dataKey="Talia" stroke="var(--chart-2)" strokeWidth={2} connectNulls />
                    <Line type="monotone" dataKey="Tętno spocz." stroke="var(--chart-3)" strokeWidth={2} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Historia pomiarów</CardTitle></CardHeader>
            <CardContent>
              {measurements.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak pomiarów.</p>
              ) : (
                <>
                  {/* telefon: karta na pomiar, tylko wypełnione pola */}
                  <ul className="divide-y divide-border md:hidden">
                    {measurements.map((m) => (
                      <li key={m.id} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="text-sm font-medium">{m.measured_at ? fmtDate(m.measured_at) : ""}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {FIELDS.filter((f) => (m as any)[f.key] != null).map((f) => (
                              <Badge key={f.key} variant="secondary" className="font-normal">
                                {f.label}: <strong className="ml-1">{fmtNumber((m as any)[f.key], 1)} {f.unit}</strong>
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Button size="icon" variant="ghost" aria-label="Usuń pomiar"
                          onClick={() => m.id && trainingApi.deleteMeasurement(m.id).then(load)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-3">Data</th>
                          {FIELDS.map((f) => <th key={f.key} className="py-1 pr-3 font-medium">{f.label} <span className="font-normal">[{f.unit}]</span></th>)}
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {measurements.map((m) => (
                          <tr key={m.id} className="border-t border-border">
                            <td className="py-1 pr-3">{m.measured_at ? fmtDate(m.measured_at) : ""}</td>
                            {FIELDS.map((f) => <td key={f.key} className="py-1 pr-3 tabular-nums">{(m as any)[f.key] != null ? fmtNumber((m as any)[f.key], 1) : "–"}</td>)}
                            <td>
                              <Button size="icon" variant="ghost" aria-label="Usuń pomiar"
                                onClick={() => m.id && trainingApi.deleteMeasurement(m.id).then(load)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Wynik ćwiczenia testowego</CardTitle>
              <CardDescription>
                Test wyznacza Twoje 1RM i ma pierwszeństwo przed szacunkiem z treningów. Na jego podstawie
                przeliczane są obciążenia w planach wyrażone jako % 1RM.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="md:col-span-4">
                <Field label="Ćwiczenie">
                  <ExercisePicker exercises={exercises} value={test.exercise}
                    onChange={(id) => setTest({ ...test, exercise: id })} />
                </Field>
              </div>
              <Field label="Protokół">
                <NativeSelect value={test.protocol}
                  onChange={(e) => setTest({ ...test, protocol: e.target.value, reps: String(REPS_FOR[e.target.value] ?? test.reps) })}>
                  {meta?.test_protocols.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Ciężar [kg]" hint="0 = masa własnego ciała">
                <Input type="number" inputMode="decimal" step="0.5" value={test.weight}
                  onChange={(e) => setTest({ ...test, weight: e.target.value })} />
              </Field>
              <Field label="Powtórzenia">
                <Input type="number" min={1} value={test.reps} disabled={REPS_FOR[test.protocol] !== null}
                  onChange={(e) => setTest({ ...test, reps: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button onClick={saveTest}><Save className="mr-2 h-4 w-4" /> Zapisz wynik</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Znam swoje 1RM</CardTitle>
              <CardDescription>Jeśli nie chcesz wykonywać testu, możesz wprowadzić wartość ręcznie.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <ExercisePicker exercises={exercises} value={manual.exercise}
                  onChange={(id) => setManual({ ...manual, exercise: id })} />
              </div>
              <Input type="number" placeholder="1RM [kg]" value={manual.value}
                onChange={(e) => setManual({ ...manual, value: e.target.value })} />
              <Button variant="outline" onClick={saveManual}>Zapisz 1RM</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Historia testów</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {tests.length === 0 && <p className="text-sm text-muted-foreground">Brak testów.</p>}
              {tests.map((t) => (
                <div key={t.id} className="flex items-start gap-2 border-b border-border py-2 text-sm last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{exerciseName(t.exercise_name).pl}</span>
                      {t.estimated_1rm ? <strong className="shrink-0 whitespace-nowrap text-primary">1RM {fmtKg(t.estimated_1rm)}</strong> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t.performed_at ? fmtDate(t.performed_at) : ""} · {t.protocol_name}:{" "}
                      {t.weight > 0 ? `${fmtKg(t.weight)} × ${t.reps}` : `${t.reps} powt.`}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" className="-mt-1" aria-label="Usuń test"
                    onClick={() => t.id && trainingApi.deleteTest(t.id).then(load)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
