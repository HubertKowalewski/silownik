// Ankieta użyteczności SUS (System Usability Scale, WN-10). Dziesięć stwierdzeń ocenianych w skali 1-5;
// wynik 0-100 liczy serwer. Odpowiedź można poprawić - liczy się ostatnia.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { errorText, SusResponse, trainingApi } from "../../lib/api";
import { ErrorText, Page, Spinner } from "./common";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Textarea } from "./ui/textarea";

export const SUS_QUESTIONS = [
  "Myślę, że chciał(a)bym często korzystać z tej aplikacji.",
  "Aplikacja wydała mi się niepotrzebnie skomplikowana.",
  "Aplikacja była łatwa w obsłudze.",
  "Myślę, że do korzystania z aplikacji potrzebował(a)bym pomocy osoby znającej się na technice.",
  "Funkcje aplikacji są dobrze ze sobą powiązane.",
  "W aplikacji jest zbyt wiele niespójności.",
  "Większość osób bardzo szybko nauczy się korzystać z tej aplikacji.",
  "Korzystanie z aplikacji było bardzo niewygodne.",
  "Czułem(-am) się pewnie, korzystając z aplikacji.",
  "Musiałem(-am) nauczyć się wielu rzeczy, zanim mogłem(-am) swobodnie korzystać z aplikacji.",
];
const SCALE = [1, 2, 3, 4, 5];

export function SusPage() {
  const [answers, setAnswers] = useState<(number | null)[]>(Array(10).fill(null));
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState<SusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trainingApi.sus()
      .then((r) => {
        if (r) { setSaved(r); setAnswers(r.answers); setComment(r.comment); }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const missing = answers.filter((a) => a === null).length;
  const submit = async () => {
    if (missing) return setError(`Odpowiedz na wszystkie pytania (brakuje: ${missing}).`);
    setBusy(true);
    setError(null);
    try {
      setSaved(await trainingApi.saveSus(answers as number[], comment));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  return (
    <Page icon={ClipboardCheck} title="Oceń aplikację"
      description="Krótka ankieta użyteczności (SUS) - 10 stwierdzeń, ok. 2 minuty. Wyniki służą do oceny aplikacji w pracy inżynierskiej.">
      {saved && (
        <p className="flex items-center gap-2 rounded-md bg-primary/10 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          <span>Dziękujemy! Twój wynik SUS: <strong>{saved.score}</strong> / 100. Możesz poprawić odpowiedzi i zapisać ponownie.</span>
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Na ile zgadzasz się z każdym stwierdzeniem?</CardTitle>
          <CardDescription>1 - zdecydowanie się nie zgadzam, 5 - zdecydowanie się zgadzam.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {SUS_QUESTIONS.map((q, i) => (
            <fieldset key={i} className="space-y-2 border-b border-border pb-3 last:border-0">
              <legend className="text-sm"><span className="mr-1 font-medium">{i + 1}.</span>{q}</legend>
              <div className="flex gap-2">
                {SCALE.map((v) => (
                  <Button key={v} type="button" size="sm" className="h-10 w-10" aria-label={`Pytanie ${i + 1}: ${v}`}
                    aria-pressed={answers[i] === v} variant={answers[i] === v ? "default" : "outline"}
                    onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}>
                    {v}
                  </Button>
                ))}
              </div>
            </fieldset>
          ))}
          <Textarea maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Uwagi (opcjonalnie): co było niejasne, czego brakowało?" />
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} disabled={busy}>{saved ? "Zapisz zmiany" : "Wyślij ankietę"}</Button>
            <Link className="text-sm text-muted-foreground underline" to="/profil">Wróć do profilu</Link>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
