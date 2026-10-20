// Lista planów: polecane wg profilu (WF-14), społeczność z filtrami (WF-13), moje plany.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { AlertTriangle, GitFork, Globe, ListChecks, Lock, MessageSquare, Plus, Sparkles, Users, Wand2 } from "lucide-react";
import { label, Meta, trainingApi, WorkoutPlan } from "../../lib/api";
import { ErrorText, NativeSelect, Page, Spinner } from "./common";
import { useMeta } from "../../lib/hooks";

type Scope = "recommended" | "public" | "mine";

export function PlanCard({ plan, meta }: { plan: WorkoutPlan; meta: Meta | null }) {
  return (
    <Link to={`/plany/${plan.id}`} className="block">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {plan.title}
              {plan.is_public ? <Globe className="h-4 w-4 text-muted-foreground" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
            </CardTitle>
            <CardDescription>
              autor: {plan.creator_name} · {plan.days_per_week} dni/tydz. · {plan.duration_weeks} tyg. ·{" "}
              {plan.exercise_count} ćwiczeń
              {plan.parent_title ? ` · kopia planu „${plan.parent_title}”` : ""}
            </CardDescription>
            <div className="flex flex-wrap gap-1 pt-1">
              <Badge variant="outline">{label(meta?.goals, plan.goal)}</Badge>
              <Badge variant="outline">{label(meta?.levels, plan.level)}</Badge>
              {plan.required_equipment.map((e) => <Badge key={e} variant="secondary">{label(meta?.equipment, e)}</Badge>)}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 text-sm">
            {plan.match_score !== undefined && (
              <Badge className="text-sm" title={plan.match_reasons?.join("; ")}>
                <Sparkles className="mr-1 h-3 w-3" /> {plan.match_score}% zgodności
              </Badge>
            )}
            {!!plan.health_warnings && (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> {plan.health_warnings} ostrzeż.
              </span>
            )}
            <span className="flex gap-3 text-muted-foreground">
              <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5" /> {plan.fork_count}</span>
              <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {plan.comment_count}</span>
            </span>
          </div>
        </CardHeader>
        {plan.description && (
          <CardContent className="line-clamp-2 pt-0 text-sm text-muted-foreground">{plan.description}</CardContent>
        )}
      </Card>
    </Link>
  );
}

export function PlansPage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const [scope, setScope] = useState<Scope>("recommended");
  const [search, setSearch] = useState("");
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState("");
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    if (goal) params.goal = goal;
    if (level) params.level = level;
    const req = scope === "recommended" ? trainingApi.recommended() : trainingApi.plans({ scope, ...params });
    req
      .then((list) =>
        setPlans(
          scope === "recommended"
            ? list.filter((p) =>
                (!params.search || p.title.toLowerCase().includes(params.search.toLowerCase())) &&
                (!goal || p.goal === goal) && (!level || p.level === level))
            : list,
        ),
      )
      .catch((e) => setError(e?.message ?? "Nie udało się pobrać planów."))
      .finally(() => setLoading(false));
  }, [scope, search, goal, level]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <Page icon={ListChecks}
      title="Plany treningowe"
      description="Plany dopasowane do Twojego profilu. Sklonowany plan przelicza obciążenia na Twoje 1RM."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/plany/asystent")}><Wand2 className="mr-2 h-4 w-4" /> Z pomocnikiem</Button>
          <Button onClick={() => navigate("/plany/utworz")}><Plus className="mr-2 h-4 w-4" /> Nowy plan</Button>
        </div>
      }
    >
      <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="recommended"><Sparkles className="mr-1 h-4 w-4 sm:mr-2" /> Polecane</TabsTrigger>
          <TabsTrigger value="public"><Users className="mr-1 h-4 w-4 sm:mr-2" /> Społeczność</TabsTrigger>
          <TabsTrigger value="mine"><Lock className="mr-1 h-4 w-4 sm:mr-2" /> Moje</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <Input className="md:col-span-2" placeholder="Szukaj planu..." value={search} maxLength={100}
          onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Cel">
          <option value="">Każdy cel</option>
          {meta?.goals.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Poziom">
          <option value="">Każdy poziom</option>
          {meta?.levels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
      </div>

      {scope === "recommended" && (
        <p className="text-xs text-muted-foreground">
          Zgodność liczona na podstawie poziomu, liczby dni, sprzętu i celu z <Link className="underline" to="/profil">profilu</Link>.
          Ostrzeżenia dotyczą ograniczeń z ankiety zdrowotnej.
        </p>
      )}

      <ErrorText>{error}</ErrorText>
      {loading ? (
        <Spinner text="Ładowanie planów..." />
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {scope === "mine" ? "Nie masz jeszcze planów - utwórz własny albo sklonuj plan ze społeczności." : "Brak planów do wyświetlenia."}
        </p>
      ) : (
        <div className="space-y-3">{plans.map((p) => <PlanCard key={p.id} plan={p} meta={meta} />)}</div>
      )}
    </Page>
  );
}
