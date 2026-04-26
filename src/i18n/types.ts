import type { Lang } from '../store/types';

export type Locale = Lang | 'pt';

// Translation value: either a plain string or a function for interpolation
export type TranslationValue = string | ((...args: any[]) => string);

// A translation entry has all 3 locales, en is required as fallback
export type TranslationEntry = {
  en: TranslationValue;
  es: TranslationValue;
  pt: TranslationValue;
};

// The full dictionary keyed by dot-notation keys
export type TranslationDictionary = Record<string, TranslationEntry>;
