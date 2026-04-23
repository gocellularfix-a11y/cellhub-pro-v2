// ============================================================
// CellHub Pro — SMS Setup Wizard
// R-SMS-WIZARD
//
// Minimal 2-phase setup modal:
//   1. Picker — choose provider from 4 tiles (textbelt/twilio/telnyx/plivo)
//   2. Credentials — paste required fields with real-time validation
// Save persists to StoreSettings and closes. No API test, no walkthrough.
// ============================================================

import { useState, useMemo } from 'react';
import type { StoreSettings } from '@/store/types';
import {
  SMS_PROVIDERS,
  SMS_PROVIDER_ORDER,
  type SmsProviderMeta,
} from '@/services/smsProviders';

type ProviderKey = 'textbelt' | 'twilio' | 'telnyx' | 'plivo';

interface Props {
  settings: StoreSettings;
  language: 'en' | 'es';
  onSave: (patch: Partial<StoreSettings>) => void;
  onClose: () => void;
}

export function SmsSetupWizard({
  settings,
  language,
  onSave,
  onClose,
}: Props) {
  const es = language === 'es';
  const t = <T,>(en: T, esT: T) => (es ? esT : en);

  const currentProvider = (settings.smsProvider || 'none') as string;
  const initialPick: ProviderKey | null =
    currentProvider in SMS_PROVIDERS ? (currentProvider as ProviderKey) : null;

  const [selectedId, setSelectedId] = useState<ProviderKey | null>(initialPick);
  const [credValues, setCredValues] = useState<Record<string, string>>({
    smsApiKey: settings.smsApiKey || '',
    smsAccountSid: settings.smsAccountSid || '',
    smsAuthToken: settings.smsAuthToken || '',
    smsFromNumber: settings.smsFromNumber || '',
    smsMessagingProfileId: settings.smsMessagingProfileId || '',
  });

  const provider: SmsProviderMeta | null = selectedId
    ? SMS_PROVIDERS[selectedId]
    : null;

  const credErrors = useMemo(() => {
    if (!provider) return {};
    const errs: Record<string, string> = {};
    for (const f of provider.credFields) {
      if (f.validate) {
        const err = f.validate(credValues[f.key] || '');
        if (err) errs[f.key] = err;
      }
    }
    return errs;
  }, [provider, credValues]);

  const credsValid = Object.keys(credErrors).length === 0;

  const handleSave = () => {
    if (!provider) return;
    const patch: Partial<StoreSettings> = {
      smsProvider: provider.id as StoreSettings['smsProvider'],
    };
    for (const f of provider.credFields) {
      (patch as Record<string, string>)[f.key] = credValues[f.key] || '';
    }
    onSave(patch);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 640,
          width: '100%',
          maxHeight: '92vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            📱 {t('SMS Setup', 'Configurar SMS')}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#6b7280',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
          {!selectedId ? (
            /* ── Phase 1: Picker ────────────────────────── */
            <>
              <p style={{ fontSize: 14, color: '#4b5563', marginBottom: 16 }}>
                {t(
                  'Pick an SMS provider:',
                  'Escoge un proveedor de SMS:',
                )}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {SMS_PROVIDER_ORDER.map((id) => {
                  const p = SMS_PROVIDERS[id];
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedId(id)}
                      style={{
                        textAlign: 'left',
                        padding: 14,
                        border: '2px solid #e5e7eb',
                        borderRadius: 10,
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</span>
                        {p.badge && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 10,
                              background: '#dbeafe',
                              color: '#1e40af',
                              fontWeight: 700,
                            }}
                          >
                            {es ? p.badge.es : p.badge.en}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: '#6b7280',
                          marginBottom: 6,
                        }}
                      >
                        {es ? p.tagline.es : p.tagline.en}
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#4b5563' }}>
                        <span>⏱️ {p.setupMinutes}</span>
                        <span>💵 {p.pricePerSms}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : provider ? (
            /* ── Phase 2: Credentials ───────────────────── */
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{provider.name}</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  {es ? provider.tagline.es : provider.tagline.en}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 12 }}>
                  <a
                    href={provider.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6' }}
                  >
                    🔗 {t('Sign up', 'Registrarse')}
                  </a>
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6' }}
                  >
                    📖 {t('Docs', 'Documentación')}
                  </a>
                </div>
              </div>

              {provider.credFields.map((f) => (
                <div key={f.key} style={{ marginBottom: 14 }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    {es ? f.label.es : f.label.en}
                    {f.secret && <span style={{ color: '#6b7280', marginLeft: 6 }}>🔒</span>}
                  </label>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    value={credValues[f.key] || ''}
                    onChange={(e) =>
                      setCredValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 14,
                      border: `1px solid ${credErrors[f.key] ? '#dc2626' : '#d1d5db'}`,
                      borderRadius: 6,
                      fontFamily: f.secret ? 'monospace' : undefined,
                    }}
                  />
                  {credErrors[f.key] && (
                    <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
                      ⚠️ {credErrors[f.key]}
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {selectedId ? (
            <>
              <button
                onClick={() => setSelectedId(null)}
                className="btn"
                style={{ background: '#e5e7eb', color: '#111' }}
              >
                ← {t('Back', 'Atrás')}
              </button>
              <button
                onClick={handleSave}
                disabled={!credsValid}
                className="btn"
                style={{
                  background: credsValid ? '#3b82f6' : '#9ca3af',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: credsValid ? 'pointer' : 'not-allowed',
                }}
              >
                {t('Save', 'Guardar')}
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="btn"
              style={{ background: '#e5e7eb', color: '#111', marginLeft: 'auto' }}
            >
              {t('Cancel', 'Cancelar')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SmsSetupWizard;
