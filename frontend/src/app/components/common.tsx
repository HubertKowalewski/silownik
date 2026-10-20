// Wspólne, proste elementy formularzy używane na wielu stronach.
import { ComponentType, ReactNode, SelectHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "./ui/utils";

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-input-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

export function NativeSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClass, className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Spinner({ text = "Ładowanie..." }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {text}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

type IconType = ComponentType<{ className?: string }>;

/** Ekran logowania i odzyskiwania hasła: fioletowa „płyta” z nazwą aplikacji i formularz obok. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 min-h-screen md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="brand-gradient relative flex flex-col justify-between overflow-hidden p-6 md:p-12">
        <Logo tone="light" size="md" />
        <div className="mt-8 space-y-4 md:mt-0">
          <p className="font-display text-[2.6rem] font-extrabold leading-[0.95] tracking-tight md:text-[4.5rem]">
            Plan, seria,<br />progres.
          </p>
          <p className="max-w-sm text-sm opacity-85 md:text-base">
            Planowanie treningu siłowego, zapis serii na siłowni - także bez zasięgu - i analiza postępów.
          </p>
        </div>
        <div className="knurl -mx-6 mt-8 h-3 opacity-70 [--knurl:color-mix(in_srgb,var(--brand-surface-foreground)_40%,transparent)] md:-mx-12 md:mt-0" aria-hidden="true" />
      </aside>
      <main className="flex items-center justify-center p-4 py-10 md:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

/** Szablon strony: tytuł krojem „szyldowym”, opis i radełkowany pasek - wspólny dla wszystkich ekranów. */
export function Page({ title, description, actions, icon: Icon, children }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: IconType;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-6 md:pb-16 md:pt-10">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-secondary text-accent-foreground">
                <Icon className="h-5 w-5" />
              </span>
            )}
            <h1 className="min-w-0 font-display text-[2.1rem] font-extrabold leading-none tracking-tight md:text-[2.75rem]">
              {title}
            </h1>
          </div>
          {actions}
        </div>
        <div className="grip-bar knurl" aria-hidden="true" />
        {description && <p className="max-w-[68ch] text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

/** Kafelek z liczbą: etykieta, duża liczba krojem tytułowym, podpowiedź. */
/** Wielkość liczby w kafelku: długie wartości (np. „13 932 kg”) mniejszą czcionką, żeby mieściły się na telefonie. */
function numeralSize(value: ReactNode, unit: string | undefined, compact?: boolean) {
  const length = typeof value === "string" || typeof value === "number" ? String(value).length + (unit ? unit.length + 1 : 0) : 0;
  if (compact) return length > 6 ? "text-[1.2rem] sm:text-[1.6rem] md:text-[2rem]" : "text-[1.6rem] md:text-[2.2rem]";
  return length > 8 ? "text-[1.6rem] md:text-[2rem]" : "text-[2rem] md:text-[2.4rem]";
}

export function StatTile({ label, value, unit, hint, icon: Icon, compact }: {
  label: string;
  value: ReactNode;
  unit?: string;          // jednostka mniejszym krojem obok liczby (np. kg), nie zawija się osobno
  hint?: ReactNode;
  icon?: IconType;
  tone?: number;
  compact?: boolean;      // ciasna siatka (np. 3 kafelki obok siebie na telefonie)
}) {
  return (
    <div className={cn("tile-gradient min-w-0 rounded-xl border border-border", compact ? "p-3" : "p-4")}>
      <div className="flex min-w-0 items-start gap-1.5 text-xs leading-tight text-muted-foreground">
        {Icon && <Icon className={cn("mt-px h-3.5 w-3.5 shrink-0", compact && "hidden sm:block")} />} <span className="min-w-0">{label}</span>
      </div>
      <div className={cn("numeral mt-2 whitespace-nowrap text-foreground", numeralSize(value, unit, compact))}>
        {value}{unit && <span className="ml-1 text-[0.55em] text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Wyróżniona karta akcji: pełny fiolet marki z radełkowanym brzegiem (jak uchwyt gryfu). */
export function HeroCard({ title, description, icon: Icon, children }: {
  title: string;
  description?: ReactNode;
  icon?: IconType;
  children?: ReactNode;
}) {
  return (
    <section className="brand-gradient relative overflow-hidden rounded-xl shadow-[0_10px_30px_-12px_var(--glow-1)]">
      <div className="space-y-3 p-5 md:p-6">
        <h2 className="flex items-center gap-2 font-display text-2xl font-extrabold leading-none tracking-tight md:text-[1.75rem]">
          {Icon && <Icon className="h-5 w-5" />} {title}
        </h2>
        {description && <div className="max-w-[70ch] text-sm opacity-85">{description}</div>}
        {children}
      </div>
      <div className="h-2 opacity-60 [--knurl:color-mix(in_srgb,var(--brand-surface-foreground)_45%,transparent)] knurl" aria-hidden="true" />
    </section>
  );
}

/** Wybór ćwiczenia z filtrem tekstowym - baza liczy kilkaset pozycji. */
export { ExercisePicker } from "./ExercisePicker";
