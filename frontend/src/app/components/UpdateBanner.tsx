// Informacja o nowej wersji aplikacji po wdrożeniu. Serwer podaje w /api/health/ nazwę pliku
// startowego frontendu (z hashem); gdy różni się od wczytanej, proponujemy odświeżenie.
// Trening w toku jest zapisany w urządzeniu, więc odświeżenie niczego nie traci.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

const CHECK_EVERY_MS = 30 * 60 * 1000;

function loadedVersion(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script ? script.src.split("/static/dist/")[1] ?? null : null;
}

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const current = loadedVersion();
    if (!import.meta.env.PROD || !current) return;
    const check = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const res = await fetch("/api/health/", { cache: "no-store" });
        const { version } = await res.json();
        if (version && version !== current) setAvailable(true);
      } catch {
        /* offline lub serwer niedostępny - sprawdzimy później */
      }
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!available) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 mx-auto md:bottom-3 flex max-w-md items-center gap-3 rounded-xl border border-primary/40 bg-card p-3 text-sm shadow-lg">
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">Dostępna jest nowa wersja aplikacji.</span>
      <Button size="sm" onClick={() => window.location.reload()}>Odśwież</Button>
      <Button size="sm" variant="ghost" onClick={() => setAvailable(false)}>Później</Button>
    </div>
  );
}
