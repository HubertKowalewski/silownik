// Panel moderatora (WF-22): zgłoszone plany i komentarze, decyzje oraz blokada kont.
// Widoczny tylko dla kont personelu (is_staff) - backend dodatkowo sprawdza uprawnienia.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Ban, CheckCircle2, EyeOff, Flag, MessageSquare, RotateCcw, ShieldCheck, UserCheck } from "lucide-react";
import { errorText, ModerationDecision, ModerationReport, trainingApi } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { ErrorText, Page, Spinner, StatTile } from "./common";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { SusSummaryCard } from "./SusSummaryCard";

type Tab = "open" | "closed";

const DECISION_LABEL: Record<string, string> = {
  hidden: "treść ukryta", dismissed: "zgłoszenie odrzucone", restored: "treść przywrócona",
};

function ReportCard({ r, tab, onDone }: { r: ModerationReport; tab: Tab; onDone: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ detail: string }>) => {
    setBusy(true);
    setError(null);
    try {
      onDone((await action()).detail);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const decide = (d: ModerationDecision) => run(() => trainingApi.moderationDecide(r.id, d, note));
  const block = () => {
    if (r.author_blocked || confirm(`Zablokować konto ${r.author}? Jego publiczne plany i komentarze zostaną ukryte.`)) {
      void run(() => trainingApi.moderationBlock(r.author_id, !r.author_blocked));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {r.kind === "plan" ? <Flag className="h-4 w-4 text-destructive" /> : <MessageSquare className="h-4 w-4 text-destructive" />}
              {r.kind === "plan" ? "Plan" : "Komentarz"}: <Link className="truncate underline" to={`/plany/${r.plan_id}`}>{r.title}</Link>
            </CardTitle>
            <CardDescription>
              autor: <Link className="underline" to={`/uzytkownicy/${r.author}`}>{r.author}</Link>
              {r.author_blocked && " (konto zablokowane)"} · zgłosił {r.reporter}, {fmtDateTime(r.created_at)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1">
            {r.reports_count > 1 && <Badge variant="destructive">{r.reports_count} zgłoszenia</Badge>}
            {r.is_hidden && <Badge variant="outline">ukryte</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p><span className="font-medium">Powód: </span>{r.reason}</p>
        {r.content && (
          <blockquote className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border-l-4 border-border bg-muted/40 p-2 text-muted-foreground">
            {r.content}
          </blockquote>
        )}
        {tab === "closed" && (
          <p className="text-muted-foreground">
            Decyzja: <strong className="text-foreground">{DECISION_LABEL[r.decision] ?? "-"}</strong>
            {r.resolved_by && ` · ${r.resolved_by}`}{r.resolved_at && `, ${fmtDateTime(r.resolved_at)}`}
            {r.moderator_note && ` · „${r.moderator_note}”`}
          </p>
        )}
        {tab === "open" && (
          <Input placeholder="Uzasadnienie dla autora (opcjonalnie)" maxLength={300} value={note}
            onChange={(e) => setNote(e.target.value)} />
        )}
        <div className="flex flex-wrap gap-2">
          {tab === "open" && (
            <>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide("hidden")}>
                <EyeOff className="mr-1 h-4 w-4" /> Ukryj treść
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("dismissed")}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Odrzuć zgłoszenie
              </Button>
            </>
          )}
          {tab === "closed" && r.is_hidden && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("restored")}>
              <RotateCcw className="mr-1 h-4 w-4" /> Przywróć treść
            </Button>
          )}
          {!r.author_is_staff && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={block}>
              {r.author_blocked ? <><UserCheck className="mr-1 h-4 w-4" /> Odblokuj autora</> : <><Ban className="mr-1 h-4 w-4" /> Zablokuj autora</>}
            </Button>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
      </CardContent>
    </Card>
  );
}

export function ModerationPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [reports, setReports] = useState<ModerationReport[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    trainingApi.moderationReports(tab)
      .then((d) => { setReports(d.reports); setOpenCount(d.open_count); })
      .catch((e) => setError(errorText(e)));
  }, [tab]);
  useEffect(() => { setReports(null); load(); }, [load]);

  const done = (msg: string) => { setMessage(msg); load(); };
  const plans = reports?.filter((r) => r.kind === "plan").length ?? 0;

  return (
    <Page icon={ShieldCheck} title="Moderacja"
      description="Zgłoszone plany i komentarze. Decyzja dotyczy wszystkich zgłoszeń tej samej treści, a autor i zgłaszający dostają powiadomienie.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Sprawy do rozpatrzenia" icon={Flag} tone={0} value={openCount} />
        <StatTile label={tab === "open" ? "Zgłoszone plany" : "Rozpatrzone plany"} icon={EyeOff} tone={1} value={plans} />
        <StatTile label={tab === "open" ? "Zgłoszone komentarze" : "Rozpatrzone komentarze"} icon={MessageSquare} tone={2}
          value={(reports?.length ?? 0) - plans} />
      </div>
      <div className="flex gap-2">
        <Button variant={tab === "open" ? "default" : "outline"} onClick={() => setTab("open")}>Do rozpatrzenia</Button>
        <Button variant={tab === "closed" ? "default" : "outline"} onClick={() => setTab("closed")}>Rozpatrzone</Button>
      </div>
      {message && <p className="rounded-md bg-primary/10 p-3 text-sm">{message}</p>}
      <ErrorText>{error}</ErrorText>
      {reports === null && !error && <Spinner />}
      {reports?.length === 0 && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">
          {tab === "open" ? "Brak zgłoszeń do rozpatrzenia." : "Nie rozpatrzono jeszcze żadnych zgłoszeń."}
        </CardContent></Card>
      )}
      {reports?.map((r) => <ReportCard key={r.id} r={r} tab={tab} onDone={done} />)}
      <SusSummaryCard />
    </Page>
  );
}
