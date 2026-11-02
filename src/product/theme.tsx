"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const storageKey = "orbit-theme";
const updateEvent = "orbit-theme-change";
let sessionTheme: Theme | null = null;

function currentTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Browser privacy settings may make storage unavailable. */
  }
  if (sessionTheme) return sessionTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", callback);
  window.addEventListener(updateEvent, callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(updateEvent, callback);
    media.removeEventListener("change", callback);
  };
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** Optional single provider; individual controls also synchronize the document. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(
    subscribe,
    currentTheme,
    () => "light" as Theme,
  );
  useEffect(() => applyTheme(currentTheme()), [theme]);
  return children;
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(
    subscribe,
    currentTheme,
    () => "light" as Theme,
  );
  useEffect(() => applyTheme(currentTheme()), [theme]);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? "compact" : ""}`}
      aria-label={`Switch to ${next} theme`}
      aria-pressed={theme === "dark"}
      title={`Switch to ${next} theme`}
      onClick={() => {
        sessionTheme = next;
        try {
          window.localStorage.setItem(storageKey, next);
        } catch {
          /* Keep the chosen theme for this document. */
        }
        applyTheme(next);
        window.dispatchEvent(new Event(updateEvent));
      }}
    >
      {theme === "dark" ? (
        <Sun size={16} strokeWidth={1.7} />
      ) : (
        <Moon size={16} strokeWidth={1.7} />
      )}
      {!compact && (
        <span>{theme === "dark" ? "Light appearance" : "Dark appearance"}</span>
      )}
    </button>
  );
}
