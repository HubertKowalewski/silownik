// Karta „Zdjęcie profilowe” w profilu: wybór zdjęcia (także prosto z aparatu telefonu), podgląd, usunięcie.
// Duże zdjęcia są zmniejszane w przeglądarce przed wysłaniem - mniej danych komórkowych i szybsza wysyłka;
// serwer i tak kadruje je do kwadratu 256 px.
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { errorText, trainingApi } from "../../lib/api";
import { toast } from "../../lib/toast";
import { useAuth } from "./AuthProvider";
import { Avatar } from "./Avatar";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const MAX_SIDE = 1024;

/** Zmniejsza zdjęcie do MAX_SIDE px (JPEG); przy błędzie albo małym pliku zwraca oryginał. */
async function shrink(file: File): Promise<Blob> {
  if (file.size < 600_000 || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";           // przezroczyste PNG -> białe tło zamiast czarnego w JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export function AvatarCard() {
  const { user, updateUser } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Wybierz plik ze zdjęciem (JPG, PNG, WebP).");
    setBusy(true);
    try {
      const { avatar_url } = await trainingApi.uploadAvatar(await shrink(file), "zdjecie.jpg");
      updateUser({ avatar_url });
      toast("Zapisano zdjęcie profilowe.");
    } catch (e) {
      setError(errorText(e, "Nie udało się wysłać zdjęcia."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await trainingApi.deleteAvatar();
      updateUser({ avatar_url: null });
      toast("Usunięto zdjęcie profilowe.");
    } catch (e) {
      setError(errorText(e, "Nie udało się usunąć zdjęcia."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zdjęcie profilowe</CardTitle>
        <CardDescription>Widoczne w aplikacji i dla innych zalogowanych osób - przy Twoich komentarzach i na profilu publicznym.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="relative">
          <Avatar name={user.username} url={user.avatar_url} size="xl" className="ring-4 ring-primary/15" />
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </span>
          )}
        </div>
        <div className="space-y-2">
          <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Plik zdjęcia profilowego"
            onChange={(e) => choose(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => input.current?.click()} disabled={busy}>
              <Camera className="mr-2 h-4 w-4" /> {user.avatar_url ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
            </Button>
            {user.avatar_url && (
              <Button variant="outline" onClick={remove} disabled={busy}>
                <Trash2 className="mr-2 h-4 w-4" /> Usuń
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG lub WebP. Zdjęcie zostanie wykadrowane do kwadratu.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
