// ============================================================
// CellHub Pro — useAutocomplete hook
// Generic autocomplete with fuzzy matching + keyboard nav
// ============================================================

import { useState, useMemo, useCallback, useRef } from 'react';

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

  const selectOption = useCallback((option: AutocompleteOption) => {
    onSelect(option);
    close();
  }, [onSelect, close]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      selectOption(results[activeIndex]);
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
