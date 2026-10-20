// Instalacja aplikacji (PWA) na ekranie głównym telefonu lub jako aplikacja na komputerze.
// Chrome/Edge (Android, Windows, macOS) zgłaszają zdarzenie beforeinstallprompt - zapamiętujemy je,
// żeby pokazać własny przycisk „Zainstaluj”. Safari na iPhonie nie ma takiego zdarzenia: tam
// wyświetlamy krótką instrukcję (Udostępnij -> Do ekranu początkowego).
import { useEffect, useState } from "react";
import { storage } from "./storage";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISS_KEY = "install-dismissed-until";
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();          // bez domyślnego paska przeglądarki - pokażemy własną kartę
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    storage.set(DISMISS_KEY, Date.now() + 10 * 365 * 864e5);
    notify();
  });
}

export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export function useInstall() {
  const [, force] = useState(0);
  const [dismissedUntil, setDismissedUntil] = useState<number>(() => storage.get(DISMISS_KEY, 0));
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const ios = isIOS();
  const available = !isStandalone() && (deferred !== null || ios) && Date.now() > dismissedUntil;

  return {
    available,
    ios,
    canPrompt: deferred !== null,
    async install() {
      if (!deferred) return;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === "accepted") dismiss(3650);
      notify();
    },
    /** Ukryj kartę na `days` dni. */
    dismiss,
  };

  function dismiss(days = 30) {
    const until = Date.now() + days * 864e5;
    storage.set(DISMISS_KEY, until);
    setDismissedUntil(until);
  }
}
