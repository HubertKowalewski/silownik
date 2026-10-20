// Pulpit: następny trening z planu, liczby z bieżącego miesiąca i tygodnia, ostatnie treningi,
// objętość z ostatnich tygodni i propozycja ciężaru. Wszystkie wartości pochodzą z /api/dashboard/.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { CalendarDays, ChevronRight, Dumbbell, Home, ListChecks, Loader2, Play, TrendingUp, Weight } from "lucide-react";
import { api } from "../../lib/api";
import { fmtKg, fmtNumber, plural } from "../../lib/format";
import { useAuth } from "./AuthProvider";
import { HeroCard, Page, StatTile } from "./common";
import { InstallCard } from "./InstallCard";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";

type Dashboard = {
  monthlyWorkouts: number;
  totalWorkouts: number;
  monthlyTonnage: number;
  currentPlan: { id?: number; name: string; weeklyWorkouts: number; completed: number; nextDay?: { id: number; name: string } | null; rotation?: boolean };
  recentSessions: { id: number; date: string; name: string; note: string }[];
  smartSuggestion: { exercise: string; weight: number; basedOn: string; oneRm?: number } | null;
  progressData: { week: string; weight: number }[];
};

const MONTHS_LOCATIVE = [
  "w styczniu", "w lutym", "w marcu", "w kwietniu", "w maju", "w czerwcu",
  "w lipcu", "w sierpniu", "we wrześniu", "w październiku", "w listopadzie", "w grudniu",
];

function rhythm(workouts: number) {
  if (workouts === 0) return "Pierwszy trening w tym miesiącu jeszcze przed Tobą";
  if (workouts < 4) return "Dobry początek - trzymaj rytm";
  if (workouts < 8) return "Regularnie, tak trzymaj";
  return "Bardzo regularny miesiąc";
}

export function GymDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get<Dashboard>("/api/dashboard/").then(setData).catch(() => setFailed(true));
  }, []);

  const plan = data?.currentPlan;
  const hasPlan = !!plan?.id;
  const remaining = plan ? Math.max(0, plan.weeklyWorkouts - plan.completed) : 0;
  const weeks = (data?.progressData ?? []).filter((w) => w.week && !w.week.startsWith("Tydz."));
  const last = weeks.at(-1)?.weight ?? 0;
  const previous = weeks.at(-2)?.weight ?? 0;
  const change = previous > 0 ? Math.round(((last - previous) / previous) * 100) : null;
  const today = new Date();

  const startPlan = () => navigate(hasPlan
    ? `/trening?plan=${plan!.id}${plan!.nextDay ? `&day=${plan!.nextDay.id}` : ""}`
    : "/plany/utworz");

  return (
    <Page icon={Home} title={user ? `Cześć, ${user.first_name || user.username}` : "Pulpit"}
      description={today.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}>
      {!data ? (
        // wczytywanie (np. serwer wybudza się po przerwie) - bez mylącego „Zacznij od planu”
        <HeroCard icon={Dumbbell} title="Gotowy na trening?"
          description={failed
            ? "Nie udało się wczytać pulpitu - sprawdź połączenie. Trening możesz zapisać także offline."
            : <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Wczytuję Twój plan…</span>}>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="lg" onClick={() => navigate("/trening")} className="bg-none bg-brand-foreground text-brand shadow-none hover:bg-brand-foreground/90">
              <Play className="mr-2 h-4 w-4" /> Przejdź do treningu
            </Button>
          </div>
        </HeroCard>
      ) : (
        <HeroCard icon={Dumbbell}
          title={hasPlan && plan?.nextDay ? `Dziś: ${plan.nextDay.name}` : hasPlan ? "Czas na trening" : "Zacznij od planu"}
          description={hasPlan
            ? plan!.rotation
              ? <>Kolejny z Twoich treningów - ten robiłeś najdawniej. Ciężary podpowie progresja z ostatnich treningów.</>
              : <>Plan „{plan!.name}”. Ciężary podpowie progresja z ostatnich treningów.</>
            : <>Ułóż plan z pomocnikiem albo wybierz gotowy szablon. Możesz też trenować bez planu.</>}>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="lg" onClick={startPlan} className="bg-none bg-brand-foreground text-brand shadow-none hover:bg-brand-foreground/90">
              <Play className="mr-2 h-4 w-4" />
              {hasPlan ? (plan?.nextDay ? `Zacznij: ${plan.nextDay.name}` : "Zacznij trening") : "Utwórz plan"}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => navigate("/trening")}
              className="text-brand-foreground hover:bg-brand-foreground/10 hover:text-brand-foreground">
              Trening bez planu
            </Button>
          </div>
        </HeroCard>
      )}

      <InstallCard />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile icon={CalendarDays} label={`Treningi ${MONTHS_LOCATIVE[today.getMonth()]}`}
          value={data?.monthlyWorkouts ?? "–"} hint={data ? rhythm(data.monthlyWorkouts) : undefined} />
        <StatTile icon={Weight} label="Objętość w tym miesiącu"
          value={data ? fmtNumber(data.monthlyTonnage, 0) : "–"} unit={data ? "kg" : undefined}
          hint="suma ciężar × powtórzenia w seriach roboczych" />
        <div className="tile-gradient rounded-xl border border-border p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><ListChecks className="h-3.5 w-3.5" /> Plan na ten tydzień</div>
          <div className="numeral mt-2 text-[2rem] md:text-[2.4rem]">
            {plan ? <>{plan.completed}<span className="text-muted-foreground">/{plan.weeklyWorkouts}</span></> : "–"}
          </div>
          <Progress className="mt-3 h-2" value={plan?.weeklyWorkouts ? (plan.completed / plan.weeklyWorkouts) * 100 : 0}
            aria-label="Realizacja planu w tym tygodniu" />
          <p className="mt-2 text-xs text-muted-foreground">
            {!hasPlan ? "Brak aktywnego planu" : remaining ? `Zostało: ${plural(remaining, "trening", "treningi", "treningów")}` : "Tydzień zrealizowany"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Ostatnie treningi</CardTitle>
              <CardDescription>{data ? plural(data.totalWorkouts, "trening", "treningi", "treningów") + " od początku" : ""}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {data && data.recentSessions.length === 0 && (
              <div className="space-y-3 py-4">
                <p className="text-sm text-muted-foreground">Tu pojawią się zapisane treningi.</p>
                <Button size="sm" onClick={() => navigate("/trening")}><Play className="mr-2 h-4 w-4" /> Zapisz pierwszy trening</Button>
              </div>
            )}
            <ul className="divide-y divide-border">
              {data?.recentSessions.map((s) => {
                const d = new Date(s.date);
                return (
                  <li key={s.id}>
                    <Link to="/historia" className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 hover:bg-muted">
                      <span className="w-11 shrink-0 text-center">
                        <span className="numeral block text-2xl">{d.getDate()}</span>
                        <span className="block text-[11px] text-muted-foreground">{d.toLocaleDateString("pl-PL", { month: "short" })}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        {s.note && <span className="block truncate text-xs text-muted-foreground">{s.note}</span>}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Objętość tygodniowa</CardTitle>
              <CardDescription>
                {weeks.length === 0 ? "Wykres pojawi się po pierwszych treningach."
                  : change === null ? "Ostatnie tygodnie"
                  : <span className="inline-flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" />
                      {change >= 0 ? "+" : ""}{change}% względem poprzedniego tygodnia</span>}
              </CardDescription>
            </CardHeader>
            {weeks.length > 0 && (
              <CardContent>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={weeks} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <XAxis dataKey="week" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number) => [`${fmtNumber(v, 0)} kg`, "Objętość"]} cursor={{ fill: "var(--muted)" }} />
                    <Bar dataKey="weight" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Propozycja na dziś</CardTitle>
              <CardDescription>Ciężar roboczy w ostatnio wykonywanym ćwiczeniu.</CardDescription>
            </CardHeader>
            <CardContent>
              {data?.smartSuggestion ? (
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{data.smartSuggestion.exercise.split(" / ")[0]}</p>
                    <p className="text-xs text-muted-foreground">
                      80% Twojego 1RM ({data.smartSuggestion.oneRm != null ? fmtKg(data.smartSuggestion.oneRm) : data.smartSuggestion.basedOn})
                    </p>
                  </div>
                  <p className="numeral shrink-0 text-4xl text-primary">{fmtNumber(data.smartSuggestion.weight, 2)}<span className="ml-1 text-lg text-muted-foreground">kg</span></p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Po pierwszym treningu aplikacja wyznaczy Twoje 1RM i zaproponuje ciężar.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => navigate("/pomiary")}>Wpisz znane 1RM</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Page>
  );
}
