// Profil użytkownika widziany przez innych, zgodnie z jego ustawieniami widoczności (WF-04, WF-21):
// obserwowanie, liczniki, udostępnione treningi, aktywność i opublikowane plany. Profil prywatny pokazuje
// innym tylko nazwę i zdjęcie; osoby obserwowane wzajemnie widzą także udostępnione treningi.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Loader2, Lock, UserCircle } from "lucide-react";
import { FeedItem, PublicProfile, trainingApi } from "../../lib/api";
import { fmtDate, fmtKg } from "../../lib/format";
import { useMeta } from "../../lib/hooks";
import { Avatar } from "./Avatar";
import { ErrorText, Page, Spinner } from "./common";
import { PlanCard } from "./PlansPage";
import { FeedCard } from "./social/FeedCard";
import { FollowButton } from "./social/FollowButton";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

function Workouts({ username }: { username: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (before: string | null) => {
    setLoading(true);
    try {
      const page = await trainingApi.userWorkouts(username, before);
      setItems((prev) => (before && prev ? [...prev, ...page.results] : page.results));
      setNext(page.next);
    } catch {
      setItems((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, [username]);
  useEffect(() => { void load(null); }, [load]);

  if (items === null) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Brak udostępnionych treningów.</p>;
  return (
    <div className="space-y-4">
      {items.map((item) => <FeedCard key={item.id} item={item} showAuthor={false} />)}
      {next && (
        <Button variant="outline" className="w-full" disabled={loading} onClick={() => load(next)}>Pokaż starsze treningi</Button>
      )}
    </div>
  );
}

export function PublicProfilePage() {
  const { username = "" } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const meta = useMeta();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(null);
    setError(null);
    trainingApi.publicProfile(username).then(setProfile)
      .catch((e) => setError(e.status === 404 ? "Nie ma takiego użytkownika." : e.message));
  }, [username]);

  if (!profile) return error ? <Page icon={UserCircle} title={username}><ErrorText>{error}</ErrorText></Page> : <Spinner />;

  const rel = profile.relation;
  const details = profile.restricted ? "Profil prywatny"
    : `W serwisie od ${fmtDate(profile.member_since!)} · ${profile.level} · cel: ${profile.goal?.toLowerCase()}`;

  return (
    <Page icon={UserCircle} title={profile.username} description={details}>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <Avatar name={profile.username} url={profile.avatar_url} size="xl" className="ring-4 ring-primary/15" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-2xl font-bold leading-tight">{profile.username}</p>
              {rel.mutual && <Badge variant="secondary">obserwujecie się</Badge>}
              {!rel.mutual && rel.follows_me && <Badge variant="secondary">obserwuje Cię</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{profile.counts.followers}</strong> {profile.counts.followers === 1 ? "obserwujący" : "obserwujących"}
              {" · "}
              <strong className="text-foreground">{profile.counts.following}</strong> obserwowanych
            </p>
            {!profile.is_own && (
              <FollowButton username={profile.username} relation={rel}
                onChange={(r) => setProfile({ ...profile, relation: r,
                  can_see_workouts: !profile.restricted || r.mutual,
                  counts: { followers: r.followers ?? profile.counts.followers, following: profile.counts.following } })} />
            )}
          </div>
        </CardContent>
      </Card>

      {profile.is_own && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          Tak Twój profil widzą inni{profile.profile_public ? "" : " - jest prywatny: inni widzą tylko nazwę i zdjęcie, a udostępnione treningi tylko osoby, z którymi obserwujecie się wzajemnie"}.
          Zmienisz to w <Link className="underline" to="/profil">ustawieniach profilu</Link>.
        </p>
      )}

      <section className="max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">Treningi</h2>
        {profile.can_see_workouts ? <Workouts username={profile.username} /> : (
          <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Profil prywatny - treningi zobaczysz, gdy będziecie się obserwować wzajemnie.
          </p>
        )}
      </section>

      {!profile.restricted && profile.trainings && (
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
      )}

      {!profile.restricted && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">Opublikowane plany <Badge variant="secondary">{profile.plans.length}</Badge></h2>
          {profile.plans.length === 0 && <p className="text-sm text-muted-foreground">Brak opublikowanych planów.</p>}
          {profile.plans.map((p) => <PlanCard key={p.id} plan={p} meta={meta} />)}
        </div>
      )}
    </Page>
  );
}
