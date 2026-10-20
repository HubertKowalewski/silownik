import { useEffect, useState } from "react";
import { Exercise, Meta, trainingApi } from "./api";

/** Słowniki z /api/meta/ (wyniki są buforowane w trainingApi, więc wiele komponentów = jedno zapytanie). */
export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    let alive = true;
    trainingApi.meta().then((m) => alive && setMeta(m)).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return meta;
}

/** Baza ćwiczeń (wspólne + własne użytkownika), również buforowana w trainingApi. */
export function useExercises(): Exercise[] {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  useEffect(() => {
    let alive = true;
    trainingApi.exercises().then((list) => alive && setExercises(list)).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return exercises;
}

/** Nie wygaszaj ekranu telefonu, dopóki `active` (np. w trakcie treningu). Ciche, gdy przeglądarka nie wspiera API. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then((l) => {
        if (cancelled) void l.release();
        else lock = l;
      }).catch(() => undefined);
    };
    request();
    // blokada znika po przejściu do innej aplikacji - odnawiamy ją po powrocie
    document.addEventListener("visibilitychange", request);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
