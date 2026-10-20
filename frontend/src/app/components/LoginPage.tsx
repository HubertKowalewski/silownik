// frontend/src/app/components/LoginPage.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { errorText } from "../../lib/api";
import { AuthShell } from "./common";
import { PasswordInput } from "./ui/password-input";

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ username: "", email: "", password: "", password2: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.username.trim().length < 3) {
      setError("Nazwa użytkownika musi mieć min. 3 znaki.");
      return;
    }
    if (form.password.length < 8) {
      setError("Hasło musi mieć min. 8 znaków.");
      return;
    }
    if (mode === "register" && form.password !== form.password2) {
      setError("Hasła nie są identyczne.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") {
        await login(form.username.trim(), form.password);
      } else {
        await register({
          username: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
          password2: form.password2,
        });
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorText(err, "Coś poszło nie tak."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>{mode === "login" ? "Zaloguj się" : "Załóż konto"}</CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Wróć do swoich treningów i statystyk."
              : "Zacznij logować serie i śledzić progres."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Nazwa użytkownika</Label>
              <Input
                id="username"
                value={form.username}
                onChange={set("username")}
                maxLength={150}
                autoComplete="username"
                required
              />
            </div>

            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  maxLength={255}
                  autoComplete="email"
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">Hasło</Label>
              <PasswordInput
                id="password"
                value={form.password}
                onChange={set("password")}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </div>

            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="password2">Powtórz hasło</Label>
                <PasswordInput
                  id="password2"
                  value={form.password2}
                  onChange={set("password2")}
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "login" ? "Zaloguj" : "Zarejestruj"}
            </Button>
            {mode === "login" && (
              <p className="text-center text-sm">
                <Link className="text-muted-foreground underline hover:text-foreground" to="/reset-hasla">
                  Nie pamiętasz hasła?
                </Link>
              </p>
            )}
          </form>

          <button
            type="button"
            className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Nie masz konta? Zarejestruj się" : "Masz już konto? Zaloguj się"}
          </button>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
