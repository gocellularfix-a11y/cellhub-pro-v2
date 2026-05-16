export type ThemeId = 'dark' | 'original' | 'bold-light';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  labelEs: string;
  labelPt: string;
  preview: string; // hex for UI preview swatch
}

export const THEMES: ThemeOption[] = [
  { id: 'dark',       label: 'Dark',       labelEs: 'Oscuro',    labelPt: 'Escuro',    preview: '#0f172a' },
  { id: 'original',   label: 'Original',   labelEs: 'Original',  labelPt: 'Original',  preview: '#2a1f5f' },
  { id: 'bold-light', label: 'Bold Light', labelEs: 'Claro Bold', labelPt: 'Claro Bold', preview: '#F4F5F7' },
];

export const DEFAULT_THEME: ThemeId = 'dark';
export const THEME_STORAGE_KEY = 'cellhub_theme';
