// ============================================================
// CellHub Pro — useAutocomplete hook
// Generic autocomplete with fuzzy matching + keyboard nav
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

export interface AutocompleteOption {
  value: string;
  label: string;
  sublabel?: string;
  icon?: string;
  data?: any;
}

interface UseAutocompleteOptions {
  options: AutocompleteOption[];
  query: string;
  maxResults?: number;
  minQueryLength?: number;
  /** If true, will match from start of string only */
  startsWith?: boolean;
}

interface UseAutocompleteReturn {
  results: AutocompleteOption[];
  isOpen: boolean;
  activeIndex: number;
  open: () => void;
  close: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  selectOption: (option: AutocompleteOption) => void;
  setActiveIndex: (i: number) => void;
}

export function useAutocomplete(
  { options, query, maxResults = 8, minQueryLength = 1, startsWith = false }: UseAutocompleteOptions,
  onSelect: (option: AutocompleteOption) => void,
): UseAutocompleteReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < minQueryLength) return [];

    const filtered = options.filter((opt) => {
      const haystack = `${opt.label} ${opt.sublabel || ''}`.toLowerCase();
      if (startsWith) return haystack.startsWith(q) || opt.label.toLowerCase().startsWith(q);
      return haystack.includes(q);
    });

    // Sort: exact start matches first, then contains
    filtered.sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    });

    return filtered.slice(0, maxResults);
  }, [options, query, maxResults, minQueryLength, startsWith]);

  const open = useCallback(() => { setIsOpen(true); setActiveIndex(0); }, []);
  const close = useCallback(() => { setIsOpen(false); setActiveIndex(0); }, []);

  // R-SEARCH-ARROW-NAV-FIX: keep activeIndex in bounds when the result
  // set shrinks/expands as the user keeps typing. Prevents Enter from
  // selecting a stale highlight that's no longer in the rendered list,
  // and prevents the visual highlight from disappearing off the bottom.
  useEffect(() => {
    if (results.length === 0) return;
    if (activeIndex < 0 || activeIndex >= results.length) {
      setActiveIndex(0);
    }
  }, [results.length, activeIndex]);

  const selectOption = useCallback((option: AutocompleteOption) => {
    onSelect(option);
    close();
  }, [onSelect, close]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // R-SEARCH-ARROW-NAV-FIX: removed the stale (!isOpen) guard. Whenever
    // results exist we accept Arrow / Enter regardless of whether the
    // consumer's open() effect has already flushed — first arrow press
    // after typing lands cleanly instead of being silently swallowed by
    // a not-yet-updated isOpen=false.
    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) setIsOpen(true);
      // Clamp instead of modulo wrap. Predictable edge UX: ArrowDown at
      // the last item stays at the last item. Math.max guards against a
      // negative starting index (defensive).
      setActiveIndex((i) => Math.min(Math.max(0, i) + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) setIsOpen(true);
      setActiveIndex((i) => Math.max(0, Math.min(i, results.length - 1) - 1));
    } else if (e.key === 'Enter') {
      // Bounds-safe fallback to index 0 so Enter picks the top
      // suggestion when the user types and presses Enter without
      // arrow nav (the most common path).
      const safeIdx = activeIndex >= 0 && activeIndex < results.length ? activeIndex : 0;
      const opt = results[safeIdx];
      if (opt) {
        e.preventDefault();
        selectOption(opt);
      }
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Tab') {
      // R-REPAIRS-AUTOCOMPLETE-TAB-FLOW-FIX: close the dropdown but do NOT
      // preventDefault — Tab must follow normal browser form navigation
      // and advance focus to the next field. Pairs with tabIndex={-1} on
      // dropdown buttons (AutocompleteInput.tsx) so Tab skips them.
      close();
    }
  }, [isOpen, results, activeIndex, selectOption, close]);

  return { results, isOpen, activeIndex, open, close, handleKeyDown, selectOption, setActiveIndex };
}
