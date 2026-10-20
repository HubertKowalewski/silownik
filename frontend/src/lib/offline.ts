// Kolejka zapisów offline (WN-03, WN-04).
// Rekordy zapisane bez połączenia trafiają do pamięci lokalnej przeglądarki
// i są wysyłane automatycznie po odzyskaniu łączności lub przy uruchomieniu
// aplikacji. Każdy rekord ma client_uuid, więc ponowne wysłanie nie tworzy duplikatu.
import { ApiError, trainingApi } from "./api";
import { storage } from "./storage";

type Kind = "session" | "measurement" | "test";
type Pending = { kind: Kind; payload: any; queuedAt: string };

const KEY = "offline-queue";
const listeners = new Set<(n: number) => void>();

function read(): Pending[] {
  return storage.get<Pending[]>(KEY, []);
}

function write(items: Pending[]) {
  storage.set(KEY, items);
  listeners.forEach((fn) => fn(items.length));
}

export function pendingCount(): number {
  return read().length;
}

export function onQueueChange(fn: (n: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const senders: Record<Kind, (p: any) => Promise<any>> = {
  session: trainingApi.saveSession,
  measurement: trainingApi.saveMeasurement,
  test: trainingApi.saveTest,
};

function isNetworkError(e: unknown) {
  return !(e instanceof ApiError) || e.status >= 500;
}

export type SaveResult = { status: "sent" | "queued"; data?: any };

/** Zapis z automatycznym przejściem w tryb offline. */
export async function saveOrQueue(kind: Kind, payload: any): Promise<SaveResult> {
  if (!navigator.onLine) {
    write([...read(), { kind, payload, queuedAt: new Date().toISOString() }]);
    return { status: "queued" };
  }
  try {
    return { status: "sent", data: await senders[kind](payload) };
  } catch (e) {
    if (isNetworkError(e)) {
      write([...read(), { kind, payload, queuedAt: new Date().toISOString() }]);
      return { status: "queued" };
    }
    throw e; // błąd walidacji - użytkownik musi poprawić dane
  }
}

let flushing = false;

/** Wysyła zaległe rekordy. Rekordy odrzucone przez walidację są usuwane z kolejki. */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of read()) {
      try {
        await senders[item.kind](item.payload);
        sent++;
      } catch (e) {
        if (isNetworkError(e) || (e instanceof ApiError && (e.status === 401 || e.status === 403))) break;
        console.warn("Odrzucono rekord z kolejki offline", item, e);
      }
      write(read().filter((i) => i.payload.client_uuid !== item.payload.client_uuid));
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function startSync() {
  window.addEventListener("online", () => void flushQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushQueue();
  });
  void flushQueue();
}
