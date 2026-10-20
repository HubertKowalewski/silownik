import { beforeEach, describe, expect, it } from "vitest";
import { storage } from "./storage";

describe("pamięć lokalna", () => {
  beforeEach(() => localStorage.clear());

  it("zapisuje i odczytuje JSON z prefiksem aplikacji", () => {
    storage.set("records", { 5: 120 });
    expect(localStorage.getItem("silownik-records")).toBe('{"5":120}');
    expect(storage.get("records", {})).toEqual({ 5: 120 });
  });

  it("przenosi dane zapisane pod starą nazwą aplikacji", () => {
    localStorage.setItem("pa-offline-queue", '[{"kind":"session"}]');
    expect(storage.get("offline-queue", [])).toEqual([{ kind: "session" }]);
    expect(localStorage.getItem("pa-offline-queue")).toBeNull();
    expect(localStorage.getItem("silownik-offline-queue")).not.toBeNull();
  });

  it("zwraca wartość domyślną dla uszkodzonych danych", () => {
    localStorage.setItem("silownik-draft", "{nie-json");
    expect(storage.get("draft", "domyślna")).toBe("domyślna");
  });
});
