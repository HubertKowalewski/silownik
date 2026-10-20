// Pole hasła z przyciskiem podglądu (oko): kropki albo czytelny tekst.
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { cn } from "./utils";

export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className={cn("relative", className)}>
      <Input {...props} type={visible ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        className="pr-10" />
      <button type="button"
        aria-label={visible ? "Ukryj hasło" : "Pokaż hasło"} aria-pressed={visible} title={visible ? "Ukryj hasło" : "Pokaż hasło"}
        // preventDefault: pole bywa w <label> - kliknięcie nie może przenosić fokusu ani wysyłać formularza
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { e.preventDefault(); setVisible((v) => !v); }}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
