import { afterEach, describe, expect, it, vi } from "vitest";
import { api, onServerSlow } from "./api";

describe("komunikat o wybudzaniu serwera", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("pojawia się, gdy żądanie trwa ponad 3,5 s, i znika po odpowiedzi", async () => {
    vi.useFakeTimers();
    let respond: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { respond = res; })));
    const states: boolean[] = [];
    const off = onServerSlow((s) => states.push(s));

    const pending = api.get("/api/dashboard/");
    await vi.advanceTimersByTimeAsync(3000);
    expect(states).toEqual([]);                 // szybkie żądania - bez komunikatu
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual([true]);
    respond(new Response("{}", { status: 200 }));
    await pending;
    expect(states).toEqual([true, false]);
    off();
  });
});
