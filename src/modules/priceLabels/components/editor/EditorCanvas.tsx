import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CustomLabelConfig, LabelElement, TextElement, BarcodeElement, QRElement } from '../../types';
import { mmToPx } from '../../utils';
import { TextRenderer, resolveTextFontSize } from '../elements/TextRenderer';
import { BarcodeElementRenderer } from '../elements/BarcodeElementRenderer';
import { QRElementRenderer } from '../elements/QRElementRenderer';

const CANVAS_MAX_W = 560;
const CANVAS_MAX_H = 340;
const MAX_SCALE = 2.2;

type HandleType = 'e' | 's' | 'se';

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
}

export function EditorCanvas({
  config,
  selectedId,
  onSelect,
  onMove,
  onUpdate,
  onPasteText,
}: EditorCanvasProps) {
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const elemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Always-fresh config ref so the resize handler never reads stale closure values
  const configRef = useRef(config);
  configRef.current = config;

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

  // Global mouse handlers for both drag-to-move and drag-to-resize
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      // Move
      const drag = dragRef.current;
      if (drag) {
        const dx = (e.clientX - drag.startMouseX) / scale;
        const dy = (e.clientY - drag.startMouseY) / scale;
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
      const dx = (e.clientX - resize.startMouseX) / scale;
      const dy = (e.clientY - resize.startMouseY) / scale;

      let newW = resize.startW;
      let newH = resize.startH;
      if (resize.handle === 'e' || resize.handle === 'se') {
        newW = Math.max(20, Math.min(lW - resize.startElemX, resize.startW + dx));
      }
      if (resize.handle === 's' || resize.handle === 'se') {
        newH = Math.max(10, Math.min(lH - resize.startElemY, resize.startH + dy));
      }

      let updated: LabelElement;
      if (el.type === 'text') {
        const next: TextElement = { ...(el as TextElement) };
        if (resize.handle === 'e') {
          // E: widen the text box for wrapping — font size unchanged
          next.width = Math.round(Math.max(20, newW));
        } else if (resize.handle === 's') {
          // S: taller clip window — font size unchanged
          next.height = Math.round(Math.max(10, newH));
        } else {
          // SE corner: scale font size so the glyphs actually grow with the drag
          const factor = Math.max(newW / resize.startW, newH / resize.startH);
          next.fontSize = Math.round(Math.max(6, Math.min(144, resize.startFontSize * factor)));
          next.size = undefined;   // clear preset so fontSize takes over
          next.width = undefined;  // let natural width follow new font size
          next.height = undefined;
        }
        updated = next;
      } else if (el.type === 'barcode') {
        const next: BarcodeElement = { ...(el as BarcodeElement) };
        if (resize.handle === 'e' || resize.handle === 'se') next.width = Math.round(Math.max(60, Math.min(500, newW)));
        if (resize.handle === 's' || resize.handle === 'se') next.height = Math.round(Math.max(20, Math.min(180, newH)));
        updated = next;
      } else {
        // QR — proportional: take the larger axis so corner drag grows the square
        const size = Math.round(Math.max(30, Math.min(300, Math.max(newW, newH))));
        updated = { ...(el as QRElement), size };
      }
      onUpdate(updated);
    }

    function onMouseUp() {
      dragRef.current = null;
      resizeRef.current = null;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [scale, onMove, onUpdate]);

  // Ctrl/Cmd+V paste shortcut — only fires when not typing in an input
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
  }, [onPasteText]);

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

    type Spec = { key: HandleType; cursor: string; left: number; top: number };
    const specs: Spec[] = [];
    if (!isQR) {
      // Right-edge handle (width only)
      specs.push({ key: 'e', cursor: 'e-resize', left: selectedEl.x + w, top: selectedEl.y + h / 2 });
      // Bottom-edge handle (height only)
      specs.push({ key: 's', cursor: 's-resize', left: selectedEl.x + w / 2, top: selectedEl.y + h });
    }
    // Corner handle (both / QR size)
    specs.push({ key: 'se', cursor: 'se-resize', left: selectedEl.x + w, top: selectedEl.y + h });

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
                  {el.type === 'text' && <TextRenderer element={el} />}
                  {el.type === 'barcode' && <BarcodeElementRenderer element={el} />}
                  {el.type === 'qr' && <QRElementRenderer element={el} />}
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
