// Asystent tworzenia planu: 1) wybór podziału treningowego, 2) wybór ćwiczeń z podpowiedzi dla każdej
// części jednostki. Nic nie jest narzucone - można wybrać inną propozycję, dowolne ćwiczenie z bazy,
// pominąć część albo dodać własne ćwiczenie. Utworzony plan otwiera się w zwykłym edytorze.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, Loader2, Plus, ShieldCheck, Wand2, X } from "lucide-react";
import {
  AssistantSlot, AssistantSplit, AssistantSuggestion, errorText, label, PlanDay, Profile, trainingApi,
} from "../../lib/api";
import { useExercises, useMeta } from "../../lib/hooks";
import { ErrorText, ExercisePicker, Field, HeroCard, Page, Spinner } from "./common";
import { fmtClock } from "./RestTimer";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

type SlotState = AssistantSlot & { chosen: number | null; expanded: boolean; picking: boolean; custom?: boolean };
type DayState = { name: string; slots: SlotState[] };

const VISIBLE = 3;
const short = (name: string) => name.split(" / ")[0];
const prescription = (s: AssistantSlot) =>
  `${s.sets}×${s.reps_min}${s.reps_max !== s.reps_min ? `-${s.reps_max}` : ""} · RIR ${s.rir} · przerwa ${fmtClock(s.rest)}`;

export function PlanAssistantPage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const exercises = useExercises();
  const [splits, setSplits] = useState<{ recommended: string; reason: string; splits: AssistantSplit[] } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [suggestion, setSuggestion] = useState<AssistantSuggestion | null>(null);
  const [days, setDays] = useState<DayState[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trainingApi.planAssistant().then(setSplits).catch((e) => setError(errorText(e)));
    trainingApi.profile().then(setProfile).catch(() => undefined);
  }, []);

  const names = useMemo(() => new Map(exercises.map((e) => [e.id, e.name])), [exercises]);

  const choose = async (split: AssistantSplit) => {
    setLoading(split.key);
    setError(null);
    try {
      const s = await trainingApi.planAssistantSuggest(split.key);
      setSuggestion(s);
      setTitle(`${s.name} - mój plan`);
      setDays(s.days.map((d) => ({
        name: d.name,
        slots: d.slots.map((slot) => ({ ...slot, chosen: slot.default, expanded: false, picking: false })),
      })));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(null);
    }
  };

  const patch = (di: number, si: number, p: Partial<SlotState>) =>
    setDays((ds) => ds.map((d, i) => (i !== di ? d : { ...d, slots: d.slots.map((s, j) => (j === si ? { ...s, ...p } : s)) })));
  const removeSlot = (di: number, si: number) =>
    setDays((ds) => ds.map((d, i) => (i !== di ? d : { ...d, slots: d.slots.filter((_, j) => j !== si) })));
  const addCustom = (di: number, exerciseId: number) =>
    setDays((ds) => ds.map((d, i) => (i !== di ? d : {
      ...d,
      slots: [...d.slots, {
        key: `${d.name}-custom-${Date.now()}`, label: "Twoje ćwiczenie", hint: "dodane samodzielnie", kind: "accessory",
        sets: 3, reps_min: 10, reps_max: 12, rir: 2, rest: 90, enabled: true, optional: true, default: exerciseId,
        candidates: [], chosen: exerciseId, expanded: false, picking: false, custom: true,
      }],
    })));

  const create = async () => {
    setError(null);
    if (title.trim().length < 3) return setError("Podaj nazwę planu (min. 3 znaki).");
    const planDays: PlanDay[] = days.map((d, order) => ({
      week: 1, order, name: d.name,
      exercises: d.slots.filter((s) => s.enabled && s.chosen).map((s, i) => ({
        exercise: s.chosen!, order: i, target_sets: s.sets, target_reps: s.reps_min,
        target_reps_max: s.reps_max !== s.reps_min ? s.reps_max : null, target_rir: s.rir,
        // obciążenie według docelowego RPE (= 10 - RIR) - nie wymaga znajomości 1RM; ciężar podpowie progresja
        load_type: "rpe" as const, load_value: 10 - s.rir, rest_seconds: s.rest, notes: "",
      })),
    })).filter((d) => d.exercises.length);
    if (!planDays.length) return setError("Wybierz co najmniej jedno ćwiczenie.");
    const used = new Set(planDays.flatMap((d) => d.exercises.map((e) => exercises.find((x) => x.id === e.exercise)?.equipment ?? "")));
    setSaving(true);
    try {
      const plan = await trainingApi.createPlan({
        title: title.trim(), is_public: false,
        description: `Plan utworzony z asystentem: ${suggestion?.name}. Ćwiczenia wybrane spośród propozycji dopasowanych do profilu.`,
        goal: profile?.goal ?? "general", level: profile?.level ?? "beginner",
        days_per_week: Math.max(planDays.length, Math.min(profile?.days_per_week ?? planDays.length, 7)),
        duration_weeks: 8, required_equipment: [...used].filter(Boolean), days: planDays,
      });
      navigate(`/plany/${plan.id}/edycja`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  if (!splits) return error ? <Page icon={Wand2} title="Asystent planu"><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  // --- krok 1: wybór podziału -------------------------------------------------------
  if (!suggestion) {
    return (
      <Page icon={Wand2} title="Asystent planu" description="Krok 1 z 2: wybierz podział treningowy.">
        <HeroCard title="Polecany dla Ciebie" icon={Wand2} description={splits.reason}>
          <p className="text-sm">
            Podział wynika z liczby dni treningowych i poziomu w <Link className="underline" to="/profil">profilu</Link>.
            Możesz wybrać dowolny inny.
          </p>
        </HeroCard>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {splits.splits.map((s) => (
            <Card key={s.key} className={s.key === splits.recommended ? "border-primary/60" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {s.name} {s.key === splits.recommended && <Badge>polecany</Badge>}
                </CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {s.days.map((d) => <Badge key={d} variant="outline">{d}</Badge>)}
                </div>
                <Button onClick={() => choose(s)} disabled={loading !== null}>
                  {loading === s.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                  Dobierz ćwiczenia
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
      </Page>
    );
  }

  // --- krok 2: wybór ćwiczeń -------------------------------------------------------------
  const selected = days.reduce((n, d) => n + d.slots.filter((s) => s.enabled && s.chosen).length, 0);
  return (
    <Page icon={Wand2} title={suggestion.name}
      description="Krok 2 z 2: wybierz ćwiczenia. Pierwsza propozycja jest zaznaczona - zmień ją, wybierz inne ćwiczenie z bazy albo pomiń część."
      actions={<Button variant="ghost" onClick={() => setSuggestion(null)}><ArrowLeft className="mr-2 h-4 w-4" /> Zmień podział</Button>}>
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Nazwa planu">
            <Input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <p className="text-xs text-muted-foreground md:max-w-xs">
            Cel: {label(meta?.goals, suggestion.goal)} - od niego zależą serie i powtórzenia. Wszystko zmienisz w edytorze po utworzeniu planu.
          </p>
          {suggestion.health_filtered && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground md:col-span-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              Pominięto ćwiczenia obciążające obszary zgłoszone w ankiecie zdrowotnej.
            </p>
          )}
        </CardContent>
      </Card>

      {days.map((day, di) => {
        const chosenIds = day.slots.filter((s) => s.enabled && s.chosen).map((s) => s.chosen);
        return (
          <Card key={day.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{day.name}</CardTitle>
              <CardDescription>{day.slots.filter((s) => s.enabled && s.chosen).length} ćwiczeń w jednostce</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {day.slots.map((s, si) => {
                const duplicate = s.enabled && s.chosen && chosenIds.filter((id) => id === s.chosen).length > 1;
                const visible = s.expanded ? s.candidates : s.candidates.slice(0, VISIBLE);
                const chosenOutside = s.chosen && !s.candidates.some((c) => c.id === s.chosen);
                return (
                  <div key={s.key} className={`space-y-2 rounded-lg border p-3 ${s.enabled ? "border-border" : "border-dashed border-border opacity-60"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex min-w-0 cursor-pointer items-start gap-2">
                        <input type="checkbox" className="mt-1 h-4 w-4" checked={s.enabled}
                          onChange={(e) => patch(di, si, { enabled: e.target.checked })} aria-label={`Uwzględnij: ${s.label}`} />
                        <span className="min-w-0">
                          <span className="font-medium">{s.label}</span>
                          {s.optional && !s.custom && <span className="ml-1 text-xs text-muted-foreground">(opcjonalnie)</span>}
                          <span className="block text-xs text-muted-foreground">{s.hint} · {prescription(s)}</span>
                        </span>
                      </label>
                      {s.custom && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Usuń" onClick={() => removeSlot(di, si)}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {s.enabled && (
                      <>
                        {s.candidates.length === 0 && !s.custom && (
                          <p className="flex items-center gap-1 text-xs text-warning">
                            <AlertTriangle className="h-3.5 w-3.5" /> Brak pasujących ćwiczeń dla Twojego profilu - wybierz inne z bazy albo pomiń.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {visible.map((c) => (
                            <Button key={c.id} size="sm" variant={s.chosen === c.id ? "default" : "outline"}
                              className="h-auto max-w-full whitespace-normal px-2.5 py-1.5 text-left text-xs"
                              aria-pressed={s.chosen === c.id} onClick={() => patch(di, si, { chosen: c.id })}>
                              {s.chosen === c.id && <Check className="mr-1 h-3.5 w-3.5 shrink-0" />}
                              <span>
                                {short(c.name)}
                                <span className="block text-[10px] opacity-75">
                                  {[label(meta?.equipment, c.equipment), ...c.tags].join(" · ")}
                                </span>
                              </span>
                            </Button>
                          ))}
                          {chosenOutside && (
                            <Badge className="h-auto px-2.5 py-1.5"><Check className="mr-1 h-3.5 w-3.5" />{short(names.get(s.chosen!) ?? "")}</Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {s.candidates.length > VISIBLE && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => patch(di, si, { expanded: !s.expanded })}>
                              {s.expanded ? <><ChevronUp className="mr-1 h-3.5 w-3.5" /> mniej</> : <><ChevronDown className="mr-1 h-3.5 w-3.5" /> więcej propozycji</>}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => patch(di, si, { picking: !s.picking })}>
                            inne ćwiczenie z bazy…
                          </Button>
                        </div>
                        {s.picking && (
                          <ExercisePicker exercises={exercises} value={chosenOutside ? s.chosen : null}
                            onChange={(id) => patch(di, si, { chosen: id, picking: false })} />
                        )}
                        {duplicate && <p className="text-xs text-warning">To ćwiczenie jest już w tej jednostce.</p>}
                      </>
                    )}
                  </div>
                );
              })}
              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="mb-2 flex items-center gap-1 text-sm font-medium"><Plus className="h-4 w-4" /> Dodaj własne ćwiczenie</p>
                <ExercisePicker exercises={exercises} value={null} onChange={(id) => addCustom(di, id)} />
              </div>
            </CardContent>
          </Card>
        );
      })}

      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={create} disabled={saving || selected === 0}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Utwórz plan ({selected} ćw.)
        </Button>
        <span className="text-xs text-muted-foreground">Plan otworzy się w edytorze - tam zmienisz serie, powtórzenia i przerwy.</span>
      </div>
    </Page>
  );
}
