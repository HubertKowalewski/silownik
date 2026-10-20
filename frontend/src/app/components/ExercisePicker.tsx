// Wybór ćwiczenia: jedno pole - wpisujesz fragment nazwy (po polsku lub angielsku, z polskimi znakami
// albo bez), a pod spodem pojawia się lista podpowiedzi. Bez wpisywania: najczęściej używane ćwiczenia
// i filtr partii mięśni. Obsługa klawiaturą: strzałki, Enter, Esc.
import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Exercise } from "../../lib/api";
import { exerciseName } from "../../lib/format";
import { cn } from "./ui/utils";

/** Tekst do porównań: małe litery, bez polskich znaków (ł -> l, ą -> a ...). */
export function normalize(text: string) {
  return text.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

type Row = { header: string } | { exercise: Exercise };

const MAX_RESULTS = 80;

/** Wyniki wyszukiwania: najpierw nazwy zaczynające się od frazy, potem zawierające ją gdziekolwiek. */
export function searchExercises(exercises: Exercise[], query: string, group: string | null) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const pool = group ? exercises.filter((e) => e.muscle_group === group) : exercises;
  if (!words.length) return pool;
  const scored: { e: Exercise; score: number }[] = [];
  for (const e of pool) {
    const { pl, en } = exerciseName(e.name);
    const npl = normalize(pl), nen = normalize(en), hay = `${npl} ${nen} ${normalize(e.muscle_group)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const first = words[0];
    const score = (npl.startsWith(first) || nen.startsWith(first) ? 0 : 2) + ((e.times_used ?? 0) > 0 ? 0 : 1);
    scored.push({ e, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name, "pl")).map((x) => x.e);
}

export function ExercisePicker({ exercises, value, onChange, placeholder = "Szukaj ćwiczenia, np. przysiad" }: {
  exercises: Exercise[];
  value: number | null;
  onChange: (id: number) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const selected = exercises.find((e) => e.id === value) ?? null;
  const groups = useMemo(() => [...new Set(exercises.map((e) => e.muscle_group))].sort((a, b) => a.localeCompare(b, "pl")), [exercises]);

  const rows = useMemo<Row[]>(() => {
    if (query.trim()) {
      return searchExercises(exercises, query, group).slice(0, MAX_RESULTS).map((exercise) => ({ exercise }));
    }
    const out: Row[] = [];
    const pool = group ? exercises.filter((e) => e.muscle_group === group) : exercises;
    const recent = pool.filter((e) => (e.times_used ?? 0) > 0)
      .sort((a, b) => (b.times_used ?? 0) - (a.times_used ?? 0)).slice(0, 8);
    if (recent.length) out.push({ header: "Najczęściej używane" }, ...recent.map((exercise) => ({ exercise })));
    const byGroup = new Map<string, Exercise[]>();
    pool.forEach((e) => byGroup.set(e.muscle_group, [...(byGroup.get(e.muscle_group) ?? []), e]));
    [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b, "pl")).forEach(([g, items]) => {
      out.push({ header: g }, ...items.sort((a, b) => a.name.localeCompare(b.name, "pl")).map((exercise) => ({ exercise })));
    });
    return out;
  }, [exercises, query, group]);
  const options = useMemo(() => rows.flatMap((r) => ("exercise" in r ? [r.exercise] : [])), [rows]);

  // zamknięcie po kliknięciu poza polem
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => setActive(0), [query, group]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const openList = () => {
    if (open) return;
    setOpen(true);
    // na telefonie przewiń tak, by lista zmieściła się nad klawiaturą
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top > window.innerHeight * 0.4) window.scrollBy({ top: top - 80, behavior: "smooth" });
  };

  const choose = (e: Exercise) => {
    onChange(e.id);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); openList(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && open && options[active]) { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const shown = selected ? exerciseName(selected.name) : null;
  let index = -1;

  return (
    <div ref={root} className="relative min-w-0">
      <div className={cn(
        "flex h-10 items-center gap-2 rounded-md border border-input bg-input-background px-3 text-sm transition-shadow dark:bg-input/30",
        open && "ring-2 ring-ring/50",
      )}>
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && options[active] ? `${id}-o${active}` : undefined}
          aria-label="Ćwiczenie"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder={shown ? shown.pl : placeholder}
          value={open ? query : shown?.pl ?? ""}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => { setQuery(e.target.value); openList(); }}
          onKeyDown={onKey}
        />
        {open && query ? (
          <button type="button" aria-label="Wyczyść" className="text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.preventDefault(); setQuery(""); input.current?.focus(); }}>
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        )}
      </div>

      {open && (
        // preventDefault: pole bywa wewnątrz <label> (Field) - bez tego kliknięcie w podpowiedź
        // przeglądarka przekazałaby do pola tekstowego i lista otworzyłaby się ponownie
        <div onClick={(e) => e.preventDefault()} className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2" role="group" aria-label="Partia mięśni">
            {[null, ...groups].map((g) => (
              <button key={g ?? "all"} type="button" aria-pressed={group === g}
                onClick={() => { setGroup(g); input.current?.focus(); }}
                className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors",
                  group === g ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
                {g ?? "Wszystkie"}
              </button>
            ))}
          </div>
          <div ref={list} id={`${id}-list`} role="listbox" className="max-h-72 overflow-y-auto overscroll-contain py-1">
            {options.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nie znaleziono ćwiczenia „{query}”. Spróbuj krótszej frazy lub innej nazwy.
              </p>
            )}
            {rows.map((r) => {
              if ("header" in r) {
                return <p key={`h-${r.header}`} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{r.header}</p>;
              }
              index += 1;
              const i = index, e = r.exercise, { pl, en } = exerciseName(e.name);
              return (
                <button key={`${i}-${e.id}`} id={`${id}-o${i}`} data-index={i} type="button" role="option"
                  aria-selected={e.id === value} onMouseEnter={() => setActive(i)} onClick={() => choose(e)}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-left", i === active && "bg-accent text-accent-foreground")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{pl}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {en}{query.trim() ? `${en ? " · " : ""}${e.muscle_group}` : ""}
                    </span>
                  </span>
                  {e.id === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
            {query.trim() && options.length === MAX_RESULTS && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Pokazano {MAX_RESULTS} pierwszych wyników - doprecyzuj nazwę.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
