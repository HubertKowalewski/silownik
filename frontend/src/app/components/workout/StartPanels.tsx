// Panele pomocnicze ekranu treningu: wybór jednostki z planu, ręczna przerwa, licznik czasu.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Zap } from "lucide-react";
import { WorkoutPlan } from "../../../lib/api";
import { plural } from "../../../lib/format";
import { HeroCard } from "../common";
import { fmtClock, REST_PRESETS } from "../RestTimer";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";

export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono tabular-nums">{fmtClock((now - Date.parse(since)) / 1000)}</span>;
}

export function PlanDayPicker({ plans, onPick }: { plans: WorkoutPlan[]; onPick: (plan: WorkoutPlan, dayId: number | null) => void }) {
  // plany z jedną jednostką (np. osobne treningi Push / Pull / Upper / Lower) jako kafelki w kolejności utworzenia
  const singles = plans.filter((p) => p.days.length === 1).sort((a, b) => a.id - b.id);
  const multi = plans.filter((p) => p.days.length > 1);
  return (
    <HeroCard title="Gotowy na trening?" icon={Zap}
      description={<>Wybierz, co dziś trenujesz, albo <Link className="underline" to="/historia">powtórz trening z historii</Link>.</>}>
      {singles.length > 0 && (
        <div className="space-y-2">
          {multi.length > 0 && <p className="text-sm font-medium">Twoje treningi</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {singles.map((p) => (
              <Button key={p.id} size="lg" onClick={() => onPick(p, p.days[0].id ?? null)}
                className="h-auto flex-col items-start gap-0.5 whitespace-normal bg-none bg-brand-foreground px-3 py-2.5 text-left text-brand shadow-none hover:bg-brand-foreground/90">
                <span className="font-semibold">{p.title}</span>
                <span className="text-xs font-normal opacity-75">{plural(p.days[0].exercises.length, "ćwiczenie", "ćwiczenia", "ćwiczeń")}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {multi.length > 0 && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {multi.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg bg-brand-foreground/10 p-3">
              <strong className="text-sm">{p.title}</strong>
              <div className="flex flex-wrap gap-1">
                {p.days.map((d) => (
                  <Button key={d.id} size="sm" onClick={() => onPick(p, d.id ?? null)}
                    className="bg-none bg-brand-foreground text-brand shadow-none hover:bg-brand-foreground/90">
                    {p.days.some((x) => x.week !== 1) ? `T${d.week} ` : ""}{d.name}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {plans.length === 0 && (
        <p className="text-sm">
          Nie masz jeszcze planu - <Link className="underline" to="/plany/utworz">utwórz go z pomocnikiem lub z szablonu</Link> albo trenuj bez planu poniżej.
        </p>
      )}
    </HeroCard>
  );
}

export function ManualRest({ defaultSeconds, onStart }: { defaultSeconds: number; onStart: (seconds: number) => void }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <p className="text-sm text-muted-foreground">Uruchom przerwę ręcznie:</p>
        <div className="flex flex-wrap gap-2">
          {REST_PRESETS.map((sec) => (
            <Button key={sec} size="sm" variant={sec === defaultSeconds ? "default" : "outline"} onClick={() => onStart(sec)}>
              {fmtClock(sec)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Domyślną przerwę, krok zmiany, dźwięk i wibrację ustawisz w <Link className="underline" to="/profil">profilu</Link>.
        </p>
      </CardContent>
    </Card>
  );
}
