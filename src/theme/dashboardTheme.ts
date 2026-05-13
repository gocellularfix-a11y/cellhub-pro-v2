// ============================================================
// R-DASHBOARD-THEME-V1
//
// User-selectable interface "look" — the dashboard's visual skin.
// Distinct from the color theme (`useTheme()` / THEMES — light/dark/etc),
// this is the LAYOUT skin: sidebar style + stat-card style.
//
// Three options at launch:
//   - 'tiles'        : current production (colored module-grid sidebar)
//   - 'list'         : original pre-redesign (simple list sidebar)
//   - 'bold-blocks'  : saturated color blocks dashboard (Apple Numbers feel)
//
// Stored in `settings.dashboardTheme` via the double-cast pattern so we
// don't have to extend StoreSettings types (CLAUDE.md rule: don't touch
// src/store/ without explicit permission).
// ============================================================

export type DashboardTheme = 'tiles' | 'list' | 'bold-blocks';

export const DEFAULT_DASHBOARD_THEME: DashboardTheme = 'tiles';

export const DASHBOARD_THEMES: DashboardTheme[] = ['tiles', 'list', 'bold-blocks'];

/**
 * Read the dashboard theme from settings with a safe default.
 *
 * Uses the double-cast pattern per CLAUDE.md — settings is typed as
 * StoreSettings which does not declare `dashboardTheme`, so we read it
 * as an unknown record and narrow back to the union.
 */
export function readDashboardTheme(settings: unknown): DashboardTheme {
  const raw = (settings as Record<string, unknown> | undefined)?.dashboardTheme;
  if (raw === 'tiles' || raw === 'list' || raw === 'bold-blocks') return raw;
  return DEFAULT_DASHBOARD_THEME;
}

/**
 * Locale-aware label for a theme key. Used in Settings UI.
 */
export function dashboardThemeLabel(theme: DashboardTheme, locale: string): string {
  const dict: Record<DashboardTheme, Record<string, string>> = {
    tiles: {
      en: 'Tiles',
      es: 'Botones',
      pt: 'Botões',
    },
    list: {
      en: 'Classic List',
      es: 'Lista Clásica',
      pt: 'Lista Clássica',
    },
    'bold-blocks': {
      en: 'Bold Blocks',
      es: 'Bloques de Color',
      pt: 'Blocos Coloridos',
    },
  };
  return dict[theme][locale] || dict[theme].en;
}
