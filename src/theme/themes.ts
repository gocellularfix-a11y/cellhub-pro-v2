export type ThemeId = 'dark' | 'light' | 'ocean' | 'sunset';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  labelEs: string;
  labelPt: string;
  preview: string; // hex for UI preview swatch
}

export const THEMES: ThemeOption[] = [
  { id: 'dark',   label: 'Dark',   labelEs: 'Oscuro',   labelPt: 'Escuro',     preview: '#0f172a' },
  { id: 'light',  label: 'Light',  labelEs: 'Claro',    labelPt: 'Claro',      preview: '#f8fafc' },
  { id: 'ocean',  label: 'Ocean',  labelEs: 'Océano',   labelPt: 'Oceano',     preview: '#0c1929' },
  { id: 'sunset', label: 'Sunset', labelEs: 'Atardecer', labelPt: 'Pôr do Sol', preview: '#1a0a0a' },
];

export const DEFAULT_THEME: ThemeId = 'dark';
export const THEME_STORAGE_KEY = 'cellhub_theme';
