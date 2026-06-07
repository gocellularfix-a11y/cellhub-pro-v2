import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { mmToPx } from '../utils';
import type {
  CustomLabelConfig,
  LabelElement,
  TextElement,
  BarcodeElement,
  QRElement,
} from '../types';

const DEFAULT_CONFIG: CustomLabelConfig = {
  widthMm: 89,
  heightMm: 36,
  elements: [],
};

// LABEL-STUDIO-EDITOR-CONTROLS-PLUS-CUSTOMER-LAST-VISIT-FIX-V1: new and
// pasted text now start WITH a fixed box, so the DYMO controls (align /
// vertical / overflow=autofit) are effective immediately and the selection
// shows real resize bounds — instead of a boxless element where those
// options silently do nothing until the first manual resize.
// Width estimate: avg glyph ≈ 0.62 × fontSize for Arial-class fonts.
function defaultTextBox(
  value: string,
  fontSize: number,
  cfg: CustomLabelConfig,
  x: number,
  y: number,
): { width: number; height: number } {
  const labelW = mmToPx(cfg.widthMm);
  const labelH = mmToPx(cfg.heightMm);
  const estW = Math.round(value.length * fontSize * 0.62) + 12;
  const width = Math.max(40, Math.min(estW, Math.max(40, labelW - x - 4)));
  const height = Math.max(18, Math.min(Math.round(fontSize * 1.2) + 10, Math.max(18, labelH - y - 4)));
  return { width, height };
}

export function useCustomLabel() {
  const [config, setConfig] = useState<CustomLabelConfig>(DEFAULT_CONFIG);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Refs so stable callbacks can always read the latest values without deps
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const latestConfigRef = useRef(config);
  latestConfigRef.current = config;

  const addText = useCallback(() => {
    const value = 'New Text';
    const box = defaultTextBox(value, 15, latestConfigRef.current, 10, 10);
    const el: TextElement = {
      id: uuidv4(),
      type: 'text',
      x: 10,
      y: 10,
      value,
      size: 'medium',
      fontSize: 15,
      bold: false,
      // LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1: DYMO-style defaults
      // for NEW text (phone/PIN labels). Saved/legacy elements without these
      // fields keep left/top/wrap.
      align: 'center',
      valign: 'middle',
      overflow: 'autofit',
      // V1 follow-up: start boxed so the controls work immediately.
      ...box,
    };
    setConfig(prev => ({ ...prev, elements: [...prev.elements, el] }));
    setSelectedId(el.id);
  }, []);

  /** Create a text element from pasted/clipboard text, placed near the selected element */
  const addTextWithValue = useCallback((value: string) => {
    const currentSelectedId = selectedIdRef.current;
    const currentElements = latestConfigRef.current.elements;
    const base = currentElements.find(el => el.id === currentSelectedId);
    const x = base ? Math.min(base.x + 15, 200) : 10;
    const y = base ? Math.min(base.y + 20, 200) : 10;
    const box = defaultTextBox(value, 15, latestConfigRef.current, x, y);
    const el: TextElement = {
      id: uuidv4(),
      type: 'text',
      x,
      y,
      value,
      size: 'medium',
      fontSize: 15,
      bold: false,
      // LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1: same DYMO defaults
      // as addText for pasted text — identical element shape, identical
      // properties panel (Font Size / Box / Align / Vertical / Overflow).
      align: 'center',
      valign: 'middle',
      overflow: 'autofit',
      ...box,
    };
    setConfig(prev => ({ ...prev, elements: [...prev.elements, el] }));
    setSelectedId(el.id);
  }, []); // stable — reads latest values via refs

  const addBarcode = useCallback(() => {
    const el: BarcodeElement = {
      id: uuidv4(),
      type: 'barcode',
      x: 10,
      y: 10,
      value: '012345678901',
      height: 40,
    };
    setConfig(prev => ({ ...prev, elements: [...prev.elements, el] }));
    setSelectedId(el.id);
  }, []);

  const addQR = useCallback(() => {
    const el: QRElement = {
      id: uuidv4(),
      type: 'qr',
      x: 10,
      y: 10,
      value: 'https://example.com',
      size: 64,
    };
    setConfig(prev => ({ ...prev, elements: [...prev.elements, el] }));
    setSelectedId(el.id);
  }, []);

  const updateElement = useCallback((updated: LabelElement) => {
    setConfig(prev => ({
      ...prev,
      elements: prev.elements.map(el => (el.id === updated.id ? updated : el)),
    }));
  }, []);

  const moveElement = useCallback((id: string, x: number, y: number) => {
    setConfig(prev => {
      const maxX = mmToPx(prev.widthMm) - 10;
      const maxY = mmToPx(prev.heightMm) - 10;
      return {
        ...prev,
        elements: prev.elements.map(el =>
          el.id === id
            ? { ...el, x: Math.max(0, Math.min(x, maxX)), y: Math.max(0, Math.min(y, maxY)) }
            : el
        ),
      };
    });
  }, []);

  const deleteElement = useCallback((id: string) => {
    setConfig(prev => ({
      ...prev,
      elements: prev.elements.filter(el => el.id !== id),
    }));
    setSelectedId(prev => (prev === id ? null : prev));
  }, []);

  const setLabelSize = useCallback((widthMm: number, heightMm: number) => {
    setConfig(prev => {
      const newMaxX = mmToPx(widthMm) - 10;
      const newMaxY = mmToPx(heightMm) - 10;
      return {
        ...prev,
        widthMm,
        heightMm,
        elements: prev.elements.map(el => ({
          ...el,
          x: Math.max(0, Math.min(el.x, newMaxX)),
          y: Math.max(0, Math.min(el.y, newMaxY)),
        })),
      };
    });
  }, []);

  const loadConfig = useCallback((incoming: CustomLabelConfig) => {
    setConfig({ ...incoming, elements: incoming.elements.map(el => ({ ...el })) });
    setSelectedId(null);
  }, []);

  const clearCanvas = useCallback(() => {
    setConfig(prev => ({ ...prev, elements: [] }));
    setSelectedId(null);
  }, []);

  const selectedElement = config.elements.find(el => el.id === selectedId) ?? null;

  return {
    config,
    selectedId,
    selectedElement,
    setSelectedId,
    addText,
    addTextWithValue,
    addBarcode,
    addQR,
    updateElement,
    moveElement,
    deleteElement,
    setLabelSize,
    loadConfig,
    clearCanvas,
  };
}
