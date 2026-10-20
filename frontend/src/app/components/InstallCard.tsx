// Karta „Zainstaluj Siłownik”: ikonka na ekranie głównym, pełny ekran, działanie bez internetu.
// Android / komputer (Chrome, Edge): przycisk wywołuje systemowe okno instalacji.
// iPhone / iPad (Safari): krótka instrukcja - Safari nie pozwala zainstalować aplikacji przyciskiem.
import { Download, Share, SquarePlus, X } from "lucide-react";
import { useInstall } from "../../lib/install";
import { LogoMark } from "./Logo";
import { Button } from "./ui/button";

export function InstallCard() {
  const { available, ios, canPrompt, install, dismiss } = useInstall();
  if (!available) return null;
  const mobile = ios || /Android/i.test(navigator.userAgent);

  return (
    <div className="tile-gradient relative flex items-start gap-3 rounded-xl border border-primary/30 p-4">
      <LogoMark className="h-12 w-12 shrink-0 rounded-[22%] shadow-sm" />
      <div className="min-w-0 flex-1 space-y-2 pr-6">
        <div>
          <p className="font-semibold">Zainstaluj Siłownik {mobile ? "na telefonie" : "na komputerze"}</p>
          <p className="text-sm text-muted-foreground">
            Ikonka {mobile ? "na ekranie głównym" : "w menu Start / Docku"}, pełny ekran bez paska przeglądarki
            i zapisywanie treningu także bez internetu.
          </p>
        </div>
        {canPrompt ? (
          <Button size="sm" onClick={install}><Download className="mr-1.5 h-4 w-4" /> Zainstaluj</Button>
        ) : ios ? (
          <ol className="space-y-1 text-sm">
            <li className="flex items-center gap-1.5">
              1. Stuknij <Share className="h-4 w-4 text-primary" aria-label="Udostępnij" /> <strong>Udostępnij</strong> na pasku Safari
            </li>
            <li className="flex items-center gap-1.5">
              2. Wybierz <SquarePlus className="h-4 w-4 text-primary" aria-hidden /> <strong>Do ekranu początkowego</strong>
            </li>
          </ol>
        ) : null}
      </div>
      <button type="button" aria-label="Nie teraz" title="Nie teraz" onClick={() => dismiss(30)}
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
