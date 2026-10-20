import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactNode } from "react";

/** Motyw jasny / ciemny; domyślnie zgodny z ustawieniem systemu, wybór użytkownika jest zapamiętywany. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem storageKey="silownik-theme"
      disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
