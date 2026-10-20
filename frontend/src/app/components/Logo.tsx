// Znak i logotyp aplikacji: odznaka z sylwetką kulturysty (napięty biceps, druga ręka na biodrze)
// w fioletowym kwadracie oraz nazwa „Siłownik” - zawsze razem, jako jeden znak.
// Źródło grafiki: src/assets/logo-mark.webp (z niej generowane są też ikony PWA w public/icons).
import logoMark from "../../assets/logo-mark.webp";
import { cn } from "./ui/utils";

/** Sama odznaka (np. ikona aplikacji): grafika kulturysty z napiętym bicepsem w fioletowym kwadracie. */
export function LogoMark({ className }: { className?: string }) {
  return <img src={logoMark} alt="" aria-hidden="true" draggable={false} className={cn("select-none object-contain", className)} />;
}

/** Logotyp: odznaka + nazwa. Nazwa ma wysokość odznaki i ten sam gradient, więc czyta się jako jeden znak. */
export function Logo({ className, size = "md", tone = "brand" }: {
  className?: string;
  size?: "sm" | "md" | "lg";
  tone?: "brand" | "light";
}) {
  const s = { sm: ["h-7 w-7", "text-[1.55rem]"], md: ["h-9 w-9", "text-[2rem]"], lg: ["h-14 w-14", "text-[3.1rem]"] }[size];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark className={cn("shrink-0 rounded-[22%] shadow-[0_2px_10px_-2px_rgba(122,48,210,0.55)]", tone === "light" && "ring-2 ring-white/30", s[0])} />
      <span className={cn("font-display font-extrabold leading-none tracking-tight", s[1],
        tone === "brand" ? "logo-wordmark" : "text-brand-foreground")}>
        Siłownik
      </span>
    </span>
  );
}
