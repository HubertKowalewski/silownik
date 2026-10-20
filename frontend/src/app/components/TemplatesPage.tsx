// Tworzenie planu z gotowego szablonu albo automatycznie - na podstawie profilu i ankiety zdrowotnej.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { label, PlanTemplate, trainingApi, errorText } from "../../lib/api";
import { ErrorText, HeroCard, Page, Spinner } from "./common";
import { useMeta } from "../../lib/hooks";

type Created = Awaited<ReturnType<typeof trainingApi.createFromTemplate>>;

export function TemplatesPage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const [data, setData] = useState<{ templates: PlanTemplate[]; recommended: string; reason: string } | null>(null);
  const [adapt, setAdapt] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trainingApi.planTemplates().then(setData).catch((e) => setError(e.message));
  }, []);

  const create = async (key: string) => {
    setBusy(key);
    setError(null);
    try {
      setCreated(await trainingApi.createFromTemplate(key, adapt));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (created) {
    return (
      <Page icon={Sparkles} title="Plan utworzony" description={created.plan.title}>
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            {created.reason && <p><strong>Dlaczego ten szablon:</strong> {created.reason}</p>}
            {created.changes.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium">Dopasowanie do Twojego profilu:</p>
                {created.changes.map((c, i) => (
                  <p key={i} className="text-muted-foreground">
                    {c.day}: {c.from.split(" / ")[0]} → <strong className="text-foreground">{c.to.split(" / ")[0]}</strong> ({c.reason})
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">Szablon nie wymagał zmian dla Twojego profilu.</p>
            )}
            <p className="text-muted-foreground">
              Główne ćwiczenia mają obciążenie jako % 1RM - jeśli któreś jest oznaczone „kalibracja”, wykonaj
              ćwiczenie testowe albo wpisz 1RM. Pozostałe prowadzone są według RIR i zakresu powtórzeń.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => navigate(`/plany/${created.plan.id}`)}>Zobacz plan</Button>
              <Button variant="outline" onClick={() => navigate(`/plany/${created.plan.id}/edycja`)}>Dostosuj w edytorze</Button>
            </div>
          </CardContent>
        </Card>
      </Page>
    );
  }

  if (!data) return error ? <Page icon={Sparkles} title="Szablony"><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  return (
    <Page icon={Sparkles} title="Nowy plan z szablonu" description="Gotowe plany do natychmiastowego użycia - każdy możesz potem zmienić w edytorze.">
      <HeroCard title="Wygeneruj plan dla mnie" icon={Wand2}
        description={<>Na podstawie <Link className="underline" to="/profil">profilu</Link>: {data.reason}</>}>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5 border-brand-foreground data-[state=checked]:bg-brand-foreground data-[state=checked]:text-brand"
            checked={adapt} onCheckedChange={(v) => setAdapt(v === true)} />
          Podmieniaj ćwiczenia kolidujące z ograniczeniami z ankiety zdrowotnej lub wymagające sprzętu, którego nie masz
        </label>
        <Button onClick={() => create("auto")} disabled={!!busy}
          className="bg-none bg-brand-foreground text-brand shadow-none hover:bg-brand-foreground/90">
          {busy === "auto" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Wygeneruj
        </Button>
      </HeroCard>

      <ErrorText>{error}</ErrorText>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.templates.map((t) => (
          <Card key={t.key} className={t.key === data.recommended ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {t.title}
                {t.key === data.recommended && <Badge>polecany</Badge>}
              </CardTitle>
              <CardDescription>{t.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{label(meta?.goals, t.goal)}</Badge>
                <Badge variant="outline">{label(meta?.levels, t.level)}</Badge>
                <Badge variant="outline">{t.days_per_week} dni/tydz.</Badge>
                <Badge variant="outline">{t.duration_weeks} tyg.</Badge>
              </div>
              <p className="text-muted-foreground">{t.days.map((d) => `${d.name} (${d.exercises} ćw.)`).join(" · ")}</p>
              <Button size="sm" variant="outline" onClick={() => create(t.key)} disabled={!!busy}>
                {busy === t.key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Utwórz plan
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  );
}
