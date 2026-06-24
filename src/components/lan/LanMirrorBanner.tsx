// ============================================================
// CellHub Pro — LAN Mirror Banner (LOCAL-LAN-SECONDARY-HYDRATION-V1)
//
// Mounted once globally. Shows a thin top banner whenever this machine is a
// connected LAN Secondary in read-only mirror mode, so the operator always
// knows the data on screen is the Primary's and is not editable here.
// Reads the lanMirror pub/sub store; renders nothing when not mirroring.
// ============================================================
import { useEffect, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { subscribeMirror, type LanMirrorStatus } from '@/services/lan/lanMirror';
import AdminPinGate from '@/components/shared/AdminPinGate';
import { promoteToPrimary, isPrimaryReachable } from '@/services/lan/promotion';

export default function LanMirrorBanner() {
  const { state: { lang, settings, currentEmployee } } = useApp();
  const es = lang === 'es';
  const pt = lang === 'pt';
  const tr = (en: string, esT: string, ptT: string) => (es ? esT : pt ? ptT : en);

  const [mirror, setMirror] = useState<LanMirrorStatus | null>(null);
  useEffect(() => subscribeMirror(setMirror), []);

  // R-PROMOTE-TO-PRIMARY: manual, Admin-gated failover promotion. No automatic
  // trigger — only this explicit button (shown solely while the Primary is
  // offline) starts the flow. Split-brain guarded twice: the button only renders
  // when offline, AND isPrimaryReachable() re-probes before allowing the PIN.
  const [promo, setPromo] = useState<'idle' | 'pin' | 'working'>('idle');
  const [promoMsg, setPromoMsg] = useState('');

  const startPromote = async () => {
    setPromoMsg('');
    if (await isPrimaryReachable()) {
      setPromoMsg(tr('Primary still available. Promotion blocked.',
                     'La Principal sigue disponible. Promoción bloqueada.',
                     'O Principal ainda está disponível. Promoção bloqueada.'));
      return;
    }
    setPromo('pin');
  };

  const onPinOk = async () => {
    setPromo('working');
    const res = await promoteToPrimary({ promotedBy: currentEmployee?.name || 'admin' });
    if (res.ok) { window.location.reload(); return; }
    setPromo('idle');
    setPromoMsg(
      res.reason === 'primary-reachable'
        ? tr('Primary still available. Promotion blocked.', 'La Principal sigue disponible. Promoción bloqueada.', 'O Principal ainda está disponível. Promoção bloqueada.')
        : (res.reason === 'no-snapshot' || res.reason === 'no-file')
          ? tr('No saved Primary snapshot to restore.', 'No hay respaldo de la Principal para restaurar.', 'Nenhum backup do Principal para restaurar.')
          : res.reason === 'unsupported-schema'
            ? tr('Saved snapshot version is not supported.', 'La versión del respaldo no es compatible.', 'A versão do backup não é compatível.')
            : tr('Promotion failed. Try again.', 'La promoción falló. Intenta de nuevo.', 'A promoção falhou. Tente novamente.'),
    );
  };

  if (!mirror || !mirror.active) return null;

  const synced = mirror.lastSyncAt
    ? new Date(mirror.lastSyncAt).toLocaleTimeString()
    : null;

  // LAN-CONNECTION-STATE-UX-V1: one clear message + colour per connection state.
  // No per-poll "syncing…" flip — the banner is driven by connState, which only
  // changes on a real connect / drop / recovery.
  const GREEN = 'linear-gradient(90deg, rgba(16,185,129,0.96), rgba(5,150,105,0.96))';
  const AMBER = 'linear-gradient(90deg, rgba(245,158,11,0.96), rgba(217,119,6,0.96))';
  const SLATE = 'linear-gradient(90deg, rgba(71,85,105,0.96), rgba(51,65,85,0.96))';

  let icon: string;
  let text: string;
  let background: string;
  let color = '#06281d';
  let showSynced = false;

  switch (mirror.connState) {
    case 'connected':
      icon = '🟢';
      text = tr('Connected to Primary — live mirror active',
                'Conectado a la Principal — espejo en vivo activo',
                'Conectado ao Principal — espelho ao vivo ativo');
      background = GREEN;
      showSynced = true;
      break;
    case 'reconnected':
      icon = '✅';
      text = tr('Reconnected to Primary',
                'Reconectado a la Principal',
                'Reconectado ao Principal');
      background = GREEN;
      showSynced = true;
      break;
    case 'offline':
      icon = '⚠️';
      text = tr('Primary offline — showing last synced data',
                'Principal sin conexión — mostrando los últimos datos sincronizados',
                'Principal offline — mostrando os últimos dados sincronizados');
      background = AMBER;
      color = '#1f2937';
      showSynced = true;
      break;
    case 'connecting':
    default:
      icon = '🔄';
      text = tr('Waiting for Primary connection…',
                'Esperando conexión con la Principal…',
                'Aguardando conexão com o Principal…');
      background = SLATE;
      color = '#e2e8f0';
      break;
  }

  return (
    <>
      <div
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
          padding: '0.3rem 0.75rem',
          background, color, fontSize: '0.78rem', fontWeight: 600,
          boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
        }}
      >
        <span>{icon} {text}</span>
        {showSynced && synced && (
          <span style={{ opacity: 0.85 }}>
            · {tr('last sync', 'última sincronización', 'última sincronização')} {synced}
            {mirror.stale && mirror.connState === 'connected'
              ? ` (${tr('stale', 'desactualizado', 'desatualizado')})`
              : ''}
          </span>
        )}
        {/* Preserve read-only awareness regardless of connection state. */}
        <span style={{ opacity: 0.7 }}>· {tr('read-only', 'solo lectura', 'somente leitura')}</span>

        {/* R-PROMOTE-TO-PRIMARY: manual failover. Button shows ONLY while the
            Primary is offline (split-brain guard #1). Clicking re-probes the
            Primary (guard #2), then requires the Admin PIN. */}
        {mirror.connState === 'offline' && (
          <button
            type="button"
            onClick={startPromote}
            disabled={promo === 'working'}
            style={{
              marginLeft: '0.4rem', padding: '0.15rem 0.6rem', borderRadius: '0.4rem',
              border: '1px solid rgba(0,0,0,0.3)', background: 'rgba(0,0,0,0.18)',
              color: '#1f2937', fontSize: '0.72rem', fontWeight: 700,
              cursor: promo === 'working' ? 'wait' : 'pointer',
            }}
          >
            {promo === 'working'
              ? tr('Promoting…', 'Promoviendo…', 'Promovendo…')
              : tr('⬆ Promote to Primary', '⬆ Promover a Principal', '⬆ Promover a Principal')}
          </button>
        )}
        {promoMsg && <span style={{ opacity: 0.9, fontWeight: 700 }}>· {promoMsg}</span>}
      </div>

      <AdminPinGate
        open={promo === 'pin'}
        adminPin={settings.adminPin}
        onSuccess={onPinOk}
        onCancel={() => setPromo('idle')}
      />
    </>
  );
}
