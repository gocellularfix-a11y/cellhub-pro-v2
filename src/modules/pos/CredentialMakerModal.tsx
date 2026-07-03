// ============================================================
// CellHub Pro — Credential Maker Modal
// Search customer → optional camera photo → print ID card
// Credit-card sized (3.375in × 2.125in) with barcode
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { Modal, SearchInput, ConfirmDialog } from '@/components/ui';
import CustomerPicker from '@/components/shared/CustomerPicker';
import type { Customer } from '@/store/types';
import { persist } from '@/services/persist';
import { openPrintWindow } from '@/hooks/usePrint';
import JsBarcode from 'jsbarcode';

type TFn = (key: string, ...args: any[]) => string;

// ── Credential Card (printable) ───────────────────────────

function CredentialCard({
  customer,
  settings,
  t,
}: {
  customer: Customer;
  settings: { storeName?: string; storePhone?: string; storeWebsite?: string; customerNumberPrefix?: string; credentialBgColor?: string; credentialFooterColor?: string };
  t: TFn;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const customerCode = customer.customerNumber ||
    `${settings.customerNumberPrefix || 'CH'}-${customer.id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()}`;

  useEffect(() => {
    if (barcodeRef.current && customerCode) {
      try {
        // R-CREDENTIAL-TOPUP-COPY-BARCODE-FIX: adopt the proven receipt barcode
        // sizing rules (renderBarcodeSvg). A fixed 1.5px module width + 2px
        // margin made longer customer codes wider than the CR80 right column
        // (~190px), forcing overflow/downscale. Pick the widest module that
        // still FITS at natural size + a real 10px CODE128 quiet zone, and snap
        // edges crisp. displayValue stays TRUE — the credential intentionally
        // prints the scannable customer number under the bars.
        const QUIET_PX = 10;
        const PRINTABLE_PX = 190; // CR80 right column width @96dpi
        const estModules = customerCode.length * 11 + 35;
        const moduleWidthPx = Math.max(1.0, Math.min(2.2, (PRINTABLE_PX - QUIET_PX * 2) / estModules));
        JsBarcode(barcodeRef.current, customerCode, {
          format: 'CODE128', width: moduleWidthPx, height: 35,
          displayValue: true, fontSize: 11, fontOptions: 'bold',
          background: '#ffffff', lineColor: '#000000',
          margin: QUIET_PX, marginTop: 2, marginBottom: 2, textMargin: 3,
        });
        barcodeRef.current.setAttribute('shape-rendering', 'crispEdges');
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
              }}>{t('credentialMaker.cardPhotoLabel')}</div>
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
            {/* R-CUSTOMER-ADDRESS-PRIVACY-V1: address printed ONLY when the
                customer opted in (showAddressOnCredential) and an address exists.
                Default off — privacy-first. Never mutates the stored address. */}
            {customer.showAddressOnCredential && customer.address && (
              <div style={{ fontSize: '10px', fontWeight: 500, color: '#000', marginBottom: '3px' }}>
                {customer.address}
                {(customer.city || customer.state || customer.zip)
                  ? `, ${[customer.city, customer.state].filter(Boolean).join(', ')}${customer.zip ? ` ${customer.zip}` : ''}`
                  : ''}
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
        {/* R-CREDENTIAL-TOPUP-COPY-BARCODE-FIX: footer now carries the full Go
            Cellular contact — name · phone · website (all from store settings).
            The body "Web:" line is intentionally kept. */}
        {settings.storeName || ''}{settings.storePhone ? ` · Tel: ${formatPhone(settings.storePhone)}` : ''}{settings.storeWebsite ? ` · ${settings.storeWebsite}` : ''}
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
    state: { customers, settings },
    setCustomers,
  } = useApp();
  const { toast } = useToast();
  const { t, locale } = useTranslation();

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

  // R-CUSTOMERPICKER-CREDENTIAL-MIGRATION: inline customer add via picker.
  // Mirrors TopUpModal pattern — append to customers state and persist.
  const handleCreateNewCustomer = useCallback((c: Customer) => {
    try {
      const next = [...customersRef.current, c];
      customersRef.current = next;
      setCustomers(next);
      persist.customer(c.id, c as unknown as Record<string, unknown>);
    } catch (_) { /* defensive */ }
  }, [setCustomers]);

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
        // R-CREDENTIAL-CAMERA-FIX: ideal (non-exact) constraints so webcams that
        // can't hit exactly 640×480 still negotiate a close mode instead of
        // throwing OverconstrainedError. Video only — never request audio.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
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
        // R-CREDENTIAL-CAMERA-FIX: map the DOMException name to a specific,
        // actionable message instead of one generic "check permissions" toast.
        const e = err as { name?: string; message?: string };
        console.error('Camera error:', e?.name, e?.message);
        let msgKey = 'credentialMaker.cameraError';
        switch (e?.name) {
          case 'NotAllowedError':
          case 'PermissionDeniedError':
            msgKey = 'credentialMaker.cameraPermissionDenied'; break;
          case 'NotFoundError':
          case 'DevicesNotFoundError':
            msgKey = 'credentialMaker.cameraNotFound'; break;
          case 'NotReadableError':
          case 'TrackStartError':
            msgKey = 'credentialMaker.cameraBusy'; break;
          case 'OverconstrainedError':
          case 'ConstraintNotSatisfiedError':
            msgKey = 'credentialMaker.cameraConstraintError'; break;
          default: break;
        }
        toast(t(msgKey), 'error');
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
  }, [showCamera, t]);

  // Reset on close
  const handleClose = () => {
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
    // R-CR80-RESTORE-V1 + R-CR80-ORIENTATION-V1: pass the CR80 page size so
    // PrintPreviewModal renders at card size (no blank 4x6 canvas), and
    // landscape:true so the physical print rotates the portrait/base CR80 media
    // (54×85.6mm) to the standard landscape card (3.375×2.125in). Credentials
    // are landscape by default. webContents.print() ignores the HTML @page, so
    // this payload (pageSize + landscape) is what drives the physical output.
    openPrintWindow(html, { pageSize: 'cr80', landscape: true });
  };

  if (!open) return null;

  // ── Phase 1: Customer Search ────────────────────────────
  if (!selectedCustomer && !showCamera) {
    return (
      <>
        <Modal open={open} onClose={handleClose} title={`📇 ${t('credentialModalTitle')}`} size="max-w-xl">
          {/* R-CUSTOMERPICKER-CREDENTIAL-MIGRATION: shared picker replaces inline
              search + list. handleSelectCustomer still fires the photo confirmation
              dialog — picker selection routes through that unchanged. */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block' }}>
              {t('searchCustomerLabel')}
            </label>
            <CustomerPicker
              customers={customers}
              selectedCustomer={null}
              onSelect={(c) => { if (c) handleSelectCustomer(c); }}
              lang={locale}
              placeholder={t('typeCustomer')}
              onCreateCustomer={handleCreateNewCustomer}
            />
          </div>
        </Modal>

        {/* Photo confirmation dialog */}
        <ConfirmDialog
          open={showPhotoConfirm}
          title={t('credentialMaker.takePhotoTitle')}
          message={t('credentialMaker.takePhotoMessage')}
          confirmLabel={t('credentialMaker.takePhotoYes')}
          cancelLabel={t('credentialMaker.takePhotoNo')}
          onConfirm={() => handlePhotoConfirm(true)}
          onCancel={() => handlePhotoConfirm(false)}
        />
      </>
    );
  }

  // ── Phase 2: Camera ─────────────────────────────────────
  if (showCamera && selectedCustomer) {
    return (
      <Modal open={true} onClose={stopCamera} title={`${t('credentialMaker.takePhotoTitle')} — ${selectedCustomer.name}`} size="max-w-xl">
        <div style={{ textAlign: 'center' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
              width: '100%', maxWidth: '400px', borderRadius: '8px',
              border: '2px solid var(--border-strong)',
            }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
          <button onClick={stopCamera} className="btn btn-secondary" style={{ flex: 1 }}>
            {t('cancel')}
          </button>
          <button onClick={capturePhoto} className="btn btn-primary" style={{ flex: 1 }}>
            📸 {t('credentialMaker.capture')}
          </button>
        </div>
      </Modal>
    );
  }

  // ── Phase 3: Show Credential Card ───────────────────────
  if (selectedCustomer && !showCamera) {
    return (
      <Modal open={true} onClose={handleClose} title={`📇 ${t('customerCredential')}`} size="max-w-xl">
        <>
          <div ref={printAreaRef}>
            <CredentialCard customer={selectedCustomer} settings={settings} t={t} />
          </div>

          {/* DataCard printer instructions */}
          <div style={{
            marginTop: '1rem', padding: '0.75rem',
            background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '6px', fontSize: '0.875rem',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              🖨️ {t('credentialMaker.printSettingsHeader')}
            </div>
            <div style={{ opacity: 0.9 }}>
              {t('credentialMaker.printSettingsBody')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button onClick={handleClose} className="btn btn-secondary" style={{ flex: 1 }}>
              {t('close')}
            </button>
            <button
              onClick={() => { setShowCamera(true); }}
              className="btn btn-warning" style={{ flex: 1 }}
            >
              📸 {t('credentialMaker.retakePhoto')}
            </button>
            <button onClick={handlePrint} className="btn btn-primary" style={{ flex: 1 }}>
              🖨️ {t('generateCredential')}
            </button>
          </div>
        </>
      </Modal>
    );
  }

  return null;
}
