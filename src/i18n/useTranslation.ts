import { useCallback } from 'react';
import { useApp } from '../store/AppProvider';
import { translations } from './translations';
import type { Locale } from './types';

/**
 * Hook that returns a `t()` function bound to the current locale.
 *
 * Usage:
 *   const { t, locale } = useTranslation();
 *   <button>{t('common.save')}</button>
 *   <span>{t('common.tax_rate', taxRate.toFixed(2))}</span>
 *
 * Fallback chain: requested locale → 'en' → key itself
 * This means missing PT translations gracefully fall back to English.
 */
export function useTranslation() {
  const { state } = useApp();

  const locale: Locale = state.lang;

  const t = useCallback(
    (key: string, ...args: any[]): string => {
      const entry = translations[key];

      if (!entry) {
        // Key not found — return key itself as fallback (easy to spot in UI)
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[i18n] Missing key: "${key}"`);
        }
        return key;
      }

      // Try requested locale, fallback to 'en'
      const value = entry[locale] ?? entry.en;

      // If it's a function (interpolation), call it with args
      if (typeof value === 'function') {
        return value(...args);
      }

      return value;
    },
    [locale],
  );

  return { t, locale } as const;
}
