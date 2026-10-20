// Krótkie powiadomienia („Zapisano”) pokazywane u dołu ekranu - widoczne niezależnie od tego,
// w którym miejscu długiej strony był przycisk.
export type Toast = { id: number; text: string; kind: "success" | "info" | "error" };

let next = 1;
const listeners = new Set<(t: Toast) => void>();

export function toast(text: string, kind: Toast["kind"] = "success") {
  const t = { id: next++, text, kind };
  listeners.forEach((fn) => fn(t));
}

export function onToast(fn: (t: Toast) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
