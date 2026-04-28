// ============================================================
// CellHub Pro — Firebase Setup Modal
// Guides users through setting up Firebase cloud sync.
// Step 1: Do you have a Firebase project? (yes/no)
// Step 2a (no): Instructions + link to console.firebase.google.com
// Step 2b (yes): Paste config JSON
// Step 3: Validate config → save → prompt restart
// ============================================================

import { useState } from 'react';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { saveFirebaseConfig } from '@/config/firebase';
import type { FirebaseConfig } from '@/store/types';
import { useTranslation } from '@/i18n';

interface FirebaseSetupModalProps {
  lang: string;
  onClose: () => void;
  onComplete: () => void; // Called after save — parent will prompt restart
}

type Step = 'ask_has_project' | 'instructions' | 'paste_config';

export default function FirebaseSetupModal({ lang, onClose, onComplete }: FirebaseSetupModalProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('ask_has_project');
  const [configJson, setConfigJson] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleValidateAndSave = () => {
    setValidationError(null);
    let parsed: Partial<FirebaseConfig> | null = null;

    // Users often paste the `firebaseConfig` object from the Firebase console
    // in JavaScript object-literal form (unquoted keys, single quotes). Try
    // strict JSON first; if that fails, normalize keys/quotes and retry.
    // NEVER eval — regex-only normalization for safety.
    const stripped = configJson
      .trim()
      .replace(/^const\s+firebaseConfig\s*=\s*/i, '')
      .replace(/;$/, '');

    try {
      parsed = JSON.parse(stripped);
    } catch {
      try {
        const normalized = stripped
          .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
          .replace(/'/g, '"');
        parsed = JSON.parse(normalized);
      } catch {
        setValidationError(t('settings.firebase.invalidJson'));
        return;
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      setValidationError(t('settings.firebase.unknownFormat'));
      return;
    }

    // Required fields per Round 7 spec
    const required: (keyof FirebaseConfig)[] = ['apiKey', 'projectId', 'appId'];
    const missing = required.filter((k) => !parsed![k]);
    if (missing.length > 0) {
      setValidationError(t('settings.firebase.missingFields', missing.join(', ')));
      return;
    }

    // Fill optional fields with empty strings so the type is satisfied.
    // Firestore only needs apiKey/projectId/appId to function.
    const finalConfig: FirebaseConfig = {
      apiKey: parsed.apiKey!,
      authDomain: parsed.authDomain || '',
      projectId: parsed.projectId!,
      storageBucket: parsed.storageBucket || '',
      messagingSenderId: parsed.messagingSenderId || '',
      appId: parsed.appId!,
    };

    try {
      saveFirebaseConfig(finalConfig);
      toast(t('settings.firebase.configSaved'), 'success');
      onComplete();
    } catch {
      setValidationError(t('settings.firebase.saveFailed'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('settings.firebase.title')}
      size="max-w-2xl"
    >
      <div style={{ padding: '0.5rem', maxWidth: 620 }}>

        {step === 'ask_has_project' && (
          <>
            <p style={{ fontSize: '0.95rem', marginBottom: '1rem', color: '#e5e7eb' }}>
              {t('settings.firebase.intro')}
            </p>
            <p style={{ fontSize: '0.95rem', marginBottom: '1.5rem', fontWeight: 600 }}>
              {t('settings.firebase.hasProject')}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setStep('paste_config')}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                {t('settings.firebase.yesHaveConfig')}
              </button>
              <button
                onClick={() => setStep('instructions')}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                {t('settings.firebase.noHelp')}
              </button>
            </div>
          </>
        )}

        {step === 'instructions' && (
          <>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              {t('settings.firebase.howToCreate')}
            </h3>
            <ol style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#d1d5db', paddingLeft: '1.25rem' }}>
              <li style={{ marginBottom: '0.5rem' }}>
                {lang === 'es'
                  ? <>Abre <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>console.firebase.google.com</a> e inicia sesión con tu cuenta de Google.</>
                  : <>Open <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>console.firebase.google.com</a> and sign in with your Google account.</>}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {t('settings.firebase.step2')}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {t('settings.firebase.step3')}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {t('settings.firebase.step4')}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {t('settings.firebase.step5')}
              </li>
              <li>
                {t('settings.firebase.step6')}
              </li>
            </ol>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button onClick={() => setStep('ask_has_project')} className="btn btn-secondary">
                {t('settings.firebase.back')}
              </button>
              <button onClick={() => setStep('paste_config')} className="btn btn-primary" style={{ flex: 1 }}>
                {t('settings.firebase.haveConfig')}
              </button>
            </div>
          </>
        )}

        {step === 'paste_config' && (
          <>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              {t('settings.firebase.pasteTitle')}
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
              {t('settings.firebase.pasteDesc')}
            </p>
            <textarea
              value={configJson}
              onChange={(e) => { setConfigJson(e.target.value); setValidationError(null); }}
              placeholder={`{
  "apiKey": "AIza...",
  "authDomain": "my-shop.firebaseapp.com",
  "projectId": "my-shop-pos",
  "storageBucket": "my-shop.appspot.com",
  "messagingSenderId": "1234567890",
  "appId": "1:1234567890:web:abc123"
}`}
              rows={12}
              style={{
                width: '100%',
                fontSize: '0.82rem',
                fontFamily: 'Consolas, monospace',
                padding: '0.75rem',
                background: 'rgba(0,0,0,0.3)',
                color: '#e5e7eb',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '0.5rem',
                resize: 'vertical',
              }}
            />
            {validationError && (
              <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                ⚠️ {validationError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button onClick={() => setStep('ask_has_project')} className="btn btn-secondary">
                {t('settings.firebase.back')}
              </button>
              <button
                onClick={handleValidateAndSave}
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!configJson.trim()}
              >
                {t('settings.firebase.validateSave')}
              </button>
            </div>
          </>
        )}

      </div>
    </Modal>
  );
}
