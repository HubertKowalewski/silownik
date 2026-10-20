// Przycisk obserwowania z trzema stanami: „Obserwuj”, „Obserwuj też” (ta osoba obserwuje mnie) i „Obserwujesz”.
import { useState } from "react";
import { Check, UserPlus, Users } from "lucide-react";
import { errorText, Relation, trainingApi } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { Button } from "../ui/button";

export function FollowButton({ username, relation, onChange, size = "sm" }: {
  username: string;
  relation: Pick<Relation, "i_follow" | "follows_me" | "mutual">;
  onChange?: (r: Relation & { followers?: number; following?: number }) => void;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const r = relation.i_follow ? await trainingApi.unfollow(username) : await trainingApi.follow(username);
      onChange?.(r);
      if (r.mutual && !relation.i_follow) toast(`Obserwujecie się wzajemnie z ${username}.`);
    } catch (e) {
      toast(errorText(e, "Nie udało się zmienić obserwowania."), "error");
    } finally {
      setBusy(false);
    }
  };
  if (relation.i_follow) {
    return (
      <Button size={size} variant="outline" disabled={busy} onClick={toggle} title="Kliknij, aby przestać obserwować"
        aria-label={`Przestań obserwować ${username}`}>
        {relation.mutual ? <Users className="mr-1.5 h-4 w-4" /> : <Check className="mr-1.5 h-4 w-4" />}
        {relation.mutual ? "Obserwujecie się" : "Obserwujesz"}
      </Button>
    );
  }
  return (
    <Button size={size} disabled={busy} onClick={toggle} aria-label={`Obserwuj ${username}`}>
      <UserPlus className="mr-1.5 h-4 w-4" /> {relation.follows_me ? "Obserwuj też" : "Obserwuj"}
    </Button>
  );
}
