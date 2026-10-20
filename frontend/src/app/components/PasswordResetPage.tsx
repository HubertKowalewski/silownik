// Odzyskiwanie hasła (WF-01): prośba o link na e-mail albo ustawienie nowego hasła z linku.
import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { authApi, errorText } from "../../lib/api";
import { ErrorText, Field } from "./common";
import { AuthShell } from "./common";
import { PasswordInput } from "./ui/password-input";

export function PasswordResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const uid = params.get("uid");
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (uid && token) {
        if (password !== password2) throw new Error("Hasła nie są identyczne.");
        const r = await authApi.confirmPasswordReset({ uid, token, password, password2 });
        setMessage(r.detail);
      } else {
        setMessage((await authApi.requestPasswordReset(email.trim())).detail);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>{uid && token ? "Ustaw nowe hasło" : "Nie pamiętasz hasła?"}</CardTitle>
          <CardDescription>
            {uid && token
              ? "Hasło musi mieć co najmniej 8 znaków i nie może być zbyt proste."
              : "Podaj adres e-mail konta - wyślemy link do ustawienia nowego hasła, ważny 24 godziny."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {message ? (
            <div className="space-y-4">
              <p className="text-sm">{message}</p>
              <Button onClick={() => navigate("/login")}>Przejdź do logowania</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {uid && token ? (
                <>
                  <Field label="Nowe hasło">
                    <PasswordInput autoComplete="new-password" required value={password}
                      onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                  <Field label="Powtórz hasło">
                    <PasswordInput autoComplete="new-password" required value={password2}
                      onChange={(e) => setPassword2(e.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label="E-mail">
                  <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              )}
              <ErrorText>{error}</ErrorText>
              <Button type="submit" className="w-full" disabled={busy}>
                {uid && token ? "Zmień hasło" : "Wyślij link"}
              </Button>
              <p className="text-center text-sm"><Link className="underline" to="/login">Wróć do logowania</Link></p>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
