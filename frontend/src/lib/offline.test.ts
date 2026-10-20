import { beforeEach, describe, expect, it, vi } from "vitest";

// kolejka offline z podmienionym klientem API
const saveSession = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, trainingApi: { ...real.trainingApi, saveSession, saveMeasurement: vi.fn(), saveTest: vi.fn() } };
});
const { ApiError } = await import("./api");
const { flushQueue, pendingCount, saveOrQueue } = await import("./offline");

const setOnline = (value: boolean) => Object.defineProperty(navigator, "onLine", { value, configurable: true });

describe("kolejka offline", () => {
  beforeEach(() => {
    localStorage.clear();
    saveSession.mockReset();
    setOnline(true);
  });

  it("bez sieci zapisuje trening w urządzeniu, po powrocie sieci wysyła go", async () => {
    setOnline(false);
    expect((await saveOrQueue("session", { client_uuid: "a" })).status).toBe("queued");
    expect(pendingCount()).toBe(1);
    setOnline(true);
    saveSession.mockResolvedValue({ id: 1 });
    expect(await flushQueue()).toBe(1);
    expect(pendingCount()).toBe(0);
  });

  it("błąd serwera (5xx) kolejkuje, błąd walidacji (400) przekazuje użytkownikowi", async () => {
    saveSession.mockRejectedValueOnce(new ApiError(503, "niedostępny"));
    expect((await saveOrQueue("session", { client_uuid: "b" })).status).toBe("queued");
    saveSession.mockRejectedValueOnce(new ApiError(400, "zły ciężar"));
    await expect(saveOrQueue("session", { client_uuid: "c" })).rejects.toThrow("zły ciężar");
    expect(pendingCount()).toBe(1);
  });

  it("przy synchronizacji odrzuca rekordy z błędem walidacji, a przy braku sieci przerywa", async () => {
    setOnline(false);
    await saveOrQueue("session", { client_uuid: "x" });
    await saveOrQueue("session", { client_uuid: "y" });
    setOnline(true);
    saveSession.mockRejectedValueOnce(new ApiError(400, "zły")).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await flushQueue()).toBe(0);
    expect(pendingCount()).toBe(1); // "x" usunięty, "y" czeka na sieć
  });
});
