// Społeczność: tablica udostępnionych treningów (wszystkie / obserwowani) i ludzie (wyszukiwanie, obserwowani,
// obserwujący). Zasady widoczności - backend/training/social.py.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Globe, Loader2, Lock, Search, UserRound, Users } from "lucide-react";
import { errorText, FeedItem, Person, trainingApi } from "../../../lib/api";
import { Avatar } from "../Avatar";
import { ErrorText, Page } from "../common";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { FeedCard } from "./FeedCard";
import { FollowButton } from "./FollowButton";

type Tab = "all" | "following" | "people";

function Feed({ tab }: { tab: "all" | "following" }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await trainingApi.feed(tab, before);
      setItems((prev) => (before && prev ? [...prev, ...page.results] : page.results));
      setNext(page.next);
    } catch (e) {
      setError(errorText(e, "Nie udało się wczytać tablicy."));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(null); }, [load]);

  if (items === null) return error ? <ErrorText>{error}</ErrorText> : <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <Users className="mx-auto h-10 w-10 text-primary/60" />
          {tab === "following" ? (
            <>
              <p className="font-medium">Brak treningów od obserwowanych osób</p>
              <p className="text-sm text-muted-foreground">Znajdź znajomych w zakładce „Ludzie” i zacznij ich obserwować.</p>
            </>
          ) : (
            <>
              <p className="font-medium">Nikt jeszcze nie udostępnił treningu</p>
              <p className="text-sm text-muted-foreground">Bądź pierwszy - przy zapisie treningu zostaw włączone „Udostępnij trening”.</p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => <FeedCard key={item.id} item={item} />)}
      {error && <ErrorText>{error}</ErrorText>}
      {next && (
        <Button variant="outline" className="w-full" disabled={loading} onClick={() => load(next)}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Pokaż starsze treningi
        </Button>
      )}
    </div>
  );
}

function PersonRow({ person, onChange }: { person: Person; onChange?: () => void }) {
  const [p, setP] = useState(person);
  useEffect(() => setP(person), [person]);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link to={`/uzytkownicy/${encodeURIComponent(p.username)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={p.username} url={p.avatar_url} size="md" />
        <span className="min-w-0">
          <span className="block truncate font-medium">{p.username}</span>
          <span className="flex flex-wrap gap-1 text-xs text-muted-foreground">
            {!p.profile_public && <span className="inline-flex items-center gap-0.5"><Lock className="h-3 w-3" /> profil prywatny</span>}
            {p.follows_me && !p.mutual && <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">obserwuje Cię</Badge>}
          </span>
        </span>
      </Link>
      <FollowButton username={p.username} relation={p} onChange={(r) => { setP({ ...p, ...r }); onChange?.(); }} />
    </li>
  );
}

function People() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [following, setFollowing] = useState<Person[]>([]);
  const [followers, setFollowers] = useState<Person[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const loadLists = useCallback(() => {
    trainingApi.people({ list: "following" }).then(setFollowing).catch(() => undefined);
    trainingApi.people({ list: "followers" }).then(setFollowers).catch(() => undefined);
  }, []);
  useEffect(loadLists, [loadLists]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) return setResults(null);
    timer.current = setTimeout(() => {
      trainingApi.people({ q: query.trim() }).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query]);

  const section = (title: string, list: Person[], empty: string) => (
    <Card>
      <CardContent className="pt-5">
        <p className="mb-1 text-sm font-semibold">{title} <span className="font-normal text-muted-foreground">({list.length})</span></p>
        {list.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{empty}</p>
          : <ul className="divide-y divide-border">{list.map((p) => <PersonRow key={p.username} person={p} onChange={loadLists} />)}</ul>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-5">
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-input-background px-3 text-sm focus-within:ring-2 focus-within:ring-ring/50 dark:bg-input/30">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              placeholder="Szukaj po nazwie użytkownika" value={query} onChange={(e) => setQuery(e.target.value)}
              aria-label="Szukaj ludzi" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <p className="text-xs text-muted-foreground">Profile prywatne znajdziesz, wpisując pełną nazwę użytkownika.</p>
          {results && (results.length === 0
            ? <p className="py-2 text-sm text-muted-foreground">Nie znaleziono nikogo o nazwie „{query}”.</p>
            : <ul className="divide-y divide-border">{results.map((p) => <PersonRow key={p.username} person={p} onChange={loadLists} />)}</ul>)}
        </CardContent>
      </Card>
      {section("Obserwujesz", following, "Nie obserwujesz jeszcze nikogo.")}
      {section("Obserwują Cię", followers, "Nikt Cię jeszcze nie obserwuje.")}
    </div>
  );
}

export function CommunityPage() {
  const [params, setParams] = useSearchParams();
  const tab = (["all", "following", "people"].includes(params.get("tab") ?? "") ? params.get("tab") : "all") as Tab;
  const [profilePublic, setProfilePublic] = useState<boolean | null>(null);

  useEffect(() => {
    trainingApi.profile().then((p) => setProfilePublic(p.profile_public)).catch(() => undefined);
  }, []);

  return (
    <Page icon={Users} title="Społeczność" description="Treningi udostępnione przez innych - od najnowszych.">
      <div className="mx-auto max-w-2xl space-y-4">
      {profilePublic !== null && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {profilePublic ? <Globe className="mt-px h-3.5 w-3.5 shrink-0" /> : <Lock className="mt-px h-3.5 w-3.5 shrink-0" />}
          <span>
            Twoje udostępnione treningi widzą {profilePublic ? <strong className="text-foreground">wszyscy</strong>
              : <strong className="text-foreground">tylko osoby, z którymi obserwujecie się wzajemnie</strong>}.{" "}
            <Link to="/profil" className="underline">Zmień w profilu</Link>
          </span>
        </p>
      )}
      <Tabs value={tab} onValueChange={(v) => setParams(v === "all" ? {} : { tab: v }, { replace: true })}>
        <TabsList className="w-full">
          <TabsTrigger value="all"><Globe className="mr-1 h-4 w-4 sm:mr-2" /> Wszystkie</TabsTrigger>
          <TabsTrigger value="following"><Users className="mr-1 h-4 w-4 sm:mr-2" /> Obserwowani</TabsTrigger>
          <TabsTrigger value="people"><UserRound className="mr-1 h-4 w-4 sm:mr-2" /> Ludzie</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">{tab === "all" && <Feed tab="all" />}</TabsContent>
        <TabsContent value="following" className="mt-4">{tab === "following" && <Feed tab="following" />}</TabsContent>
        <TabsContent value="people" className="mt-4">{tab === "people" && <People />}</TabsContent>
      </Tabs>
      </div>
    </Page>
  );
}
