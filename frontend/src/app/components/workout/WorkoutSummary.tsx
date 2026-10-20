// Ekran po zapisaniu treningu: serie, objętość, czas i nowe rekordy.
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Check, Clock, Dumbbell, TrendingUp, Trophy } from "lucide-react";
import { fmtKg, fmtNumber } from "../../../lib/format";
import { Page, StatTile } from "../common";
import { fmtClock } from "../RestTimer";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { shortName } from "./model";
import { Summary } from "./useWorkout";

export function WorkoutSummary({ summary, onNew }: { summary: Summary; onNew: () => void }) {
  const navigate = useNavigate();
  useEffect(() => window.scrollTo({ top: 0 }), []);  // zapis wywołano z dołu długiej strony
  return (
    <Page icon={Dumbbell} title={summary.edited ? "Zmiany zapisane" : "Trening zapisany"}>
      <Card>
        <CardContent className="space-y-4 pt-6">
          {summary.queued && (
            <p className="rounded-md bg-warning/10 p-3 text-sm">
              Brak połączenia - trening zapisano w urządzeniu i zostanie wysłany automatycznie. Rekordy
              zostaną przeliczone po synchronizacji.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <StatTile compact label="Serie" icon={Check} tone={0} value={summary.sets} />
            <StatTile compact label="Objętość" icon={Trophy} tone={1} value={fmtNumber(summary.tonnage, 0)} unit="kg" />
            <StatTile compact label="Czas" icon={Clock} tone={2} value={summary.duration ? fmtClock(summary.duration) : "–"} />
          </div>
          {summary.records.length > 0 && (
            <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="flex items-center gap-2 font-medium"><Trophy className="h-4 w-4 text-primary" /> Nowe rekordy 1RM</p>
              {summary.records.map((r) => (
                <p key={r.exercise_id} className="text-sm">
                  {shortName(r.exercise)}: {fmtNumber(r.previous, 2)} → <strong>{fmtKg(r.current)}</strong> (+{fmtKg(r.current - r.previous, 1)})
                </p>
              ))}
            </div>
          )}
          {summary.repRecords.length > 0 && (
            <div className="space-y-1 rounded-md border border-border p-3">
              <p className="flex items-center gap-2 font-medium"><TrendingUp className="h-4 w-4 text-primary" /> Rekordy powtórzeniowe</p>
              {summary.repRecords.map((r) => (
                <p key={`${r.exercise_id}-${r.reps}`} className="text-sm">
                  {shortName(r.exercise)}: <strong>{fmtKg(r.weight)} × {r.reps}</strong>
                  {r.previous ? ` (poprzednio ${fmtKg(r.previous)})` : ""}
                </p>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button size="lg" onClick={() => navigate("/")}>Gotowe - wróć na pulpit</Button>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="outline" onClick={() => navigate("/historia")}>Historia</Button>
              <Button variant="outline" onClick={onNew}>Nowy trening</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
