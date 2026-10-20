// Profil treningowy (WF-02), ankieta zdrowotna ze zgodą (WF-03, WN-09),
// eksport danych i usunięcie konta (WF-05).
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import { Link } from "react-router";
import { ImportResult, errorText } from "../../lib/api";
import { Download, Eye, Mail, Save, ShieldAlert, Timer, Trash2, Upload, UserCog, ClipboardCheck } from "lucide-react";
import { authApi, Meta, Profile, trainingApi } from "../../lib/api";
import { ErrorText, Field, NativeSelect, Page, Spinner } from "./common";
import { useAuth } from "./AuthProvider";
import { fmtClock, REST_PRESETS } from "./RestTimer";
import { fmtDateTime, numOrNull } from "../../lib/format";
import { toast } from "../../lib/toast";
import { PasswordInput } from "./ui/password-input";
import { AvatarCard } from "./AvatarCard";

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [pw, setPw] = useState({ old_password: "", new_password: "", new_password2: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([trainingApi.meta(), trainingApi.profile()])
      .then(([m, p]) => {
        setMeta(m);
        setProfile(p);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (!profile || !meta) return error ? <Page icon={UserCog} title="Profil"><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  const set = (patch: Partial<Profile>) => {
    setSaved(false);
    setProfile({ ...profile, ...patch });
  };
  const toggle = (list: any[], value: any) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      setProfile(await trainingApi.saveProfile(profile));
      setSaved(true);
      toast("Zapisano profil.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setPwMsg(null);
    try {
      setPwMsg((await authApi.changePassword(pw)).detail);
      setPw({ old_password: "", new_password: "", new_password2: "" });
    } catch (e) {
      setPwMsg(errorText(e));
    }
  };

  const saveEmail = async () => {
    setEmailMsg(null);
    try {
      const u = await authApi.updateAccount({ email });
      setEmail(u.email);
      setEmailMsg("Zapisano adres e-mail.");
    } catch (e) {
      setEmailMsg(errorText(e));
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      setImportResult(await trainingApi.importCsv(file));
      trainingApi.resetExercises();
    } catch (e) {
      setImportError(errorText(e));
    } finally {
      setImporting(false);
    }
  };

  const deleteAccount = async () => {
    if (!confirm("Konto i wszystkie dane zostaną trwale usunięte. Kontynuować?")) return;
    try {
      await authApi.deleteAccount(deletePassword);
      await logout().catch(() => {});
      window.location.href = "/login";
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Page icon={UserCog} title="Profil" description="Dane wykorzystywane przy doborze planu i przeliczaniu obciążeń."
      actions={<Button variant="outline" asChild><Link to="/ankieta"><ClipboardCheck className="mr-2 h-4 w-4" /> Oceń aplikację</Link></Button>}>
      <AvatarCard />
      <Card>
        <CardHeader>
          <CardTitle>Profil treningowy</CardTitle>
          <CardDescription>Na tej podstawie system ocenia zgodność planów z Twoimi możliwościami.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Rok urodzenia">
            <Input type="number" min={1920} max={2020} value={profile.birth_year ?? ""}
              onChange={(e) => set({ birth_year: numOrNull(e.target.value) })} />
          </Field>
          <Field label="Płeć">
            <NativeSelect value={profile.sex} onChange={(e) => set({ sex: e.target.value })}>
              <option value="">Nie podano</option>
              <option value="K">Kobieta</option>
              <option value="M">Mężczyzna</option>
            </NativeSelect>
          </Field>
          <Field label="Wzrost [cm]">
            <Input type="number" min={100} max={250} value={profile.height_cm ?? ""}
              onChange={(e) => set({ height_cm: numOrNull(e.target.value) })} />
          </Field>
          <Field label="Poziom zaawansowania">
            <NativeSelect value={profile.level} onChange={(e) => set({ level: e.target.value })}>
              {meta.levels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Cel treningowy">
            <NativeSelect value={profile.goal} onChange={(e) => set({ goal: e.target.value })}>
              {meta.goals.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Dni treningowe w tygodniu">
            <Input type="number" min={1} max={7} value={profile.days_per_week}
              onChange={(e) => set({ days_per_week: Number(e.target.value) })} />
          </Field>
          <Field label="Domyślny zapis serii"
            hint="Klasycznie: ciężar × powtórzenia. RIR: ile powtórzeń zostało w zapasie (0 = do upadku). RPE: skala 1-10. W trakcie treningu zmienisz to osobno dla każdego ćwiczenia.">
            <NativeSelect value={profile.effort_scale} onChange={(e) => set({ effort_scale: e.target.value as "reps" | "rir" | "rpe" })}>
              <option value="reps">Klasycznie - same powtórzenia</option>
              <option value="rir">RIR - powtórzenia w zapasie</option>
              <option value="rpe">RPE - skala 1-10</option>
            </NativeSelect>
          </Field>
          <Field label="Najmniejszy przyrost obciążenia [kg]" hint="Do niego zaokrąglane są wyliczone ciężary.">
            <Input type="number" min={0.25} max={10} step={0.25} value={profile.load_increment}
              onChange={(e) => set({ load_increment: Number(e.target.value) })} />
          </Field>
          <div className="md:col-span-3">
            <span className="text-sm font-medium">Dostępny sprzęt</span>
            <div className="mt-2 flex flex-wrap gap-3">
              {meta.equipment.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={profile.equipment.includes(o.value)}
                    onCheckedChange={() => set({ equipment: toggle(profile.equipment, o.value) })} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Konto</CardTitle>
          <CardDescription>Adres e-mail służy do odzyskiwania hasła i nie jest widoczny dla innych użytkowników.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <Field label="E-mail">
            <Input className="w-72" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button variant="outline" onClick={saveEmail} disabled={!email || email === user?.email}>Zapisz e-mail</Button>
          {emailMsg && <span className="text-sm text-muted-foreground">{emailMsg}</span>}
        </CardContent>
        <CardContent className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <Field label="Obecne hasło">
            <PasswordInput className="w-48" autoComplete="current-password" value={pw.old_password}
              onChange={(e) => setPw({ ...pw, old_password: e.target.value })} />
          </Field>
          <Field label="Nowe hasło">
            <PasswordInput className="w-48" autoComplete="new-password" value={pw.new_password}
              onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          </Field>
          <Field label="Powtórz nowe hasło">
            <PasswordInput className="w-48" autoComplete="new-password" value={pw.new_password2}
              onChange={(e) => setPw({ ...pw, new_password2: e.target.value })} />
          </Field>
          <Button variant="outline" onClick={changePassword} disabled={!pw.old_password || !pw.new_password}>Zmień hasło</Button>
          {pwMsg && <span className="text-sm text-muted-foreground">{pwMsg}</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eye className="h-4 w-4" /> Prywatność</CardTitle>
          <CardDescription>
            Decydujesz, co widzą inni użytkownicy. Dane o zdrowiu, pomiary ciała, tętno i notatki z treningów nigdy
            nie są udostępniane. Wgląd autora planu w Twoje postępy ustawiasz osobno przy każdym sklonowanym planie.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={profile.profile_public}
              onCheckedChange={(v) => set({ profile_public: v, ...(v ? {} : { trainings_public: false }) })} />
            Profil publiczny - inni widzą nazwę użytkownika, poziom, cel i opublikowane plany
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={profile.share_workouts_default} onCheckedChange={(v) => set({ share_workouts_default: v })} />
            Udostępniaj nowe treningi w Społeczności (możesz zmienić przy każdym zapisie i w Historii)
          </label>
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Udostępnione treningi (ćwiczenia, serie, czas, objętość) widzą {profile.profile_public
              ? <strong className="text-foreground">wszyscy użytkownicy</strong>
              : <strong className="text-foreground">tylko osoby, z którymi obserwujecie się wzajemnie</strong>}.
            Notatki i tętno zawsze zostają prywatne.
          </p>
          <label className={`flex items-center gap-2 text-sm ${profile.profile_public ? "" : "opacity-50"}`}>
            <Switch checked={profile.trainings_public} disabled={!profile.profile_public}
              onCheckedChange={(v) => set({ trainings_public: v })} />
            Pokazuj na profilu podsumowanie treningów (liczba treningów, objętość tygodniowa, najlepsze 1RM)
          </label>
          {user && (
            <Link className="text-sm underline" to={`/uzytkownicy/${user.username}`}>Zobacz, jak widzą Cię inni</Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Timer className="h-4 w-4" /> Minutnik przerw</CardTitle>
          <CardDescription>
            Domyślna przerwa dotyczy ćwiczeń spoza planu - w planie każde ćwiczenie ma własną przerwę, którą
            możesz też zmienić w trakcie treningu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium">Domyślna przerwa: {fmtClock(profile.default_rest_seconds)}</span>
            <div className="flex flex-wrap gap-2">
              {REST_PRESETS.map((sec) => (
                <Button key={sec} size="sm" type="button" variant={profile.default_rest_seconds === sec ? "default" : "outline"}
                  onClick={() => set({ default_rest_seconds: sec })}>{fmtClock(sec)}</Button>
              ))}
              <Input className="w-28" type="number" min={10} max={900} step={5} aria-label="Własna przerwa w sekundach"
                value={profile.default_rest_seconds} onChange={(e) => set({ default_rest_seconds: Number(e.target.value) })} />
              <span className="self-center text-sm text-muted-foreground">s</span>
            </div>
          </div>
          <Field label="Krok przycisków − / + [s]">
            <NativeSelect className="w-32" value={profile.rest_step_seconds}
              onChange={(e) => set({ rest_step_seconds: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((v) => <option key={v} value={v}>{v} s</option>)}
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={profile.rest_auto_start} onCheckedChange={(v) => set({ rest_auto_start: v })} />
            Uruchamiaj przerwę automatycznie po zaliczeniu serii
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={profile.rest_sound} onCheckedChange={(v) => set({ rest_sound: v })} />
            Sygnał dźwiękowy na koniec przerwy
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={profile.rest_vibrate} onCheckedChange={(v) => set({ rest_vibrate: v })} />
            Wibracja na koniec przerwy (telefony z Androidem)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Ankieta zdrowotna</CardTitle>
          <CardDescription>
            Informacje o ograniczeniach to dane dotyczące zdrowia. Przetwarzamy je wyłącznie za Twoją wyraźną
            zgodą, tylko po to, aby ostrzegać o ćwiczeniach, które mogą obciążać wskazane obszary. Autorzy planów
            nigdy nie mają do nich dostępu. Zgodę możesz w każdej chwili cofnąć - dane zostaną wtedy usunięte.
            System nie stawia diagnoz i nie zastępuje konsultacji z lekarzem ani fizjoterapeutą.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={profile.health_consent}
              onCheckedChange={(v) => set({ health_consent: v === true, ...(v ? {} : { restrictions: [], health_notes: "" }) })} />
            <span>Wyrażam zgodę na przetwarzanie moich danych dotyczących zdrowia w celu doboru planu treningowego.</span>
          </label>
          {profile.health_consent && (
            <>
              <div>
                <span className="text-sm font-medium">Obszary wymagające ostrożności</span>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {meta.body_areas.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={profile.restrictions.includes(a.id)}
                        onCheckedChange={() => set({ restrictions: toggle(profile.restrictions, a.id) })} />
                      {a.name}
                    </label>
                  ))}
                </div>
              </div>
              <Field label="Uwagi (opcjonalnie)">
                <Textarea maxLength={1000} value={profile.health_notes}
                  onChange={(e) => set({ health_notes: e.target.value })} />
              </Field>
              {profile.health_consent_date && (
                <p className="text-xs text-muted-foreground">
                  Zgoda udzielona: {fmtDateTime(profile.health_consent_date)}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" /> Zapisz profil</Button>
        {saved && <span className="text-sm text-muted-foreground">Zapisano.</span>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Import historii treningów</CardTitle>
          <CardDescription>
            Plik CSV wyeksportowany z aplikacji Strong lub Hevy albo własny plik z kolumnami: date, exercise, weight,
            reps (opcjonalnie workout, rir, rpe, warmup). Ponowny import tego samego pliku nie tworzy duplikatów.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input type="file" accept=".csv,text/csv" disabled={importing} onChange={(e) => importFile(e.target.files?.[0])} />
          {importing && <p className="text-sm text-muted-foreground">Importowanie…</p>}
          <ErrorText>{importError}</ErrorText>
          {importResult && (
            <p className="text-sm">
              Rozpoznany format: {importResult.format}. Zaimportowano {importResult.sessions_created} treningów
              ({importResult.sets_created} serii); pominięto już istniejące: {importResult.sessions_skipped_duplicates},
              wiersze bez powtórzeń (np. cardio): {importResult.rows_skipped}.
              {importResult.exercises_created.length > 0 && ` Dodano ćwiczenia własne: ${importResult.exercises_created.join(", ")}.`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Twoje dane</CardTitle>
          <CardDescription>Możesz pobrać kopię wszystkich danych albo trwale usunąć konto.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Button variant="outline" asChild>
            <a href="/api/auth/export/"><Download className="mr-2 h-4 w-4" /> Pobierz dane (JSON)</a>
          </Button>
          <div className="flex items-end gap-2">
            <Field label="Hasło (potwierdzenie usunięcia)">
              <PasswordInput value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
            </Field>
            <Button variant="destructive" disabled={!deletePassword} onClick={deleteAccount}>
              <Trash2 className="mr-2 h-4 w-4" /> Usuń konto
            </Button>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
