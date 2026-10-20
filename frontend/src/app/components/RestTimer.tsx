// Minutnik przerw między seriami (WF-25). Stan jest zwykłym obiektem, więc trening
// w toku może go zapisać lokalnie - odliczanie przetrwa odświeżenie strony.
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Minus, Pause, Play, Plus, RotateCcw, Timer, X } from "lucide-react";

export type TimerState = {
  total: number;              // długość przerwy [s]
  endsAt: number | null;      // znacznik końca, gdy minutnik biegnie
  remaining: number | null;   // pozostałe sekundy, gdy minutnik jest wstrzymany
  label: string;
};

export type RestPrefs = {
  default_rest_seconds: number;
  rest_step_seconds: number;
  rest_auto_start: boolean;
  rest_sound: boolean;
  rest_vibrate: boolean;
};

export const DEFAULT_PREFS: RestPrefs = {
  default_rest_seconds: 120, rest_step_seconds: 15, rest_auto_start: true, rest_sound: true, rest_vibrate: true,
};

export const REST_PRESETS = [30, 60, 90, 120, 150, 180, 240, 300];

export const startTimer = (seconds: number, label: string): TimerState => ({
  total: seconds, endsAt: Date.now() + seconds * 1000, remaining: null, label,
});

export function fmtClock(total: number) {
  const s = Math.abs(Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Dźwięk generowany przez Web Audio - kontekst odblokowuje się przy geście użytkownika
// (np. kliknięciu "Zalicz"), bo przeglądarki blokują dźwięk bez interakcji.
let audio: AudioContext | null = null;
export function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}
function beep(times = 3) {
  if (!audio) return;
  for (let i = 0; i < times; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const t = audio.currentTime + i * 0.35;
    osc.frequency.value = i === times - 1 ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}

export function RestTimer({ timer, prefs, onChange }: {
  timer: TimerState;
  prefs: RestPrefs;
  onChange: (t: TimerState | null) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  const running = timer.endsAt !== null;
  const left = running ? (timer.endsAt! - now) / 1000 : timer.remaining ?? 0;
  const done = left <= 0;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    fired.current = left <= 0; // po odświeżeniu zakończonego minutnika nie piszczymy ponownie
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.total, timer.label]);

  useEffect(() => {
    if (done && running && !fired.current) {
      fired.current = true;
      if (prefs.rest_sound) beep();
      if (prefs.rest_vibrate) navigator.vibrate?.([300, 150, 300, 150, 300]);
    }
    if (!done) fired.current = false;
  }, [done, running, prefs.rest_sound, prefs.rest_vibrate]);

  useEffect(() => {
    const original = document.title;
    document.title = done ? "⏰ Koniec przerwy" : `⏱ ${fmtClock(left)} · przerwa`;
    return () => {
      document.title = original;
    };
  }, [Math.ceil(left), done]);

  const shift = (sec: number) => {
    if (running) onChange({ ...timer, total: Math.max(5, timer.total + sec), endsAt: Math.max(Date.now(), timer.endsAt!) + sec * 1000 });
    else onChange({ ...timer, total: Math.max(5, timer.total + sec), remaining: Math.max(0, (timer.remaining ?? 0) + sec) });
  };
  const toggle = () =>
    running
      ? onChange({ ...timer, endsAt: null, remaining: Math.max(0, left) })
      : onChange({ ...timer, endsAt: Date.now() + (timer.remaining ?? 0) * 1000, remaining: null });
  const progress = Math.min(100, Math.max(0, 100 * (1 - left / timer.total)));
  const step = prefs.rest_step_seconds;

  return (
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-50 border-t border-border bg-card/95 backdrop-blur md:bottom-0"
      role="timer" aria-live="off">
      <div className="h-1 bg-muted">
        <div className={`h-1 transition-[width] duration-300 ${done ? "bg-warning" : "bg-primary"}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 p-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <Timer className={`h-5 w-5 ${done ? "text-warning" : "text-primary"}`} />
        <div className="min-w-0">
          <div className={`numeral text-4xl ${done ? "text-warning" : ""}`}>
            {done ? `+${fmtClock(-left)}` : fmtClock(left)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {done ? "Czas na kolejną serię!" : running ? `przerwa ${fmtClock(timer.total)}` : "wstrzymano"}
            {timer.label ? ` · ${timer.label}` : ""}
          </div>
        </div>
        <div className="ml-auto flex gap-1">
          <Button size="icon" variant="outline" aria-label={`Skróć o ${step} s`} onClick={() => shift(-step)}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" aria-label={`Wydłuż o ${step} s`} onClick={() => shift(step)}>
            <Plus className="h-4 w-4" />
          </Button>
          {!done && (
            <Button size="icon" variant="outline" aria-label={running ? "Wstrzymaj" : "Wznów"} onClick={toggle}>
              {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          <Button size="icon" variant="outline" aria-label="Od nowa" onClick={() => onChange(startTimer(timer.total, timer.label))}>
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Zamknij minutnik" onClick={() => onChange(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
