// Wybór sposobu tworzenia planu: samodzielnie, z asystentem albo z gotowego szablonu.
import { Link } from "react-router";
import { ChevronRight, LayoutTemplate, PenLine, Sparkles, Wand2 } from "lucide-react";
import { Page } from "./common";
import { Card, CardContent } from "./ui/card";

const OPTIONS = [
  {
    to: "/plany/asystent", icon: Wand2, title: "Z pomocnikiem",
    text: "Wybierasz podział (Full Body, Upper/Lower, Push/Pull/Legs, Push/Pull), a asystent podpowiada ćwiczenia "
      + "do każdej części treningu. Ty decydujesz, które wziąć - propozycje uwzględniają Twój sprzęt, historię i ankietę zdrowotną.",
    badge: "polecane na start",
  },
  {
    to: "/plany/nowy", icon: PenLine, title: "Własny plan",
    text: "Pusty kreator: sam dodajesz jednostki, ćwiczenia, serie, zakres powtórzeń, obciążenie i przerwy.",
  },
  {
    to: "/plany/szablony", icon: LayoutTemplate, title: "Gotowy szablon",
    text: "Sprawdzony plan (FBW, góra/dół, PPL, 5×5, trening w domu) tworzony jednym kliknięciem i dopasowany do profilu.",
  },
];

export function PlanCreatePage() {
  return (
    <Page icon={Sparkles} title="Nowy plan" description="Jak chcesz utworzyć plan? Każdy plan możesz później dowolnie edytować.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {OPTIONS.map(({ to, icon: Icon, title, text, badge }) => (
          <Link key={to} to={to} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/60">
              <CardContent className="flex h-full flex-col gap-3 pt-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold">{title}</p>
                    {badge && <p className="text-xs text-primary">{badge}</p>}
                  </div>
                </div>
                <p className="flex-1 text-sm text-muted-foreground">{text}</p>
                <span className="flex items-center gap-1 text-sm font-medium text-primary">
                  Wybierz <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </Page>
  );
}
