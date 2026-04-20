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

interface FirebaseSetupModalProps {
  lang: string;
  onClose: () => void;
  onComplete: () => void; // Called after save — parent will prompt restart
}

type Step = 'ask_has_project' | 'instructions' | 'paste_config';

export default function FirebaseSetupModal({ lang, onClose, onComplete }: FirebaseSetupModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('ask_has_project');
  const [configJson, setConfigJson] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const es = lang === 'es';

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
        setValidationError(es
          ? 'JSON inválido. Copia el bloque firebaseConfig completo desde la consola de Firebase.'
          : 'Invalid JSON. Copy the full firebaseConfig block from the Firebase console.');
        return;
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      setValidationError(es ? 'Formato no reconocido.' : 'Unrecognized format.');
      return;
    }

    // Required fields per Round 7 spec
    const required: (keyof FirebaseConfig)[] = ['apiKey', 'projectId', 'appId'];
    const missing = required.filter((k) => !parsed![k]);
    if (missing.length > 0) {
      setValidationError(es
        ? `Faltan campos requeridos: ${missing.join(', ')}`
        : `Missing required fields: ${missing.join(', ')}`);
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
      toast(es ? 'Configuración guardada' : 'Config saved', 'success');
      onComplete();
    } catch {
      setValidationError(es ? 'Error al guardar la configuración.' : 'Error saving configuration.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={es ? '☁️ Configurar Sincronización en la Nube' : '☁️ Set up Cloud Sync'}
      size="max-w-2xl"
    >
      <div style={{ padding: '0.5rem', maxWidth: 620 }}>

        {step === 'ask_has_project' && (
          <>
            <p style={{ fontSize: '0.95rem', marginBottom: '1rem', color: '#e5e7eb' }}>
              {es
                ? 'La sincronización en la nube usa Firebase de Google para respaldar tus datos y compartirlos entre múltiples dispositivos.'
                : 'Cloud sync uses Google Firebase to back up your data and share it across multiple devices.'}
            </p>
            <p style={{ fontSize: '0.95rem', marginBottom: '1.5rem', fontWeight: 600 }}>
              {es ? '¿Ya tienes un proyecto Firebase?' : 'Do you already have a Firebase project?'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setStep('paste_config')}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                {es ? 'Sí, tengo la configuración' : 'Yes, I have the config'}
              </button>
              <button
                onClick={() => setStep('instructions')}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                {es ? 'No, ayúdame a crearlo' : 'No, help me create one'}
              </button>
            </div>
          </>
        )}

        {step === 'instructions' && (
          <>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              {es ? 'Cómo crear un proyecto Firebase' : 'How to create a Firebase project'}
            </h3>
            <ol style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#d1d5db', paddingLeft: '1.25rem' }}>
              <li style={{ marginBottom: '0.5rem' }}>
                {es
                  ? <>Abre <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>console.firebase.google.com</a> e inicia sesión con tu cuenta de Google.</>
                  : <>Open <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>console.firebase.google.com</a> and sign in with your Google account.</>}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {es ? 'Click en "Agregar proyecto" y ponle un nombre (ej: "mi-tienda-pos").' : 'Click "Add project" and give it a name (e.g. "my-shop-pos").'}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {es ? 'Una vez creado, click en el ícono de Web (</>). Registra la app con cualquier nombre.' : 'Once created, click the Web icon (</>). Register the app with any name.'}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {es ? 'Firebase mostrará un bloque de código con "firebaseConfig". Copia ese bloque COMPLETO.' : 'Firebase will show a code block with "firebaseConfig". Copy that ENTIRE block.'}
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                {es ? 'En el menú izquierdo: Firestore Database → Crear base de datos → Modo de prueba o Modo producción.' : 'In the left menu: Firestore Database → Create database → Test mode or Production mode.'}
              </li>
              <li>
                {es ? 'Vuelve aquí y pega la configuración en el siguiente paso.' : 'Come back here and paste the config in the next step.'}
              </li>
            </ol>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button onClick={() => setStep('ask_has_project')} className="btn btn-secondary">
                {es ? '← Atrás' : '← Back'}
              </button>
              <button onClick={() => setStep('paste_config')} className="btn btn-primary" style={{ flex: 1 }}>
                {es ? 'Ya tengo mi config →' : 'I have my config →'}
              </button>
            </div>
          </>
        )}

        {step === 'paste_config' && (
          <>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              {es ? 'Pega la configuración de Firebase' : 'Paste your Firebase config'}
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
              {es
                ? 'Pega el bloque completo que copiaste de la consola de Firebase. Se acepta formato JSON u objeto JavaScript.'
                : 'Paste the entire block you copied from the Firebase console. Accepts JSON or JS object format.'}
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
                {es ? '← Atrás' : '← Back'}
              </button>
              <button
                onClick={handleValidateAndSave}
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!configJson.trim()}
              >
                {es ? 'Validar y guardar' : 'Validate and save'}
              </button>
            </div>
          </>
        )}

      </div>
    </Modal>
  );
}
