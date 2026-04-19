// ============================================================
// CellHub Pro — useHighlightRecord
//
// Consumed by list modules (Repairs, Unlocks, Customers, etc.)
// to scroll-to and flash-highlight a record navigated from
// GlobalSearch. Uses highlightRecordId from global state.
//
// Usage:
//   const { highlightRef, isHighlighted } = useHighlightRecord();
//   // In JSX:
//   <div ref={isHighlighted(record.id) ? highlightRef : null}
//        style={{ ...someStyle, outline: isHighlighted(record.id) ? '2px solid #667eea' : 'none' }}>
// ============================================================

import { useRef, useEffect } from 'react';
import { useApp } from '@/store/AppProvider';

export function useHighlightRecord<T extends HTMLElement = HTMLDivElement>() {
  const { state } = useApp();
  const { highlightRecordId } = state;
  const highlightRef = useRef<T>(null);

  // Scroll to highlighted record when it changes
  useEffect(() => {
    if (!highlightRecordId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightRecordId]);

  const isHighlighted = (id: string) =>
    !!highlightRecordId && id === highlightRecordId;

  return { highlightRef, isHighlighted, highlightRecordId };
}
