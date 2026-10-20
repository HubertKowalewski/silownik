// Komunikat przy wolnej odpowiedzi serwera - zwykle po dłuższej przerwie, gdy darmowy hosting
// wybudza uśpioną aplikację (do ok. minuty). Znika sam, gdy serwer odpowie.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { onServerSlow } from "../../lib/api";

export function ServerWakeBanner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => onServerSlow(setSlow), []);
  if (!slow || !navigator.onLine) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[60] mx-auto flex max-w-sm items-start gap-3 rounded-xl border border-primary/30 bg-card/95 p-3 text-sm shadow-lg backdrop-blur">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
      <div>
        <p className="font-medium">Łączę z serwerem…</p>
        <p className="text-xs text-muted-foreground">Po dłuższej przerwie serwer się wybudza - to może potrwać do minuty. Nic nie musisz robić.</p>
      </div>
    </div>
  );
}
