// Kreator planu: plan -> tydzień -> jednostka treningowa -> pozycja (WF-08 - WF-12).
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import { ArrowDown, ArrowUp, Copy, PenLine, Plus, Save, Trash2 } from "lucide-react";
import { LoadType, PlanDay, PlanExercise, trainingApi, WorkoutPlan, errorText } from "../../lib/api";
import { ErrorText, ExercisePicker, Field, NativeSelect, Page, Spinner } from "./common";
import { useMeta, useExercises } from "../../lib/hooks";

type Draft = Omit<WorkoutPlan, "id" | "creator_name" | "parent_plan" | "parent_title" | "parent_creator" |
  "created_at" | "updated_at" | "fork_count" | "exercise_count" | "comment_count" | "is_owner">;

const LOAD_DEFAULTS: Record<LoadType, number> = { percent: 75, rpe: 8, kg: 20 };

// gotowe zakresy: [etykieta, powt. od, powt. do, docelowy RIR, przerwa]
const PRESETS: [string, number, number, number, number][] = [
  ["Siła 3-5", 3, 5, 2, 180], ["Siła 5-8", 5, 8, 2, 150], ["Masa 8-12", 8, 12, 2, 90], ["Wytrzymałość 15-20", 15, 20, 3, 60],
];

const newItem = (order: number): PlanExercise => ({
  exercise: 0, order, target_sets: 3, target_reps: 8, load_type: "percent", load_value: 75, rest_seconds: 120, notes: "",
});
const newDay = (order: number, week = 1): PlanDay => ({ week, order, name: `Dzień ${String.fromCharCode(65 + order)}`, exercises: [newItem(0)] });

const empty: Draft = {
  title: "", description: "", is_public: false, goal: "strength", level: "beginner", days_per_week: 3,
  duration_weeks: 8, required_equipment: [], share_progress_with_author: false, days: [newDay(0)],
};

export function PlanEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meta = useMeta();
  const exercises = useExercises();
  const [plan, setPlan] = useState<Draft | null>(id ? null : empty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) {
      trainingApi.plan(Number(id)).then((p) => {
        if (!p.is_owner) return navigate(`/plany/${id}`, { replace: true });
        setPlan({ ...p, days: p.days.length ? p.days : [newDay(0)] });
      }).catch((e) => setError(e.message));
    }
  }, [id, navigate]);

  if (!plan) return error ? <Page icon={PenLine} title="Plan"><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  const set = (patch: Partial<Draft>) => setPlan({ ...plan, ...patch });
  const setDay = (di: number, patch: Partial<PlanDay>) =>
    set({ days: plan.days.map((d, i) => (i === di ? { ...d, ...patch } : d)) });
  const setItem = (di: number, ii: number, patch: Partial<PlanExercise>) =>
    setDay(di, { exercises: plan.days[di].exercises.map((e, i) => (i === ii ? { ...e, ...patch } : e)) });
  const moveItem = (di: number, ii: number, dir: -1 | 1) => {
    const list = [...plan.days[di].exercises];
    const j = ii + dir;
    if (j < 0 || j >= list.length) return;
    [list[ii], list[j]] = [list[j], list[ii]];
    setDay(di, { exercises: list });
  };
  const toggleEquipment = (v: string) =>
    set({ required_equipment: plan.required_equipment.includes(v) ? plan.required_equipment.filter((x) => x !== v) : [...plan.required_equipment, v] });

  const save = async () => {
    setError(null);
    const days = plan.days.map((d, di) => ({
      ...d,
      order: di,
      exercises: d.exercises.filter((e) => e.exercise).map((e, i) => ({ ...e, order: i })),
    })).filter((d) => d.exercises.length);
    if (plan.title.trim().length < 3) return setError("Podaj nazwę planu (min. 3 znaki).");
    if (!days.length) return setError("Dodaj co najmniej jedno ćwiczenie.");
    setSaving(true);
    try {
      const payload = { ...plan, days };
      const saved = id ? await trainingApi.updatePlan(Number(id), payload) : await trainingApi.createPlan(payload);
      navigate(`/plany/${saved.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page icon={PenLine} title={id ? "Edycja planu" : "Nowy plan"} description="Obciążenie możesz podać jako % 1RM, docelowe RPE albo w kilogramach.">
      <Card>
        <CardHeader><CardTitle>Informacje o planie</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="md:col-span-4">
            <Field label="Nazwa planu">
              <Input value={plan.title} maxLength={150} onChange={(e) => set({ title: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-4">
            <Field label="Opis">
              <Textarea value={plan.description} maxLength={3000} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </div>
          <Field label="Cel">
            <NativeSelect value={plan.goal} onChange={(e) => set({ goal: e.target.value })}>
              {meta?.goals.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Poziom">
            <NativeSelect value={plan.level} onChange={(e) => set({ level: e.target.value })}>
              {meta?.levels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Dni w tygodniu">
            <Input type="number" min={1} max={7} value={plan.days_per_week}
              onChange={(e) => set({ days_per_week: Number(e.target.value) })} />
          </Field>
          <Field label="Czas trwania [tyg.]">
            <Input type="number" min={1} max={52} value={plan.duration_weeks}
              onChange={(e) => set({ duration_weeks: Number(e.target.value) })} />
          </Field>
          <div className="md:col-span-4">
            <span className="text-sm font-medium">Wymagany sprzęt</span>
            <div className="mt-2 flex flex-wrap gap-3">
              {meta?.equipment.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={plan.required_equipment.includes(o.value)} onCheckedChange={() => toggleEquipment(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-4">
            <Switch checked={plan.is_public} onCheckedChange={(v) => set({ is_public: v })} />
            Plan publiczny - widoczny dla społeczności, można go klonować i zadawać pytania
          </label>
        </CardContent>
      </Card>

      {plan.days.map((day, di) => (
        <Card key={di}>
          <CardHeader className="flex flex-row flex-wrap items-center gap-2">
            <Input className="max-w-56" value={day.name} maxLength={100} aria-label="Nazwa jednostki"
              onChange={(e) => setDay(di, { name: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              Tydzień
              <Input className="w-20" type="number" min={1} max={52} value={day.week}
                onChange={(e) => setDay(di, { week: Number(e.target.value) })} />
            </label>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="sm" onClick={() =>
                set({ days: [...plan.days, { ...structuredClone(day), id: undefined, name: `${day.name} (kopia)`,
                  exercises: day.exercises.map((e) => ({ ...e, id: undefined })) }] })}>
                <Copy className="mr-1 h-4 w-4" /> Duplikuj
              </Button>
              <Button variant="ghost" size="icon" aria-label="Usuń jednostkę" disabled={plan.days.length === 1}
                onClick={() => set({ days: plan.days.filter((_, i) => i !== di) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {day.exercises.map((item, ii) => (
              <div key={ii} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex gap-1">
                  <div className="min-w-0 flex-1">
                    <ExercisePicker exercises={exercises} value={item.exercise || null}
                      onChange={(ex) => setItem(di, ii, { exercise: ex })} />
                  </div>
                  <Button variant="ghost" size="icon" aria-label="W górę" onClick={() => moveItem(di, ii, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label="W dół" onClick={() => moveItem(di, ii, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label="Usuń ćwiczenie"
                    onClick={() => setDay(di, { exercises: day.exercises.filter((_, i) => i !== ii) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {PRESETS.map(([label, lo, hi, rir, rest]) => (
                    <Button key={label} size="sm" type="button" className="h-7 px-2 text-xs"
                      variant={item.target_reps === lo && item.target_reps_max === hi ? "default" : "outline"}
                      onClick={() => setItem(di, ii, { target_reps: lo, target_reps_max: hi, target_rir: rir, rest_seconds: rest })}>
                      {label}
                    </Button>
                  ))}
                  {plan.days.length > 1 && (
                    <NativeSelect className="ml-auto h-7 w-auto text-xs" value="" aria-label="Kopiuj do innej jednostki"
                      onChange={(e) => {
                        const target = Number(e.target.value);
                        const copy = { ...item, id: undefined };
                        set({ days: plan.days.map((d, i) => (i === target
                          ? { ...d, exercises: [...d.exercises, { ...copy, order: d.exercises.length }] } : d)) });
                      }}>
                      <option value="" disabled>Kopiuj do…</option>
                      {plan.days.map((d, i) => i !== di && <option key={i} value={i}>{d.name}</option>)}
                    </NativeSelect>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-8">
                  <Field label="Serie">
                    <Input type="number" min={1} max={20} value={item.target_sets}
                      onChange={(e) => setItem(di, ii, { target_sets: Number(e.target.value) })} />
                  </Field>
                  <Field label="Powtórzenia od">
                    <Input type="number" min={1} max={100} value={item.target_reps}
                      onChange={(e) => setItem(di, ii, { target_reps: Number(e.target.value) })} />
                  </Field>
                  <Field label="do (opcjonalnie)">
                    <Input type="number" min={item.target_reps} max={100} placeholder="–" value={item.target_reps_max ?? ""}
                      onChange={(e) => setItem(di, ii, { target_reps_max: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                  <Field label="Docelowy RIR">
                    <Input type="number" min={0} max={10} placeholder="–" value={item.target_rir ?? ""}
                      onChange={(e) => setItem(di, ii, { target_rir: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                  <Field label="Obciążenie jako">
                    <NativeSelect value={item.load_type}
                      onChange={(e) => {
                        const t = e.target.value as LoadType;
                        setItem(di, ii, { load_type: t, load_value: LOAD_DEFAULTS[t] });
                      }}>
                      {meta?.load_types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </NativeSelect>
                  </Field>
                  <Field label={item.load_type === "percent" ? "% 1RM" : item.load_type === "rpe" ? "RPE" : "kg"}>
                    <Input type="number" step={item.load_type === "rpe" ? 0.5 : item.load_type === "kg" ? 0.5 : 1}
                      value={item.load_value} onChange={(e) => setItem(di, ii, { load_value: Number(e.target.value) })} />
                  </Field>
                  <Field label="Przerwa [s]">
                    <Input type="number" min={0} max={900} step={15} value={item.rest_seconds}
                      onChange={(e) => setItem(di, ii, { rest_seconds: Number(e.target.value) })} />
                  </Field>
                  <Field label="Uwagi">
                    <Input value={item.notes} maxLength={300} onChange={(e) => setItem(di, ii, { notes: e.target.value })} />
                  </Field>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDay(di, { exercises: [...day.exercises, newItem(day.exercises.length)] })}>
              <Plus className="mr-1 h-4 w-4" /> Dodaj ćwiczenie
            </Button>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Zakres powtórzeń (np. 8-10) włącza podwójną progresję: gdy we wszystkich seriach dojdziesz do górnej granicy,
        a zapas powtórzeń nie będzie mniejszy od docelowego RIR, aplikacja zaproponuje wyższy ciężar.
      </p>
      <Button variant="outline" onClick={() => set({ days: [...plan.days, newDay(plan.days.length, plan.days.at(-1)?.week ?? 1)] })}>
        <Plus className="mr-2 h-4 w-4" /> Dodaj jednostkę treningową
      </Button>

      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" /> Zapisz plan</Button>
        <Button variant="ghost" onClick={() => navigate(-1)}>Anuluj</Button>
      </div>
    </Page>
  );
}
