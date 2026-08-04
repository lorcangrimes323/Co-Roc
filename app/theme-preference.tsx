"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const themeModes: ThemeMode[] = ["light", "dark", "system"];

const themeStorageKey = "rocket-theme";

function storedTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const value = window.localStorage.getItem(themeStorageKey);
  return value === "light" || value === "dark" || value === "system" ? value : "dark";
}

function subscribeTheme(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === themeStorageKey) listener(); };
  window.addEventListener("storage", storage);
  window.addEventListener("rocket-theme-change", listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("rocket-theme-change", listener);
  };
}

function subscribeColourScheme(listener: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function resolvedTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

export function useThemePreference() {
  const mode = useSyncExternalStore(subscribeTheme, storedTheme, () => "dark" as ThemeMode);
  const prefersDark = useSyncExternalStore(subscribeColourScheme, () => window.matchMedia("(prefers-color-scheme: dark)").matches, () => false);
  const resolved = resolvedTheme(mode, prefersDark);
  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(themeStorageKey, next);
    window.dispatchEvent(new Event("rocket-theme-change"));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
  }, [mode, resolved]);

  return { mode, resolved, setMode };
}

const themeDetails: Record<ThemeMode, { label: string; detail: string }> = {
  light: { label: "Light", detail: "Bright workspace" },
  dark: { label: "Dark", detail: "Low-glare workspace" },
  system: { label: "System", detail: "Follow this device" },
};

export function ThemeModeSelector({ value, onChange, compact = false, label = "Colour mode" }: {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  compact?: boolean;
  label?: string;
}) {
  return (
    <div className={`theme-mode-selector ${compact ? "theme-mode-selector-compact" : ""}`} role="group" aria-label={label}>
      {themeModes.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-label={`${themeDetails[mode].label} theme`}
          aria-pressed={value === mode}
          className={value === mode ? "theme-mode-active" : ""}
          onClick={() => onChange(mode)}
        >
          <span className={`theme-preview theme-preview-${mode}`} aria-hidden="true"><i /><b /></span>
          <span className="theme-choice-copy"><strong>{themeDetails[mode].label}</strong>{!compact && <small>{themeDetails[mode].detail}</small>}</span>
        </button>
      ))}
    </div>
  );
}
