"use client";

import { useEffect, useState } from "react";
import { Leaf, Moon, Sun } from "lucide-react";

export type Theme = "clover" | "light" | "dark";

const THEMES: Array<{ id: Theme; label: string; icon: typeof Leaf }> = [
  { id: "clover", label: "Čtyřlístkové", icon: Leaf },
  { id: "light", label: "Světlé", icon: Sun },
  { id: "dark", label: "Tmavé", icon: Moon },
];

/**
 * Three-button theme switcher. The actual `data-theme` is already set
 * by ThemeScript before paint, but the React state needs to catch up
 * once mounted so the active button highlight matches reality. Until
 * then we render the default ("clover") highlight — which is also
 * what the inline script falls back to on a fresh visit.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("clover");

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? (localStorage.getItem("theme") as Theme | null)
        : null;
    if (stored === "clover" || stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  const change = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignored — Safari private mode etc. */
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Motiv"
      className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-0.5"
    >
      {THEMES.map(({ id, label, icon: Icon }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => change(id)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded transition ${
              active
                ? "bg-brand-100 text-brand-700"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
