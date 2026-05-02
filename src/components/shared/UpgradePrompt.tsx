// ============================================================
// CellHub Pro — UpgradePrompt (R-LICENSE-GATES)
// Replaces a gated module/feature with a "🔒 Upgrade Required"
// card that names the required tier. Pure UI — no IPC, no
// activation flow (that lives in LicenseGate).
// ============================================================

import { useTranslation } from '@/i18n';

interface UpgradePromptProps {
  /** Identifier for telemetry/debug — not shown in UI. */
  feature: string;
  requiredTier: 'basic' | 'pro';
}

export default function UpgradePrompt({ feature, requiredTier }: UpgradePromptProps) {
  const { t } = useTranslation();
  void feature;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '70vh',
        gap: '1.25rem',
      }}
    >
      <div style={{ fontSize: '4rem' }}>🔒</div>
      <div style={{ fontSize: '1.15rem', color: '#94a3b8', fontWeight: 600 }}>
        {t('license.upgradeRequired')}
      </div>
      <p style={{ fontSize: '0.95rem', color: '#94a3b8', maxWidth: '320px', textAlign: 'center' }}>
        {t('license.featureRequires', requiredTier)}
      </p>
      <p style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '280px', textAlign: 'center' }}>
        {t('license.contactSupport')}
      </p>
    </div>
  );
}
