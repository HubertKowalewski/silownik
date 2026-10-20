import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { startSync } from "./lib/offline";
import "./lib/install";   // nasłuch zdarzenia instalacji PWA od samego startu (przed załadowaniem pulpitu)
import "@fontsource/big-shoulders-display/700";
import "@fontsource/big-shoulders-display/800";
import "@fontsource-variable/onest";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<App />);

startSync();

// Service worker tylko w wersji zbudowanej (serwowanej przez Django) - WN-05.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const urls = [
        ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map((s) => s.src),
        ...Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")).map((l) => l.href),
      ];
      (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "CACHE_URLS", urls });
    } catch (e) {
      console.warn("Rejestracja service workera nie powiodła się", e);
    }
  });
}
