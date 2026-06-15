import { useEffect, useState } from "react";
import { Moon, Scroll, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export type ThemeId = "noir" | "sepia" | "aurora";

const STORAGE_KEY = "nr-theme";

const THEMES: Array<{
  id: ThemeId;
  name: string;
  hint: string;
  Icon: typeof Moon;
  swatch: string;
}> = [
  { id: "noir", name: "Noir & Gold", hint: "Tinta e dourado",  Icon: Moon,     swatch: "linear-gradient(135deg, #0d0d0d 50%, #c9a84c 50%)" },
  { id: "sepia", name: "Pergaminho", hint: "Sépia para leitura",  Icon: Scroll,   swatch: "linear-gradient(135deg, #f0ebe3 50%, #6b3a2a 50%)" },
  { id: "aurora", name: "Aurora", hint: "Meia-noite + neon",  Icon: Sparkles, swatch: "linear-gradient(135deg, #0a0a1a 50%, #67e8f9 50%)" },
];

export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === "noir") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}

export function getInitialTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "noir" || raw === "sepia" || raw === "aurora") return raw;
  } catch { /* ignore */ }
  return "noir";
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeId>("noir");

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const Current = THEMES.find(t => t.id === theme) ?? THEMES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-lg text-muted-foreground hover:text-primary"
          title={`Tema: ${Current.name}`}
          aria-label="Mudar tema"
        >
          <Current.Icon className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-display tracking-wide text-xs uppercase text-muted-foreground">
          Atmosfera de leitura
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map(({ id, name, hint, Icon, swatch }) => (
          <DropdownMenuItem
            key={id}
            onSelect={() => { applyTheme(id); setTheme(id); }}
            className="gap-3 cursor-pointer py-2.5"
          >
            <span
              className="h-6 w-6 rounded-md ring-1 ring-border/60 shrink-0"
              style={{ backgroundImage: swatch }}
              aria-hidden="true"
            />
            <span className="flex-1">
              <span className="block font-display text-sm leading-tight">{name}</span>
              <span className="block text-[10px] text-muted-foreground">{hint}</span>
            </span>
            {theme === id && <Icon className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}