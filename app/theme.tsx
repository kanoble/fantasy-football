"use client";

import { useEffect, useState } from "react";

import { THEME_KEY, type Theme } from "@/lib/theme";

/**
 * The light/dark control.
 *
 * Three states, not two. "System" is the *absence* of `data-theme`, which is
 * what lets `prefers-color-scheme` keep deciding — so it has to be a real
 * option rather than an initial value the first click destroys. A control that
 * stamps a value on first paint has silently opted everyone out of following
 * their OS.
 *
 * The attribute is set by `THEME_SCRIPT` in `lib/theme.ts` before anything
 * renders. This component only reads it back and writes changes; it
 * deliberately does not set the initial value, because by the time React runs
 * the correct theme is already on screen.
 */

const OPTIONS: { id: Theme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function ThemeToggle() {
  // "system" until proven otherwise: it is what the pre-paint script leaves the
  // document in when nothing is stored, and it is the honest default.
  const [theme, setTheme] = useState<Theme>("system");

  // Read what the pre-paint script already decided. This runs after hydration
  // on purpose — rendering the stored value on the server would mean shipping
  // markup that disagrees with whatever this particular browser has stored.
  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    if (stored === "dark" || stored === "light") setTheme(stored);
  }, []);

  function choose(next: Theme) {
    setTheme(next);

    if (next === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = next;
    }

    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage is blocked. The choice still applies to this page; it just
      // will not survive a reload, which is better than failing the click.
    }
  }

  return (
    <div className="themer" role="group" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={theme === option.id}
          onClick={() => choose(option.id)}
          title={
            option.id === "system"
              ? "Follow the system setting"
              : `Always ${option.id}`
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
