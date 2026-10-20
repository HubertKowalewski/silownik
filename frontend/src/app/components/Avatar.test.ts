import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { initials } from "./Avatar";
import { PasswordInput } from "./ui/password-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("inicjały na awatarze bez zdjęcia", () => {
  it("dwie litery z nazwy użytkownika", () => {
    expect(initials("eksu")).toBe("EK");
    expect(initials("jan.kowalski")).toBe("JK");
    expect(initials("łucja_nowak")).toBe("ŁN");
    expect(initials("__")).toBe("?");
  });
});

describe("pole hasła z podglądem", () => {
  it("przycisk oka przełącza widoczność hasła", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(PasswordInput, { defaultValue: "Tajne123!", "aria-label": "Hasło" })));
    const input = host.querySelector("input")!;
    const toggle = host.querySelector("button")!;
    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-label")).toBe("Pokaż hasło");
    act(() => toggle.click());
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-label")).toBe("Ukryj hasło");
    act(() => toggle.click());
    expect(input.type).toBe("password");
    act(() => root.unmount());
  });
});
