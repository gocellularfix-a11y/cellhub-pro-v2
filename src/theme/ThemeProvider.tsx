import { useEffect, useState } from 'react';
import { DEFAULT_THEME, THEME_STORAGE_KEY, type ThemeId } from './themes';

/**
 * Minimal theme provider — applies data-theme attribute to <html>.
 * Reads from localStorage on mount, writes on change.
 * No React context needed — CSS vars do the work.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    return saved && ['dark', 'original', 'bold-light'].includes(saved)
      ? saved
      : DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return <>{children}</>;
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    return saved && ['dark', 'original', 'bold-light'].includes(saved)
      ? saved
      : DEFAULT_THEME;
  });

  const applyTheme = (t: ThemeId) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(THEME_STORAGE_KEY, t);
    setTheme(t);
  };

  return { theme, setTheme: applyTheme } as const;
}
