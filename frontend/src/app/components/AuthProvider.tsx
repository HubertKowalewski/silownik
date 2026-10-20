// frontend/src/app/components/AuthProvider.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { ApiError, authApi, User } from "../../lib/api";
import { storage } from "../../lib/storage";

// Ostatnio zalogowany użytkownik zapamiętany w urządzeniu: aplikacja otwiera się od razu (także bez
// zasięgu, np. na siłowni w piwnicy), a sesja jest sprawdzana w tle. Gdy serwer odpowie, że sesja
// wygasła - przejście do logowania; brak połączenia nie wylogowuje.
const USER_KEY = "user";
const remember = (user: User | null) => (user ? storage.set(USER_KEY, user) : storage.remove(USER_KEY));

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: {
    username: string;
    email: string;
    password: string;
    password2: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** Zmiana danych zalogowanego użytkownika bez ponownego pobierania (np. nowe zdjęcie profilowe). */
  updateUser: (patch: Partial<User>) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => storage.get<User | null>(USER_KEY, null));
  const [loading, setLoading] = useState(() => storage.get<User | null>(USER_KEY, null) === null);
  const setUser = (u: User | null) => {
    remember(u);
    setUserState(u);
  };

  useEffect(() => {
    authApi.me()
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError) setUser(null);   // serwer odpowiedział błędem - sesji nie ma
        /* brak połączenia - zostaje zapamiętany użytkownik, dane z pamięci urządzenia */
      })
      .finally(() => setLoading(false));
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    login: async (username, password) => setUser(await authApi.login(username, password)),
    register: async (payload) => setUser(await authApi.register(payload)),
    updateUser: (patch) => setUser(user ? { ...user, ...patch } : null),
    logout: async () => {
      await authApi.logout();
      // dane poprzedniego konta zapisane w urządzeniu (1RM, ustawienia ćwiczeń) - nie dla kolejnej osoby
      ["records", "exercise-scales"].forEach((k) => storage.remove(k));
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth musi być użyte wewnątrz <AuthProvider>");
  return ctx;
}
