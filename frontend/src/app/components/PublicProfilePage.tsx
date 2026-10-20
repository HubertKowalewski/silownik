// Profil użytkownika widziany przez innych, zgodnie z jego ustawieniami widoczności (WF-04, WF-21).
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Lock, UserCircle } from "lucide-react";
import { PublicProfile, trainingApi } from "../../lib/api";
import { ErrorText, Page, Spinner } from "./common";
import { fmtDate, fmtKg } from "../../lib/format";
import { PlanCard } from "./PlansPage";
import { useMeta } from "../../lib/hooks";
import { Avatar } from "./Avatar";

export function PublicProfilePage() {
  const { username = "" } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const meta = useMeta();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(null);
    setError(null);
    trainingApi.publicProfile(username).then(setProfile)
      .catch((e) => setError(e.status === 404 ? "Ten profil nie istnieje albo jest prywatny." : e.message));
  }, [username]);

  if (!profile) return error ? <Page icon={UserCircle} title={username}><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  return (
    <Page icon={UserCircle} title={profile.username} description={`W serwisie od ${fmtDate(profile.member_since)} · ${profile.level} · cel: ${profile.goal.toLowerCase()}`}>
      <div className="flex items-center gap-4">
        <Avatar name={profile.username} url={profile.avatar_url} size="xl" className="ring-4 ring-primary/15" />
        <div className="min-w-0">
          <p className="font-display text-2xl font-bold leading-tight">{profile.username}</p>
          <p className="text-sm text-muted-foreground">{profile.level} · {profile.goal}</p>
        </div>
      </div>
      {profile.is_own && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          Tak Twój profil widzą inni użytkownicy{profile.profile_public ? "" : " - obecnie jest prywatny i nikt poza Tobą go nie widzi"}.
          Zmienisz to w <Link className="underline" to="/profil">ustawieniach profilu</Link>.
        </p>
      )}

      {profile.trainings ? (
        <Card>
          <CardHeader>
            <CardTitle>Aktywność</CardTitle>
            <CardDescription>
              {profile.trainings.total_sessions} treningów łącznie · {profile.trainings.sessions_30_days} w ostatnich 30 dniach
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="h-40">
              {profile.trainings.weekly_tonnage.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profile.trainings.weekly_tonnage}>
                    <XAxis dataKey="week" fontSize={11} />
                    <Tooltip formatter={(v) => [fmtKg(Number(v), 0), "Objętość"]} />
                    <Bar dataKey="tonnage" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground">Brak treningów w ostatnich tygodniach.</p>}
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Najlepsze 1RM</p>
              {profile.trainings.records.length === 0 && <p className="text-muted-foreground">Brak danych.</p>}
              {profile.trainings.records.map((r) => (
                <div key={r.exercise} className="flex justify-between gap-2">
                  <span className="truncate">{r.exercise.split(" / ")[0]}</span><strong>{fmtKg(r.e1rm)}</strong>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> Treningi tego użytkownika są prywatne.</p>
      )}

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">Opublikowane plany <Badge variant="secondary">{profile.plans.length}</Badge></h2>
        {profile.plans.length === 0 && <p className="text-sm text-muted-foreground">Brak opublikowanych planów.</p>}
        {profile.plans.map((p) => <PlanCard key={p.id} plan={p} meta={meta} />)}
      </div>
    </Page>
  );
}
