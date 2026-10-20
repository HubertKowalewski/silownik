// Zestawienie wyników ankiety SUS dla personelu (weryfikacja WN-10: średni wynik >= 70).
import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { SusSummary, trainingApi } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { SUS_QUESTIONS } from "./SusPage";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function SusSummaryCard() {
  const [data, setData] = useState<SusSummary | null>(null);
  useEffect(() => { trainingApi.susSummary().then(setData).catch(() => undefined); }, []);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4" /> Ankieta SUS (WN-10)</CardTitle>
        <CardDescription>
          {data.count === 0 ? "Brak odpowiedzi - poproś testerów o wypełnienie ankiety (Profil → Oceń aplikację)."
            : <>Odpowiedzi: {data.count} · średnia <strong>{data.mean}</strong>
              {data.stdev != null && ` ± ${data.stdev}`} · zakres {data.min}-{data.max}{" "}
              <Badge variant={data.target_met ? "default" : "destructive"}>
                {data.target_met ? `próg ${data.target} spełniony` : `poniżej progu ${data.target}`}
              </Badge></>}
        </CardDescription>
      </CardHeader>
      {data.count > 0 && (
        <CardContent className="space-y-3 text-sm">
          <details>
            <summary className="cursor-pointer font-medium">Średnie ocen pytań (1-5)</summary>
            <ol className="mt-2 space-y-1">
              {SUS_QUESTIONS.map((q, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{i + 1}. {q}</span><strong>{data.per_question[i]}</strong>
                </li>
              ))}
            </ol>
          </details>
          <details>
            <summary className="cursor-pointer font-medium">Odpowiedzi ({data.count})</summary>
            <ul className="mt-2 space-y-1">
              {data.responses.map((r) => (
                <li key={r.user}>
                  <strong>{r.score}</strong> · {r.user} · {fmtDateTime(r.date)}{r.comment && ` - „${r.comment}”`}
                </li>
              ))}
            </ul>
          </details>
        </CardContent>
      )}
    </Card>
  );
}
