import { Component, lazy, ReactNode, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation, useNavigate } from "react-router";
import { ThemeProvider } from "./components/ThemeProvider";
import { AuthProvider, useAuth } from "./components/AuthProvider";
import { LoginPage } from "./components/LoginPage";
import { ThemeToggle } from "./components/ThemeToggle";
import { UpdateBanner } from "./components/UpdateBanner";
import { ServerWakeBanner } from "./components/ServerWakeBanner";
import { Toaster } from "./components/Toaster";
import { Button } from "./components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Logo } from "./components/Logo";
import {
  BarChart3, Bell, CloudOff, Dumbbell, History, Home, ListChecks, Loader2, LogOut, MoreHorizontal, Ruler, ShieldCheck, User,
} from "lucide-react";
import { Notification, trainingApi } from "../lib/api";
import { onQueueChange, pendingCount } from "../lib/offline";
import { fmtDateTime } from "../lib/format";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const load = () => trainingApi.notifications().then(setItems).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  const unread = items.filter((n) => !n.is_read).length;

  return (
    <Popover onOpenChange={(open) => open && unread && trainingApi.readNotifications().then(load)}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Powiadomienia (${unread} nowych)`} className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {items.length === 0 && <p className="p-2 text-sm text-muted-foreground">Brak powiadomień.</p>}
        <ul className="max-h-80 space-y-1 overflow-auto">
          {items.map((n) => (
            <li key={n.id}>
              <button
                className={`w-full rounded-md p-2 text-left text-sm hover:bg-muted ${n.is_read ? "text-muted-foreground" : ""}`}
                onClick={() => n.url && navigate(n.url)}
              >
                {n.text}
                <span className="block text-xs text-muted-foreground">
                  {fmtDateTime(n.created_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function OfflineBadge() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(pendingCount());
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unsub = onQueueChange(setPending);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      unsub();
    };
  }, []);
  if (online && pending === 0) return null;
  return (
    <span className="flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1 text-xs text-warning">
      <CloudOff className="h-3.5 w-3.5" />
      {online ? `Synchronizacja: ${pending}` : `Offline${pending ? ` · ${pending} do wysłania` : ""}`}
    </span>
  );
}

type NavItem = { to: string; label: string; icon: typeof Home; end?: boolean };

const topLink = ({ isActive }: { isActive: boolean }) =>
  `relative flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm transition-colors ${
    isActive ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;

/** Dolny pasek na telefonie: najczęstsze miejsca pod kciukiem, trening w środku jako „talerz”. */
function BottomBar({ more, username, onLogout }: { more: NavItem[]; username: string; onLogout: () => void }) {
  const location = useLocation();
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? "font-semibold text-primary" : "text-muted-foreground"}`;
  const moreActive = more.some((m) => location.pathname.startsWith(m.to));
  return (
    <nav aria-label="Nawigacja główna" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md items-end">
        <NavLink to="/" end className={tab}><Home className="h-5 w-5" /> Pulpit</NavLink>
        <NavLink to="/historia" className={tab}><History className="h-5 w-5" /> Historia</NavLink>
        <NavLink to="/trening" className="flex flex-1 flex-col items-center gap-0.5 pb-2 text-[11px] font-semibold text-primary">
          {({ isActive }) => (
            <>
              <span className={`-mt-5 flex h-14 w-14 items-center justify-center rounded-full border-4 border-background shadow-sm ${isActive ? "ring-2 ring-primary/40" : ""} brand-gradient`}>
                <Dumbbell className="h-6 w-6" />
              </span>
              Trening
            </>
          )}
        </NavLink>
        <NavLink to="/plany" className={tab}><ListChecks className="h-5 w-5" /> Plany</NavLink>
        <Popover>
          <PopoverTrigger className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${moreActive ? "font-semibold text-primary" : "text-muted-foreground"}`}>
            <MoreHorizontal className="h-5 w-5" /> Więcej
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-56 p-1">
            {more.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={topLink}><Icon className="h-4 w-4" /> {label}</NavLink>
            ))}
            <div className="my-1 border-t border-border" />
            <button type="button" onClick={onLogout} className={topLink({ isActive: false }) + " w-full"}>
              <LogOut className="h-4 w-4" /> Wyloguj ({username})
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}

function AppNav() {
  const { user, logout } = useAuth();
  useEffect(() => {
    if (user && navigator.onLine) preloadPages();
  }, [user]);
  if (!user) return null;
  const links: NavItem[] = [
    { to: "/", label: "Pulpit", icon: Home, end: true },
    { to: "/trening", label: "Trening", icon: Dumbbell },
    { to: "/historia", label: "Historia", icon: History },
    { to: "/plany", label: "Plany", icon: ListChecks },
    { to: "/pomiary", label: "1RM i pomiary", icon: Ruler },
    { to: "/statystyki", label: "Statystyki", icon: BarChart3 },
    { to: "/profil", label: "Profil", icon: User },
    ...(user.is_staff ? [{ to: "/moderacja", label: "Moderacja", icon: ShieldCheck }] : []),
  ];
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 px-3 py-2">
          <NavLink to="/" className="mr-3 shrink-0 rounded-lg" aria-label="Siłownik - pulpit">
            <Logo size="sm" />
          </NavLink>
          <div className="hidden min-w-0 items-center gap-0.5 overflow-x-auto md:flex">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={topLink}>
                <Icon className="h-4 w-4" /> <span className="hidden lg:inline">{label}</span>
              </NavLink>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <OfflineBadge />
            <ThemeToggle />
            <Notifications />
            <Button variant="ghost" size="icon" className="hidden md:inline-flex" aria-label={`Wyloguj (${user.username})`} title={`Wyloguj (${user.username})`} onClick={() => logout()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      </header>
      <BottomBar more={links.filter((l) => ["/pomiary", "/statystyki", "/profil", "/moderacja"].includes(l.to))}
        username={user.username} onLogout={() => logout()} />
    </>
  );
}

// Strony ładowane dopiero przy pierwszym wejściu - mniejszy plik startowy aplikacji mobilnej.
const pages = {
  GymDashboard: () => import("./components/GymDashboard"),
  WorkoutLogger: () => import("./components/WorkoutLogger"),
  PlansPage: () => import("./components/PlansPage"),
  PlanEditor: () => import("./components/PlanEditor"),
  TemplatesPage: () => import("./components/TemplatesPage"),
  PlanCreatePage: () => import("./components/PlanCreatePage"),
  PlanAssistantPage: () => import("./components/PlanAssistantPage"),
  PlanDetails: () => import("./components/PlanDetails"),
  StatsPage: () => import("./components/StatsPage"),
  MeasurementsPage: () => import("./components/MeasurementsPage"),
  ProfilePage: () => import("./components/ProfilePage"),
  HistoryPage: () => import("./components/HistoryPage"),
  PasswordResetPage: () => import("./components/PasswordResetPage"),
  PublicProfilePage: () => import("./components/PublicProfilePage"),
  ModerationPage: () => import("./components/ModerationPage"),
  SusPage: () => import("./components/SusPage"),
};
const GymDashboard = lazy(() => pages.GymDashboard().then((m) => ({ default: m.GymDashboard })));
const WorkoutLogger = lazy(() => pages.WorkoutLogger().then((m) => ({ default: m.WorkoutLogger })));
const PlansPage = lazy(() => pages.PlansPage().then((m) => ({ default: m.PlansPage })));
const PlanEditor = lazy(() => pages.PlanEditor().then((m) => ({ default: m.PlanEditor })));
const PlanCreatePage = lazy(() => pages.PlanCreatePage().then((m) => ({ default: m.PlanCreatePage })));
const PlanAssistantPage = lazy(() => pages.PlanAssistantPage().then((m) => ({ default: m.PlanAssistantPage })));
const TemplatesPage = lazy(() => pages.TemplatesPage().then((m) => ({ default: m.TemplatesPage })));
const PlanDetails = lazy(() => pages.PlanDetails().then((m) => ({ default: m.PlanDetails })));
const StatsPage = lazy(() => pages.StatsPage().then((m) => ({ default: m.StatsPage })));
const MeasurementsPage = lazy(() => pages.MeasurementsPage().then((m) => ({ default: m.MeasurementsPage })));
const ProfilePage = lazy(() => pages.ProfilePage().then((m) => ({ default: m.ProfilePage })));
const HistoryPage = lazy(() => pages.HistoryPage().then((m) => ({ default: m.HistoryPage })));
const PasswordResetPage = lazy(() => pages.PasswordResetPage().then((m) => ({ default: m.PasswordResetPage })));
const SusPage = lazy(() => pages.SusPage().then((m) => ({ default: m.SusPage })));
const ModerationPage = lazy(() => pages.ModerationPage().then((m) => ({ default: m.ModerationPage })));
const PublicProfilePage = lazy(() => pages.PublicProfilePage().then((m) => ({ default: m.PublicProfilePage })));

// Po starcie pozostałe strony są pobierane w tle, aby service worker zapisał je do pracy offline.
function preloadPages() {
  const run = () => Object.values(pages).forEach((load) => load().catch(() => {}));
  if ("requestIdleCallback" in window) (window as any).requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 3000);
}

const protect = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>;

function StaffOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.is_staff ? <>{children}</> : <Navigate to="/" replace />;
}

// Nieoczekiwany błąd w stronie nie zostawia pustego ekranu - trening w toku jest zapisany lokalnie.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md space-y-3 p-6 text-center">
        <p className="text-lg font-semibold">Coś poszło nie tak</p>
        <p className="text-sm text-muted-foreground">
          Wystąpił nieoczekiwany błąd. Dane treningu w toku są zapisane w urządzeniu.
        </p>
        <Button onClick={() => (window.location.href = "/")}>Wróć do pulpitu</Button>
      </div>
    );
  }
}

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppNav />
          <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-hasla" element={<PasswordResetPage />} />
            <Route path="/uzytkownicy/:username" element={protect(<PublicProfilePage />)} />
            <Route path="/" element={protect(<GymDashboard />)} />
            <Route path="/trening" element={protect(<WorkoutLogger />)} />
            <Route path="/historia" element={protect(<HistoryPage />)} />
            <Route path="/plany" element={protect(<PlansPage />)} />
            <Route path="/plany/nowy" element={protect(<PlanEditor />)} />
            <Route path="/plany/szablony" element={protect(<TemplatesPage />)} />
            <Route path="/plany/utworz" element={protect(<PlanCreatePage />)} />
            <Route path="/plany/asystent" element={protect(<PlanAssistantPage />)} />
            <Route path="/plany/:id" element={protect(<PlanDetails />)} />
            <Route path="/plany/:id/edycja" element={protect(<PlanEditor />)} />
            <Route path="/pomiary" element={protect(<MeasurementsPage />)} />
            <Route path="/statystyki" element={protect(<StatsPage />)} />
            <Route path="/profil" element={protect(<ProfilePage />)} />
            <Route path="/ankieta" element={protect(<SusPage />)} />
            <Route path="/moderacja" element={protect(<StaffOnly><ModerationPage /></StaffOnly>)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
          <UpdateBanner />
          <ServerWakeBanner />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
