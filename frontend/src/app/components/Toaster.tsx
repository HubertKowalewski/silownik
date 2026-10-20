// Wyświetlanie powiadomień z lib/toast: nad dolnym paskiem na telefonie, w prawym dolnym rogu na komputerze.
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { onToast, Toast } from "../../lib/toast";
import { cn } from "./ui/utils";

const SHOW_MS = 3500;
const ICON = { success: CheckCircle2, info: Info, error: AlertCircle };

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => onToast((t) => {
    setItems((list) => [...list.slice(-2), t]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), SHOW_MS);
  }), []);
  if (!items.length) return null;
  return (
    <div aria-live="polite" role="status"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-sm flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4">
      {items.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div key={t.id} className="toast-in flex items-start gap-2 rounded-xl border border-border bg-card/95 p-3 text-sm shadow-lg backdrop-blur">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.kind === "error" ? "text-destructive" : "text-primary")} />
            <span>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
