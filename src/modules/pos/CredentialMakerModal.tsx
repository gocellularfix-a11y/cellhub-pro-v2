// ============================================================
// CellHub Pro — Credential Maker Modal
// Search customer → optional camera photo → print ID card
// Credit-card sized (3.375in × 2.125in) with barcode
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { getLabels } from '@/config/i18n';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { Modal, SearchInput, ConfirmDialog } from '@/components/ui';
import type { Customer } from '@/store/types';
import { persist } from '@/services/persist';
import { openPrintWindow } from '@/hooks/usePrint';
import JsBarcode from 'jsbarcode';

// ── Credential Card (printable) ───────────────────────────

function CredentialCard({
  customer,
  settings,
  es,
}: {
  customer: Customer;
  settings: { storeName?: string; storePhone?: string; storeWebsite?: string; customerNumberPrefix?: string; credentialBgColor?: string; credentialFooterColor?: string };
  es: boolean;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const customerCode = customer.customerNumber ||
    `${settings.customerNumberPrefix || 'CH'}-${customer.id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()}`;

  useEffect(() => {
    if (barcodeRef.current && customerCode) {
      try {
        JsBarcode(barcodeRef.current, customerCode, {
          format: 'CODE128', width: 1.5, height: 35,
          displayValue: true, fontSize: 11, fontOptions: 'bold',
          background: '#ffffff', lineColor: '#000000',
          margin: 2, marginTop: 2, marginBottom: 2, textMargin: 3,
        });
      } catch { /* barcode rendering failed */ }
    }
  }, [customerCode]);

  // Brand colors — configurable via Settings, defaults to navy
  const bgColor = (settings as any).credentialBgColor || '#003366';
  const footerColor = (settings as any).credentialFooterColor || '#001f3f';

  const formatPhone = (p: string) => {
    const d = p.replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return p;
  };

  // Split name into first/last for card display
  const nameParts = customer.name.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  return (
    <div
      style={{
        width: '3.375in', height: '2.125in', border: 'none',
        borderRadius: '8px', overflow: 'hidden', background: 'white',
        color: '#000', margin: '0 auto', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Card Body */}
      <div style={{ flex: 1, padding: '12px 16px', display: 'flex', gap: '12px' }}>
        {/* LEFT — Photo */}
        <div style={{
          width: '90px', height: '110px', border: '2px solid #ddd',
          borderRadius: '6px', overflow: 'hidden', flexShrink: 0,
          background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}cc 100%)`,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', position: 'relative',
        }}>
          {customer.credentialPhoto ? (
            <img src={customer.credentialPhoto} alt="Customer"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', color: 'white',
            }}>
              <div style={{
                width: '50px', height: '50px', background: 'white',
                borderRadius: '50%', position: 'relative', marginBottom: '8px',
              }}>
                <div style={{
                  position: 'absolute', bottom: '-20px', left: '50%',
                  transform: 'translateX(-50%)', width: '70px', height: '40px',
                  background: 'white', borderRadius: '50% 50% 0 0',
                }} />
              </div>
              <div style={{
                fontSize: '13px', fontWeight: 'bold', color: 'white',
                position: 'absolute', bottom: '8px', textAlign: 'center',
              }}>{es ? 'Foto' : 'Photo'}</div>
            </div>
          )}
        </div>

        {/* RIGHT — Info + Barcode */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{
              fontSize: '18px', fontWeight: 900, color: footerColor,
              textTransform: 'uppercase', lineHeight: 1.1, marginBottom: '4px',
              paddingBottom: '4px', borderBottom: `2px solid ${footerColor}`,
            }}>
              {firstName} {lastName}
            </div>

            {customer.phone && (
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#000', marginBottom: '3px' }}>
                Tel: {formatPhone(customer.phone)}
              </div>
            )}
            {settings.storeWebsite && (
              <div style={{ fontSize: '11px', fontWeight: 700, color: footerColor, marginBottom: '2px' }}>
                Web: {settings.storeWebsite}
              </div>
            )}
          </div>

          {/* Barcode */}
          <div style={{ textAlign: 'center', marginTop: '6px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <svg ref={barcodeRef} />
          </div>
        </div>
      </div>

      {/* Footer Bar */}
      <div style={{
        background: footerColor, color: 'white', padding: '8px 16px',
        textAlign: 'center', fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px',
      }}>
        {settings.storeName || ''}{settings.storePhone ? ` · Tel: ${formatPhone(settings.storePhone)}` : ''}
      </div>
    </div>
  );
}

// ── Main Credential Maker Modal ───────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CredentialMakerModal({ open, onClose }: Props) {
  const {
    state: { customers, settings, lang },
    setCustomers,
  } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';
  const L = getLabels(lang);

  const [credentialSearch, setCredentialSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showPhotoConfirm, setShowPhotoConfirm] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<Customer | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);

  // ── Stale-closure guard: ref-mirror of customers so capturePhoto doesn't
  // pisar updates from other modules that wrote during the camera session
  // (loyalty points, store credit, edits made while user was framing photo).
  const customersRef = useRef(customers);
  useEffect(() => { customersRef.current = customers; }, [customers]);

  // Filter customers
  const filtered = credentialSearch.trim()
    ? customers.filter((c) =>
        matchesSearch(credentialSearch, c.name, c.phone, c.customerNumber),
      ).slice(0, 15)
    : [];

  // ── Camera functions ────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !selectedCustomer) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const photoData = canvas.toDataURL('image/jpeg', 0.8);

    // Update customer with photo (using ref to avoid clobbering concurrent writes)
    const updated = { ...selectedCustomer, credentialPhoto: photoData };
    setSelectedCustomer(updated);
    const nextCustomers = customersRef.current.map((c) =>
      c.id === selectedCustomer.id ? updated : c,
    );
    customersRef.current = nextCustomers;
    setCustomers(nextCustomers);
    persist.customer(updated.id, updated as unknown as Record<string, unknown>);
    stopCamera();
  }, [selectedCustomer, setCustomers, stopCamera]);

  // Camera lifecycle — inline async to avoid stale closure on stream assignment.
  // If user closes modal while getUserMedia is pending, cancelled flag prevents
  // the resolved stream from leaking (camera light staying on after close).
  useEffect(() => {
    if (!showCamera) return;

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
        });
        if (cancelled) {
          // User closed before permissions resolved — clean up immediately
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Camera error:', err);
        toast(es
          ? 'No se pudo acceder a la cámara. Verifica permisos.'
          : 'Could not access camera. Check permissions.', 'error');
        setShowCamera(false);
      }
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [showCamera, lang]);

  // Reset on close
  const handleClose = () => {
    setCredentialSearch('');
    setSelectedCustomer(null);
    setShowCamera(false);
    setPendingCustomer(null);
    stopCamera();
    onClose();
  };

  // When a customer is selected, ask about photo
  const handleSelectCustomer = (customer: Customer) => {
    setPendingCustomer(customer);
    setShowPhotoConfirm(true);
  };

  const handlePhotoConfirm = (wantsPhoto: boolean) => {
    if (!pendingCustomer) return;
    setSelectedCustomer(pendingCustomer);
    setShowPhotoConfirm(false);
    setCredentialSearch('');
    if (wantsPhoto) {
      setShowCamera(true);
    }
    setPendingCustomer(null);
  };

  // ── Print credential ────────────────────────────────────

  const handlePrint = () => {
    const printArea = printAreaRef.current;
    if (!printArea) return;

    // Build the full HTML doc ONCE — both Electron and browser paths use it.
    // Previously the Electron path passed only innerHTML (no styles, no @page),
    // which broke the 3.375x2.125 size and color rendering on DataCard CD800.
    const html = `
      <html><head>
        <title>Customer Credential</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          @page { size: 3.375in 2.125in; margin: 0; }
          body { font-family: Arial, sans-serif; padding: 0; margin: 0; background: white; width: 3.375in; height: 2.125in; }
          @media print {
            html, body { width: 3.375in !important; height: 2.125in !important; margin: 0 !important; padding: 0 !important; overflow: hidden; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          }
        </style>
      </head><body>${printArea.innerHTML}</body></html>
    `;

    // r-print-audit: open in system Chrome for full print preview.
    openPrintWindow(html);
  };

  if (!open) return null;

  // ── Phase 1: Customer Search ────────────────────────────
  if (!selectedCustomer && !showCamera) {
    return (
      <>
        <Modal open={open} onClose={handleClose} title={`📇 ${L.credentialModalTitle || 'Generate Customer Credential'}`} size="max-w-xl">
          {/* Search input */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem', display: 'block' }}>
              {L.searchCustomerLabel || 'Search Customer'}
            </label>
            <input
              type="text"
              className="input"
              placeholder={L.typeCustomer || 'Type customer name or phone...'}
              value={credentialSearch}
              onChange={(e) => setCredentialSearch(e.target.value)}
              autoFocus
              style={{ fontSize: '1.1rem' }}
            />
          </div>

          {/* No search yet */}
          {!credentialSearch.trim() && (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
              <div style={{ fontSize: '3rem', opacity: 0.3, marginBottom: '0.75rem' }}>🔍</div>
              <p>{es ? 'Escribe el nombre o teléfono del cliente' : 'Type customer name or phone'}</p>
            </div>
          )}

          {/* Customer results */}
          {credentialSearch.trim() && (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {filtered.length > 0 ? filtered.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => handleSelectCustomer(customer)}
                  className="card"
                  style={{
                    width: '100%', padding: '1rem', textAlign: 'left', cursor: 'pointer',
                    marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#a5b4fc' }}>{customer.name}</div>
                    <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                      {customer.phone?.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') || ''}
                    </div>
                    {customer.customerNumber && (
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        #{customer.customerNumber}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: '1.5rem', opacity: 0.5 }}>🪪</span>
                </button>
              )) : (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  {L.noMatches || 'No matches'}
                </div>
              )}
            </div>
          )}
        </Modal>

        {/* Photo confirmation dialog */}
        <ConfirmDialog
          open={showPhotoConfirm}
          title={es ? '📸 Tomar Foto' : '📸 Take Photo'}
          message={es
            ? '¿Desea tomar una foto para la credencial?\n\n✅ SÍ = Abrir cámara\n❌ NO = Imprimir sin foto'
            : 'Would you like to take a photo for the credential?\n\nYES = Open camera\nNO = Print without photo'
          }
          confirmLabel={es ? 'Sí, tomar foto' : 'Yes, take photo'}
          cancelLabel={es ? 'No, sin foto' : 'No, without photo'}
          onConfirm={() => handlePhotoConfirm(true)}
          onCancel={() => handlePhotoConfirm(false)}
        />
      </>
    );
  }

  // ── Phase 2: Camera ─────────────────────────────────────
  if (showCamera && selectedCustomer) {
    return (
      <Modal open={true} onClose={stopCamera} title={`📸 ${es ? 'Tomar Foto' : 'Take Photo'} — ${selectedCustomer.name}`} size="max-w-xl">
        <div style={{ textAlign: 'center' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
              width: '100%', maxWidth: '400px', borderRadius: '8px',
              border: '2px solid rgba(255,255,255,0.2)',
            }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
          <button onClick={stopCamera} className="btn btn-secondary" style={{ flex: 1 }}>
            {es ? 'Cancelar' : 'Cancel'}
          </button>
          <button onClick={capturePhoto} className="btn btn-primary" style={{ flex: 1 }}>
            📸 {es ? 'Capturar' : 'Capture'}
          </button>
        </div>
      </Modal>
    );
  }

  // ── Phase 3: Show Credential Card ───────────────────────
  if (selectedCustomer && !showCamera) {
    return (
      <Modal open={true} onClose={handleClose} title={`📇 ${L.customerCredential || 'Customer Credential'}`} size="max-w-xl">
        <>
          <div ref={printAreaRef}>
            <CredentialCard customer={selectedCustomer} settings={settings} es={es} />
          </div>

          {/* DataCard printer instructions */}
          <div style={{
            marginTop: '1rem', padding: '0.75rem',
            background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '6px', fontSize: '0.875rem',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              🖨️ {es ? 'Configuración de Impresión:' : 'Print Settings:'}
            </div>
            <div style={{ opacity: 0.9 }}>
              {es
                ? 'En el diálogo de impresión: Selecciona tu impresora de credenciales → Más opciones → Escala: 100% (Sin escalar)'
                : 'In print dialog: Select your credential printer → More Settings → Scale: 100% (No scaling)'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>
              {L.close || 'Close'}
            </button>
            <button
              onClick={() => { setShowCamera(true); }}
              className="btn btn-warning" style={{ flex: 1 }}
            >
              📸 {es ? 'Retomar Foto' : 'Retake Photo'}
            </button>
            <button onClick={handlePrint} className="btn btn-primary" style={{ flex: 1 }}>
              🖨️ {L.generateCredential || 'Print Credential'}
            </button>
          </div>
        </>
      </Modal>
    );
  }

  return null;
}
