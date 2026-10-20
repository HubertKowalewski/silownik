// Udostępniony trening na tablicy: kto, kiedy, co (czas, serie, objętość) i ćwiczenia z seriami roboczymi.
import { useState } from "react";
import { Link } from "react-router";
import { ChevronDown, Clock, Dumbbell, Layers, ThumbsUp, Weight } from "lucide-react";
import { FeedItem, trainingApi } from "../../../lib/api";
import { exerciseName, fmtAgo, fmtNumber } from "../../../lib/format";
import { Avatar } from "../Avatar";
import { fmtClock } from "../RestTimer";
import { Card, CardContent } from "../ui/card";
import { cn } from "../ui/utils";

const SHOWN = 4;

export function FeedCard({ item, showAuthor = true }: { item: FeedItem; showAuthor?: boolean }) {
  const [kudos, setKudos] = useState({ count: item.kudos, mine: item.my_kudos });
  const [expanded, setExpanded] = useState(false);
  const profile = `/uzytkownicy/${encodeURIComponent(item.user.username)}`;
  const exercises = expanded ? item.exercises : item.exercises.slice(0, SHOWN);

  const toggleKudos = async () => {
    const was = kudos;
    setKudos({ count: was.count + (was.mine ? -1 : 1), mine: !was.mine });   // od razu, bez czekania na serwer
    try {
      const r = was.mine ? await trainingApi.unkudos(item.id) : await trainingApi.kudos(item.id);
      setKudos({ count: r.kudos, mine: r.my_kudos });
    } catch {
      setKudos(was);
    }
  };

  return (
    <Card className="gap-0 overflow-hidden">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          {showAuthor && (
            <Link to={profile} className="shrink-0"><Avatar name={item.user.username} url={item.user.avatar_url} size="md" /></Link>
          )}
          <div className="min-w-0 flex-1">
            {showAuthor && <Link to={profile} className="block truncate font-semibold hover:underline">{item.user.username}</Link>}
            <p className="truncate text-xs text-muted-foreground">
              {fmtAgo(item.date)}{item.plan_title && item.plan_title !== item.title ? ` · ${item.plan_title}` : ""}
            </p>
          </div>
        </div>

        <h3 className="font-display text-xl font-bold leading-tight tracking-tight">{item.title}</h3>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { icon: Clock, label: "Czas", value: item.duration_seconds ? fmtClock(item.duration_seconds) : "–" },
            { icon: Layers, label: "Serie", value: String(item.sets) },
            { icon: Weight, label: "Objętość", value: `${fmtNumber(item.tonnage, 0)} kg` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-lg bg-muted/50 px-2 py-2">
              <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><Icon className="h-3 w-3" /> {label}</p>
              <p className="numeral mt-0.5 whitespace-nowrap text-lg">{value}</p>
            </div>
          ))}
        </div>

        <ul className="space-y-1.5">
          {exercises.map((e, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <Dumbbell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="font-medium">{exerciseName(e.name).pl}</span>
                <span className="block text-xs text-muted-foreground">{e.sets.join(", ")}</span>
              </span>
            </li>
          ))}
        </ul>
        {item.exercises.length > SHOWN && (
          <button type="button" onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-primary">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
            {expanded ? "Zwiń" : `Pokaż wszystkie ćwiczenia (${item.exercises.length})`}
          </button>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          {item.is_own ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ThumbsUp className="h-4 w-4" /> {kudos.count ? `${kudos.count} × brawo` : "Twój trening"}
            </span>
          ) : (
            <button type="button" onClick={toggleKudos} aria-pressed={kudos.mine}
              className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                kudos.mine ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <ThumbsUp className={cn("h-4 w-4", kudos.mine && "fill-current")} />
              Brawo{kudos.count > 0 ? ` · ${kudos.count}` : ""}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
