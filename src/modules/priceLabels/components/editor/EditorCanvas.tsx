import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CustomLabelConfig, LabelElement, TextElement, BarcodeElement, QRElement } from '../../types';
import { mmToPx } from '../../utils';
import { TextRenderer, resolveTextFontSize } from '../elements/TextRenderer';
import { BarcodeElementRenderer } from '../elements/BarcodeElementRenderer';
import { QRElementRenderer } from '../elements/QRElementRenderer';

const CANVAS_MAX_W = 560;
const CANVAS_MAX_H = 340;
const MAX_SCALE = 2.2;

// LABEL-STUDIO-EDITOR-CONTROLS-PLUS-CUSTOMER-LAST-VISIT-FIX-V1: full 8-way
// selection handles (was e/s/se only — the "three dots on the right").
type HandleType = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// Memoized element visual — during drag only the moved element's object
// identity changes, so the other elements (incl. JsBarcode SVG / QR <img>
// wrappers) skip re-rendering entirely.
const ElementVisual = memo(function ElementVisual({ el }: { el: LabelElement }) {
  if (el.type === 'text') return <TextRenderer element={el} />;
  if (el.type === 'barcode') return <BarcodeElementRenderer element={el} />;
  return <QRElementRenderer element={el} />;
});

interface DragState {
  id: string;
  startMouseX: number;
  startMouseY: number;
  startElemX: number;
  startElemY: number;
}

interface ResizeState {
  id: string;
  handle: HandleType;
  startMouseX: number;
  startMouseY: number;
  startW: number;
  startH: number;
  startElemX: number;
  startElemY: number;
  startFontSize: number;
}

interface EditorCanvasProps {
  config: CustomLabelConfig;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onUpdate: (updated: LabelElement) => void;
  onPasteText?: (text: string) => void;
  /** LABEL-STUDIO-EDITOR-CONTROLS...V1: keyboard Delete/Backspace support. */
  onDelete?: (id: string) => void;
}

export function EditorCanvas({
  config,
  selectedId,
  onSelect,
  onMove,
  onUpdate,
  onPasteText,
  onDelete,
}: EditorCanvasProps) {
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const elemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Always-fresh config ref so the resize handler never reads stale closure values
  const configRef = useRef(config);
  configRef.current = config;
  // Always-fresh selection for the keyboard-delete handler
  const selectedIdLatestRef = useRef(selectedId);
  selectedIdLatestRef.current = selectedId;
  // rAF throttle state for drag/resize (see mousemove handler)
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);

  const labelW = mmToPx(config.widthMm);
  const labelH = mmToPx(config.heightMm);
  const scaleX = CANVAS_MAX_W / labelW;
  const scaleY = CANVAS_MAX_H / labelH;
  const scale = Math.min(scaleX, scaleY, MAX_SCALE);
  const displayW = Math.round(labelW * scale);
  const displayH = Math.round(labelH * scale);

  // Rendered size of the selected element in label-space px — drives handle positions
  const [selectedSize, setSelectedSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    if (!selectedId) { setSelectedSize(null); return; }
    const domEl = elemRefs.current.get(selectedId);
    if (!domEl) { setSelectedSize(null); return; }
    const rect = domEl.getBoundingClientRect();
    const w = rect.width / scale;
    const h = rect.height / scale;
    // Only update state when size meaningfully changed to avoid render loops
    setSelectedSize(prev =>
      prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h }
    );
  }, [selectedId, config.elements, scale]);

  // Global mouse handlers for both drag-to-move and drag-to-resize.
  // LABEL-STUDIO-EDITOR-CONTROLS-PLUS-CUSTOMER-LAST-VISIT-FIX-V1:
  //   - rAF-throttled: high-polling mice fire mousemove up to 1000×/s and
  //     every event used to write state (re-rendering the whole module) —
  //     the "drags slower than the rest of CellHub" root cause. Now at most
  //     ONE state write per animation frame.
  //   - generic 8-way resize math: N/W handles shift x/y while resizing so
  //     the opposite edge stays anchored, clamped to the label bounds.
  useEffect(() => {
    function processPoint(px: number, py: number) {
      // Move
      const drag = dragRef.current;
      if (drag) {
        const dx = (px - drag.startMouseX) / scale;
        const dy = (py - drag.startMouseY) / scale;
        onMove(drag.id, drag.startElemX + dx, drag.startElemY + dy);
        return;
      }
      // Resize
      const resize = resizeRef.current;
      if (!resize) return;
      const cfg = configRef.current;
      const el = cfg.elements.find(x => x.id === resize.id);
      if (!el) return;
      const lW = mmToPx(cfg.widthMm);
      const lH = mmToPx(cfg.heightMm);
      const dx = (px - resize.startMouseX) / scale;
      const dy = (py - resize.startMouseY) / scale;
      const h = resize.handle;
      const hasE = h.includes('e');
      const hasW = h.includes('w');
      const hasS = h.includes('s');
      const hasN = h.includes('n');

      // Per-type constraints — existing minimums/maximums preserved.
      const minW = el.type === 'text' ? 20 : el.type === 'barcode' ? 60 : 30;
      const minH = el.type === 'text' ? 10 : el.type === 'barcode' ? 20 : 30;
      const maxW = el.type === 'barcode' ? 500 : Number.POSITIVE_INFINITY;
      const maxH = el.type === 'barcode' ? 180 : Number.POSITIVE_INFINITY;

      let newW = resize.startW;
      let newH = resize.startH;
      if (hasE) newW = resize.startW + dx;
      if (hasW) newW = resize.startW - dx;
      if (hasS) newH = resize.startH + dy;
      if (hasN) newH = resize.startH - dy;

      // Clamp to [min, max] and the label edges. W/N handles grow toward
      // the origin, so their available room is the element's own x/y.
      newW = Math.max(minW, Math.min(newW, maxW, hasW ? resize.startElemX + resize.startW : lW - resize.startElemX));
      newH = Math.max(minH, Math.min(newH, maxH, hasN ? resize.startElemY + resize.startH : lH - resize.startElemY));
      const newX = hasW ? resize.startElemX + (resize.startW - newW) : resize.startElemX;
      const newY = hasN ? resize.startElemY + (resize.startH - newH) : resize.startElemY;

      let updated: LabelElement;
      if (el.type === 'text') {
        // DYMO model: every handle resizes the TEXT BOX bounds only — the
        // font NEVER scales from a drag. 'autofit' shrinks within the box.
        updated = { ...(el as TextElement), x: newX, y: newY, width: Math.round(newW), height: Math.round(newH) };
      } else if (el.type === 'barcode') {
        updated = { ...(el as BarcodeElement), x: newX, y: newY, width: Math.round(newW), height: Math.round(newH) };
      } else {
        // QR — proportional square from the dominant axis (corner handles only).
        const size = Math.round(Math.max(30, Math.min(300, Math.max(newW, newH))));
        updated = {
          ...(el as QRElement),
          size,
          x: hasW ? Math.max(0, resize.startElemX + (resize.startW - size)) : resize.startElemX,
          y: hasN ? Math.max(0, resize.startElemY + (resize.startH - size)) : resize.startElemY,
        };
      }
      onUpdate(updated);
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current && !resizeRef.current) return;
      pendingPointRef.current = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const p = pendingPointRef.current;
          if (p) processPoint(p.x, p.y);
        });
      }
    }

    function onMouseUp() {
      dragRef.current = null;
      resizeRef.current = null;
      pendingPointRef.current = null;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    };
  }, [scale, onMove, onUpdate]);

  // Keyboard shortcuts — only fire when not typing in a form control.
  //   Ctrl/Cmd+V → paste text element (existing)
  //   Delete / Backspace → delete selected element (LABEL-STUDIO-EDITOR-
  //   CONTROLS-PLUS-CUSTOMER-LAST-VISIT-FIX-V1; Delete button stays too)
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      return t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement
        || (t instanceof HTMLElement && t.isContentEditable);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = selectedIdLatestRef.current;
        if (id && onDelete) {
          e.preventDefault();
          onDelete(id);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (navigator.clipboard) {
          navigator.clipboard.readText().then(text => {
            if (text.trim()) onPasteText?.(text.trim());
          }).catch(() => {});
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onPasteText, onDelete]);

  function startDrag(e: React.MouseEvent, el: LabelElement) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      id: el.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startElemX: el.x,
      startElemY: el.y,
    };
    onSelect(el.id);
  }

  function startResize(e: React.MouseEvent, el: LabelElement, handle: HandleType) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedSize) return;
    resizeRef.current = {
      id: el.id,
      handle,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startW: selectedSize.w,
      startH: selectedSize.h,
      startElemX: el.x,
      startElemY: el.y,
      startFontSize: el.type === 'text' ? resolveTextFontSize(el as TextElement) : 0,
    };
  }

  const selectedEl = selectedId
    ? (config.elements.find(e => e.id === selectedId) ?? null)
    : null;

  // Handle size in label-space so it appears as a constant 12px on screen
  const hp = 12 / scale;

  function renderResizeHandles() {
    if (!selectedEl || !selectedSize) return null;
    const { w, h } = selectedSize;
    const isQR = selectedEl.type === 'qr';
    const ex = selectedEl.x;
    const ey = selectedEl.y;

    // LABEL-STUDIO-EDITOR-CONTROLS-PLUS-CUSTOMER-LAST-VISIT-FIX-V1: full
    // 8-way handles (corners + edges). QR keeps corners only — it's a
    // proportional square, edge handles would distort expectations.
    type Spec = { key: HandleType; cursor: string; left: number; top: number };
    const specs: Spec[] = [
      { key: 'nw', cursor: 'nwse-resize', left: ex,         top: ey },
      { key: 'ne', cursor: 'nesw-resize', left: ex + w,     top: ey },
      { key: 'sw', cursor: 'nesw-resize', left: ex,         top: ey + h },
      { key: 'se', cursor: 'nwse-resize', left: ex + w,     top: ey + h },
    ];
    if (!isQR) {
      specs.push(
        { key: 'n', cursor: 'ns-resize', left: ex + w / 2, top: ey },
        { key: 's', cursor: 'ns-resize', left: ex + w / 2, top: ey + h },
        { key: 'w', cursor: 'ew-resize', left: ex,         top: ey + h / 2 },
        { key: 'e', cursor: 'ew-resize', left: ex + w,     top: ey + h / 2 },
      );
    }

    return specs.map(spec => (
      <div
        key={spec.key}
        style={{
          position: 'absolute',
          left: spec.left,
          top: spec.top,
          width: hp,
          height: hp,
          // Center the circle on the handle point
          transform: 'translate(-50%, -50%)',
          background: '#38bdf8',
          border: `${1 / scale}px solid #fff`,
          borderRadius: '50%',
          cursor: spec.cursor,
          zIndex: 20,
        }}
        onMouseDown={e => startResize(e, selectedEl, spec.key)}
      />
    ));
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Outer dark workspace with dot-grid pattern */}
      <div
        className="rounded-xl overflow-hidden flex items-center justify-center"
        style={{
          width: CANVAS_MAX_W + 32,
          height: CANVAS_MAX_H + 32,
          background: '#0a1120',
          backgroundImage: 'radial-gradient(rgba(148,163,184,0.08) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        {/* White label surface */}
        <div
          style={{
            width: displayW,
            height: displayH,
            position: 'relative',
            overflow: 'hidden',
            background: '#ffffff',
            boxShadow: '0 0 0 1px rgba(56,189,248,0.15), 0 8px 40px rgba(0,0,0,0.7), 0 0 60px rgba(56,189,248,0.04)',
            border: '1px solid #d1d5db',
            cursor: 'default',
          }}
          onClick={() => onSelect(null)}
        >
          {/* Label-space coordinate system (scaled) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: labelW,
              height: labelH,
              transformOrigin: 'top left',
              transform: `scale(${scale})`,
            }}
          >
            {config.elements.map(el => {
              const isSelected = el.id === selectedId;
              return (
                <div
                  key={el.id}
                  ref={node => {
                    if (node) elemRefs.current.set(el.id, node);
                    else elemRefs.current.delete(el.id);
                  }}
                  style={{
                    position: 'absolute',
                    left: el.x,
                    top: el.y,
                    cursor: 'move',
                    outline: isSelected
                      ? `${2 / scale}px solid #3b82f6`
                      : `${1 / scale}px dashed transparent`,
                    outlineOffset: `${4 / scale}px`,
                    userSelect: 'none',
                  }}
                  onMouseDown={e => startDrag(e, el)}
                  onClick={e => { e.stopPropagation(); onSelect(el.id); }}
                >
                  <ElementVisual el={el} />
                </div>
              );
            })}

            {/* Resize handles — rendered in label space, on top of elements */}
            {renderResizeHandles()}
          </div>

          {config.elements.length === 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <p style={{ fontSize: 12, color: '#334155', fontFamily: 'Arial' }}>
                Add an element using the panel on the left
              </p>
            </div>
          )}
        </div>
      </div>

      <p style={{ fontSize: '0.72rem', color: '#475569' }}>
        {config.widthMm % 1 === 0 ? config.widthMm : config.widthMm.toFixed(1)} ×{' '}
        {config.heightMm % 1 === 0 ? config.heightMm : config.heightMm.toFixed(1)} mm
        &nbsp;·&nbsp; drag to move · handles to resize
      </p>
    </div>
  );
}
