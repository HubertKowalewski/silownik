// Zdjęcie profilowe użytkownika; bez zdjęcia (albo gdy się nie wczyta) - inicjały na fioletowym tle.
import { useState } from "react";
import { cn } from "./ui/utils";

const SIZES = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-xl", xl: "h-24 w-24 text-3xl" };

export function initials(name: string) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2);
  return (letters || "?").toUpperCase();
}

export function Avatar({ name, url, size = "md", className }: {
  name: string; url?: string | null; size?: keyof typeof SIZES; className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = url && failed !== url;
  return (
    <span className={cn("relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
      SIZES[size], !showImage && "brand-gradient font-semibold text-white", className)}>
      {showImage
        ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} onError={() => setFailed(url)} />
        : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  );
}
