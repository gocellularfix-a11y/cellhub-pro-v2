// ============================================================
// CellHub Pro — Local Network panel (LOCAL-LAN-PAIRING-PHASE-1-V1)
//
// Settings → Local Network. Phase 1 = HANDSHAKE ONLY. Enabling a Primary
// stands up the LAN server + shows a 6-digit code; a Secondary enters the
// Primary's IP + code to pair. NO data sync happens yet — pairing only
// proves the network handshake and records a trusted connection locally.
// Self-contained trilingual strings (matches the privacy-section precedent).
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import {
  startPrimary, stopPrimary, getStatus, generateCode,
  pairWithPrimary, getConnection, disconnectSecondary,
  getDeviceName, setDeviceName, isElectron, fetchSnapshot,
  sendTestOperation, getLastIncomingOperation,
  resolveInheritedLicense, getInheritedLicense,
  discoverPrimaries, requestMirrorResync,
  type ResolvedInheritance,
} from '@/services/lan/lanService';
import { subscribeMirror, type LanMirrorStatus } from '@/services/lan/lanMirror';

export default function LocalNetworkPanel({ lang }: { lang: string }) {
  const { state: { settings } } = useApp();
  const es = lang === 'es';
  const pt = lang === 'pt';
  const tr = (en: string, esT: string, ptT: string) => (es ? esT : pt ? ptT : en);

  const electron = isElectron();
  const [conn, setConn] = useState(() => getConnection());
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [deviceName, setDeviceNameState] = useState(getDeviceName());

  // Secondary form
  const [primaryIp, setPrimaryIp] = useState(conn.primaryUrl || '');
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairMsg, setPairMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // LOCAL-LAN-AUTO-DISCOVERY-V1 — discover Primaries so the user only types a code
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<LanDiscoveredPrimary[]>([]);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [discoverDone, setDiscoverDone] = useState(false);

  // LOCAL-LAN-SECONDARY-HYDRATION-V1 — read-only mirror sync status
  const [mirror, setMirror] = useState<LanMirrorStatus | null>(null);
  useEffect(() => subscribeMirror(setMirror), []);

  // PHASE 2 — read-only snapshot
  const [snapshot, setSnapshot] = useState<LanSnapshotResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [snapErr, setSnapErr] = useState<string | null>(null);

  // PHASE 3A — test operation
  const [opSending, setOpSending] = useState(false);
  const [opAck, setOpAck] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastIncoming, setLastIncoming] = useState<LanIncomingOperation | null>(null);

  // LAN-LICENSE-INHERITANCE-V1
  const [lic, setLic] = useState<ResolvedInheritance | null>(null);
  const [licChecking, setLicChecking] = useState(false);

  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!electron) return;
    const s = await getStatus();
    setStatus(s);
    setConn(getConnection());
    // PHASE 3A: pick up the last operation the Primary received (display only).
    setLastIncoming(getLastIncomingOperation());
  }, [electron]);

  // Poll status every 3s while a primary server is running (code countdown).
  useEffect(() => {
    refresh();
    pollRef.current = window.setInterval(refresh, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [refresh]);

  const handleEnablePrimary = async () => {
    await startPrimary(settings.storeName || 'CellHub Primary');
    refresh();
  };
  const handleStopPrimary = async () => { await stopPrimary(); refresh(); };
  const handleRegen = async () => { await generateCode(); refresh(); };

  // LOCAL-LAN-AUTO-DISCOVERY-V1: scan the LAN for Primary beacons.
  const runDiscovery = useCallback(async () => {
    if (!electron) return;
    setDiscovering(true);
    const res = await discoverPrimaries();
    setDiscovering(false);
    setDiscoverDone(true);
    const list = res.ok ? res.primaries : [];
    setDiscovered(list);
    // Auto-select when exactly one Primary is found.
    if (list.length === 1) setSelectedUrl(list[0].lanUrl);
    else if (list.length === 0) setSelectedUrl('');
  }, [electron]);

  // Auto-discover once when viewing the panel while not yet connected.
  useEffect(() => {
    if (conn.role !== 'secondary' && !discoverDone) void runDiscovery();
  }, [conn.role, discoverDone, runDiscovery]);

  const handlePair = async () => {
    // Use the discovered URL unless the user opened Advanced / Manual IP.
    const targetUrl = showManual ? primaryIp : (selectedUrl || primaryIp);
    setPairing(true);
    setPairMsg(null);
    const res = await pairWithPrimary(targetUrl, code);
    setPairing(false);
    if (res.ok) {
      setPairMsg({ ok: true, text: tr('Connected to Primary ✓', 'Conectado a Principal ✓', 'Conectado ao Principal ✓') });
      setCode('');
      requestMirrorResync(); // hydrate the in-memory mirror immediately
      refresh();
    } else {
      const map: Record<string, string> = {
        invalid_code: tr('Invalid code', 'Código inválido', 'Código inválido'),
        expired: tr('Code expired — ask the Primary to generate a new one', 'Código expirado — pide uno nuevo en la Principal', 'Código expirado — peça um novo no Principal'),
        too_many_attempts: tr('Too many attempts — regenerate the code on the Primary', 'Demasiados intentos — regenera el código en la Principal', 'Muitas tentativas — gere o código novamente no Principal'),
        unreachable: tr('Primary unreachable — check the IP and same WiFi', 'No se alcanza la Principal — revisa la IP y misma WiFi', 'Principal inacessível — verifique o IP e a mesma WiFi'),
        timeout: tr('Connection timed out', 'Tiempo de conexión agotado', 'Tempo de conexão esgotado'),
        not_local: tr('Rejected — devices must be on the same local network', 'Rechazado — deben estar en la misma red local', 'Rejeitado — devem estar na mesma rede local'),
        bad_url: tr('Invalid IP/URL', 'IP/URL inválida', 'IP/URL inválido'),
      };
      setPairMsg({ ok: false, text: map[res.error || ''] || tr('Pairing failed', 'Falló el emparejamiento', 'Falha no emparelhamento') });
    }
  };

  const handleDisconnect = () => { disconnectSecondary(); setConn(getConnection()); setPairMsg(null); setSnapshot(null); setOpAck(null); setLic(null); };

  const handleCheckLicense = useCallback(async () => {
    setLicChecking(true);
    const r = await resolveInheritedLicense();
    setLic(r);
    setLicChecking(false);
  }, []);

  // Auto-check inherited license once when viewing the connected Secondary.
  useEffect(() => {
    if (conn.role === 'secondary' && !lic) {
      const cached = getInheritedLicense();
      if (cached) setLic({ valid: cached.valid, tier: cached.tier, grace: false, checkedAt: cached.checkedAt, primaryName: cached.primaryName, reason: 'grace' });
      void handleCheckLicense();
    }
  }, [conn.role, lic, handleCheckLicense]);

  const handleSendTestOp = async () => {
    setOpSending(true);
    setOpAck(null);
    const res = await sendTestOperation('hello from secondary');
    setOpSending(false);
    if (res.ok) {
      setOpAck({ ok: true, text: `${tr('Ack received', 'Ack recibido', 'Ack recebido')} · ${tr('op', 'op', 'op')} ${(res.operationId || '').slice(0, 8)} · ${res.receivedAt ? new Date(res.receivedAt).toLocaleTimeString() : ''}` });
    } else {
      const map: Record<string, string> = {
        unauthorized: tr('Not authorized — re-pair', 'No autorizado — vuelve a vincular', 'Não autorizado — vincule novamente'),
        unsupported_operation: tr('Operation type rejected', 'Tipo de operación rechazado', 'Tipo de operação rejeitado'),
        unreachable: tr('Primary unreachable', 'Principal inalcanzable', 'Principal inacessível'),
        timeout: tr('Timed out', 'Tiempo agotado', 'Tempo esgotado'),
        not_paired: tr('Not paired', 'No vinculado', 'Não vinculado'),
      };
      setOpAck({ ok: false, text: map[res.error || ''] || tr('Operation failed', 'Falló la operación', 'Falha na operação') });
    }
  };

  const handleFetchSnapshot = async () => {
    setFetching(true);
    setSnapErr(null);
    const res = await fetchSnapshot();
    setFetching(false);
    if (res.ok) {
      setSnapshot(res);
    } else {
      const map: Record<string, string> = {
        unauthorized: tr('Not authorized — re-pair with the Primary', 'No autorizado — vuelve a vincular con la Principal', 'Não autorizado — vincule novamente ao Principal'),
        unreachable: tr('Primary unreachable — is it on and on the same WiFi?', '¿La Principal está encendida y en la misma WiFi?', 'O Principal está ligado e na mesma WiFi?'),
        timeout: tr('Request timed out', 'Tiempo de espera agotado', 'Tempo esgotado'),
        not_paired: tr('Not paired', 'No vinculado', 'Não vinculado'),
      };
      setSnapErr(map[res.error || ''] || tr('Could not fetch snapshot', 'No se pudo obtener el snapshot', 'Não foi possível obter o snapshot'));
    }
  };

  const saveDeviceName = (v: string) => { setDeviceNameState(v); setDeviceName(v); };

  // ── styles ──
  const card: React.CSSProperties = { background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 12, padding: '1.1rem 1.25rem', marginBottom: '1rem' };
  const label: React.CSSProperties = { fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.35rem', display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '0.55rem 0.75rem', background: '#0a1120', border: '1px solid rgba(148,163,184,0.15)', borderRadius: 8, color: '#e2e8f0', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
  const btn = (bg: string, color: string): React.CSSProperties => ({ padding: '0.55rem 1rem', borderRadius: 8, border: 'none', background: bg, color, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' });

  const minsLeft = status?.codeExpiresAt ? Math.max(0, Math.ceil((status.codeExpiresAt - Date.now()) / 60000)) : 0;

  if (!electron) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white mb-1">📡 {tr('Local Network', 'Red Local', 'Rede Local')}</h2>
        <div style={{ ...card, color: '#f59e0b', fontSize: '0.85rem' }}>
          {tr('Local network pairing requires the desktop app (not browser dev).', 'El emparejamiento por red local requiere la app de escritorio (no el navegador).', 'O emparelhamento por rede local requer o app desktop (não o navegador).')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-white mb-1">📡 {tr('Local Network', 'Red Local', 'Rede Local')}</h2>
      <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem' }}>
        {tr('Connect a second computer over the same WiFi — no cloud, no account.',
            'Conecta una segunda computadora por la misma WiFi — sin nube, sin cuenta.',
            'Conecte um segundo computador pela mesma WiFi — sem nuvem, sem conta.')}
      </p>

      {/* This device name */}
      <div style={card}>
        <label style={label}>{tr('This computer name', 'Nombre de esta computadora', 'Nome deste computador')}</label>
        <input style={input} value={deviceName} maxLength={60}
          onChange={(e) => saveDeviceName(e.target.value)}
          placeholder={tr('e.g. Front Counter', 'ej. Mostrador', 'ex. Balcão')} />
      </div>

      {/* PRIMARY */}
      <div style={card}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '0.6rem' }}>
          🖥️ {tr('Primary Computer', 'Computadora Principal', 'Computador Principal')}
        </div>
        {!status?.running ? (
          <>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.7rem' }}>
              {tr('Enable this computer as the Primary so others can connect to it.',
                  'Habilita esta computadora como Principal para que otras se conecten.',
                  'Ative este computador como Principal para que outros se conectem.')}
            </p>
            <button style={btn('linear-gradient(135deg,#6366f1,#8b5cf6)', '#fff')} onClick={handleEnablePrimary}>
              {tr('Enable Primary Computer', 'Habilitar como Principal', 'Ativar como Principal')}
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={label}>{tr('Primary address (IP)', 'Dirección (IP)', 'Endereço (IP)')}</label>
                <div style={{ ...input, fontFamily: 'monospace', color: '#7dd3fc' }}>{status.lanUrl || tr('No LAN detected', 'Sin LAN detectada', 'Sem LAN detectada')}</div>
              </div>
              <div>
                <label style={label}>{tr('Paired devices', 'Dispositivos vinculados', 'Dispositivos vinculados')}</label>
                <div style={{ ...input, color: '#e2e8f0' }}>{status.pairedCount ?? 0}</div>
              </div>
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={label}>{tr('6-digit pairing code', 'Código de 6 dígitos', 'Código de 6 dígitos')}</label>
              {status.code ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.4rem', color: '#34d399', fontFamily: 'monospace' }}>{status.code}</span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {tr(`expires in ${minsLeft} min`, `expira en ${minsLeft} min`, `expira em ${minsLeft} min`)}
                  </span>
                </div>
              ) : (
                <p style={{ fontSize: '0.8rem', color: '#f59e0b' }}>{tr('No active code — generate one to pair a device.', 'Sin código activo — genera uno para vincular.', 'Sem código ativo — gere um para vincular.')}</p>
              )}
            </div>
            {/* PHASE 2: snapshot endpoint state */}
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>
              📤 {tr('Snapshot endpoint active', 'Endpoint de snapshot activo', 'Endpoint de snapshot ativo')}
              {status.snapshotServed
                ? ` · ${tr('last shared', 'compartido', 'compartilhado')} ${new Date(status.snapshotServed.generatedAt || status.snapshotServed.receivedAt).toLocaleTimeString()}${status.snapshotServed.stale ? ` (${tr('stale', 'desactualizado', 'desatualizado')})` : ''}`
                : ` · ${tr('preparing…', 'preparando…', 'preparando…')}`}
            </div>
            {/* PHASE 3A: last test operation received from a Secondary */}
            {lastIncoming && (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.75rem', padding: '0.4rem 0.6rem', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.18)', borderRadius: 7 }}>
                📨 {tr('Last test op', 'Última op de prueba', 'Última op de teste')}: <span style={{ fontFamily: 'monospace', color: '#c4b5fd' }}>{lastIncoming.type}</span>
                {' · '}{new Date(lastIncoming.receivedAt).toLocaleTimeString()}
                {lastIncoming.message ? ` · "${lastIncoming.message}"` : ''}
                <div style={{ fontSize: '0.68rem', color: '#475569', fontFamily: 'monospace', marginTop: '0.15rem' }}>{tr('from', 'de', 'de')} {lastIncoming.deviceId}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button style={btn('rgba(56,189,248,0.12)', '#7dd3fc')} onClick={handleRegen}>
                🔄 {tr('New code', 'Nuevo código', 'Novo código')}
              </button>
              <button style={btn('rgba(239,68,68,0.1)', '#fca5a5')} onClick={handleStopPrimary}>
                {tr('Stop Primary', 'Detener Principal', 'Parar Principal')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* SECONDARY */}
      <div style={card}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '0.6rem' }}>
          💻 {tr('Connect to a Primary', 'Conectar a una Principal', 'Conectar a um Principal')}
        </div>
        {conn.role === 'secondary' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ color: '#34d399', fontSize: '0.9rem', fontWeight: 600 }}>
                ✓ {tr('Connected to', 'Conectado a', 'Conectado a')} {conn.primaryName || conn.primaryUrl}
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace', marginTop: '0.2rem' }}>{conn.primaryUrl}</div>
              </div>
              <button style={btn('rgba(239,68,68,0.1)', '#fca5a5')} onClick={handleDisconnect}>
                {tr('Disconnect', 'Desconectar', 'Desconectar')}
              </button>
            </div>

            {/* PHASE 2 read-only banner */}
            <div style={{ padding: '0.55rem 0.75rem', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, fontSize: '0.78rem', color: '#fbbf24', marginBottom: '0.5rem' }}>
              👁️ {tr('Read-only mirror mode. Sales from this computer are not enabled yet.',
                      'Modo espejo de solo lectura. Las ventas desde esta computadora aún no están habilitadas.',
                      'Modo espelho somente leitura. Vendas a partir deste computador ainda não estão habilitadas.')}
            </div>

            {/* LAN-CONNECTION-STATE-UX-V1: connection-state line (keyed off
                connState, so it doesn't flash "Syncing…" on every poll). */}
            {(() => {
              const cs = mirror?.connState || 'connecting';
              const when = mirror?.lastSyncAt ? new Date(mirror.lastSyncAt).toLocaleTimeString() : null;
              const c =
                cs === 'connected'   ? { color: '#34d399', icon: '🟢', text: tr('Live mirror active', 'Espejo en vivo activo', 'Espelho ao vivo ativo') } :
                cs === 'reconnected' ? { color: '#34d399', icon: '✅', text: tr('Reconnected to Primary', 'Reconectado a la Principal', 'Reconectado ao Principal') } :
                cs === 'offline'     ? { color: '#fbbf24', icon: '⚠️', text: tr('Primary offline — showing last synced data', 'Principal sin conexión — mostrando los últimos datos', 'Principal offline — mostrando os últimos dados') } :
                                       { color: '#94a3b8', icon: '🔄', text: tr('Waiting for Primary connection…', 'Esperando conexión con la Principal…', 'Aguardando conexão com o Principal…') };
              return (
                <div style={{ fontSize: '0.75rem', color: c.color, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {c.icon} {c.text}
                  {when && (cs === 'connected' || cs === 'reconnected' || cs === 'offline') && (
                    <span style={{ color: '#64748b' }}>
                      · {tr('last sync', 'última sincronización', 'última sincronização')} {when}
                      {mirror?.stale && cs === 'connected' ? ` · ${tr('stale', 'desactualizado', 'desatualizado')}` : ''}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* LAN-LICENSE-INHERITANCE-V1: inherited license status */}
            <div style={{ padding: '0.55rem 0.75rem', background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8, fontSize: '0.78rem', marginBottom: '0.75rem' }}>
              {lic && lic.valid ? (
                <div style={{ color: lic.grace ? '#fbbf24' : '#34d399' }}>
                  🔑 {tr('License inherited from Primary', 'Licencia heredada de la Principal', 'Licença herdada do Principal')}
                  {lic.tier ? ` · ${lic.tier.toUpperCase()}` : ''}
                  {lic.grace
                    ? ` · ⚠️ ${tr('offline — grace mode', 'sin conexión — modo de gracia', 'offline — modo de carência')}`
                    : ` · ${tr('verified', 'verificado', 'verificado')}`}
                  {lic.checkedAt ? (
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.15rem' }}>
                      {tr('last checked', 'última verificación', 'última verificação')} {new Date(lic.checkedAt).toLocaleTimeString()}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ color: '#94a3b8' }}>
                  🔑 {licChecking
                    ? tr('Checking license…', 'Verificando licencia…', 'Verificando licença…')
                    : tr('No inherited license — the Primary may be offline or unlicensed.',
                         'Sin licencia heredada — la Principal puede estar sin conexión o sin licencia.',
                         'Sem licença herdada — o Principal pode estar offline ou sem licença.')}
                </div>
              )}
              <button style={{ ...btn('rgba(52,211,153,0.1)', '#6ee7b7'), padding: '0.3rem 0.7rem', fontSize: '0.75rem', marginTop: '0.45rem', opacity: licChecking ? 0.5 : 1 }} disabled={licChecking} onClick={handleCheckLicense}>
                🔄 {tr('Re-check license', 'Re-verificar licencia', 'Reverificar licença')}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button style={{ ...btn('rgba(56,189,248,0.12)', '#7dd3fc'), opacity: fetching ? 0.5 : 1 }} disabled={fetching} onClick={handleFetchSnapshot}>
                {fetching ? tr('Fetching…', 'Obteniendo…', 'Buscando…') : `⬇️ ${tr('Fetch Snapshot', 'Obtener Snapshot', 'Obter Snapshot')}`}
              </button>
              {/* PHASE 3A: harmless test operation (no business data) */}
              <button style={{ ...btn('rgba(167,139,250,0.12)', '#c4b5fd'), opacity: opSending ? 0.5 : 1 }} disabled={opSending} onClick={handleSendTestOp}>
                {opSending ? tr('Sending…', 'Enviando…', 'Enviando…') : `📨 ${tr('Send Test Operation', 'Enviar Operación de Prueba', 'Enviar Operação de Teste')}`}
              </button>
            </div>
            {snapErr && <p style={{ fontSize: '0.82rem', color: '#fca5a5', marginTop: '0.5rem' }}>{snapErr}</p>}
            {opAck && <p style={{ fontSize: '0.82rem', marginTop: '0.5rem', color: opAck.ok ? '#34d399' : '#fca5a5' }}>{opAck.ok ? '✓ ' : '✕ '}{opAck.text}</p>}

            {snapshot && snapshot.counts && (
              <div style={{ marginTop: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>
                  <span>{tr('From', 'De', 'De')}: <strong style={{ color: '#cbd5e1' }}>{snapshot.primaryName}</strong></span>
                  {snapshot.generatedAt && <span>· {new Date(snapshot.generatedAt).toLocaleTimeString()}</span>}
                  {snapshot.stale && <span style={{ color: '#fbbf24' }}>· {tr('stale', 'desactualizado', 'desatualizado')}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                  {([
                    ['customers', tr('Customers', 'Clientes', 'Clientes')],
                    ['inventory', tr('Inventory', 'Inventario', 'Inventário')],
                    ['sales', tr('Sales', 'Ventas', 'Vendas')],
                    ['repairs', tr('Repairs', 'Reparaciones', 'Reparos')],
                    ['layaways', tr('Layaways', 'Apartados', 'Reservas')],
                    ['unlocks', tr('Unlocks', 'Desbloqueos', 'Desbloqueios')],
                    ['specialOrders', tr('Special Orders', 'Órdenes Esp.', 'Pedidos Esp.')],
                    ['appointments', tr('Appointments', 'Citas', 'Agendamentos')],
                  ] as const).map(([key, lbl]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: '#0a1120', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 7 }}>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{lbl}</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>{snapshot.counts![key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* LOCAL-LAN-AUTO-DISCOVERY-V1: discovery status + result */}
            {!showManual && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <label style={{ ...label, marginBottom: 0 }}>{tr('Primary on this network', 'Principal en esta red', 'Principal nesta rede')}</label>
                  <button style={{ ...btn('rgba(56,189,248,0.12)', '#7dd3fc'), padding: '0.3rem 0.7rem', fontSize: '0.72rem', opacity: discovering ? 0.5 : 1 }} disabled={discovering} onClick={runDiscovery}>
                    {discovering ? tr('Searching…', 'Buscando…', 'Procurando…') : `🔍 ${tr('Search again', 'Buscar de nuevo', 'Buscar novamente')}`}
                  </button>
                </div>
                {discovering ? (
                  <div style={{ ...input, color: '#94a3b8' }}>{tr('Looking for a Primary…', 'Buscando una Principal…', 'Procurando um Principal…')}</div>
                ) : discovered.length === 1 ? (
                  <div style={{ ...input, color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    ✓ {discovered[0].primaryName}
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>{discovered[0].lanUrl}</span>
                  </div>
                ) : discovered.length > 1 ? (
                  <select style={{ ...input, fontFamily: 'monospace' }} value={selectedUrl} onChange={(e) => setSelectedUrl(e.target.value)}>
                    <option value="">{tr('Select a Primary…', 'Selecciona una Principal…', 'Selecione um Principal…')}</option>
                    {discovered.map((p) => (
                      <option key={p.lanUrl} value={p.lanUrl}>{p.primaryName} — {p.lanUrl}</option>
                    ))}
                  </select>
                ) : discoverDone ? (
                  <div style={{ ...input, color: '#f59e0b', fontSize: '0.8rem' }}>
                    {tr('Could not find Primary. Use Manual IP below.', 'No se encontró la Principal. Usa IP manual abajo.', 'Não foi possível encontrar o Principal. Use IP manual abaixo.')}
                  </div>
                ) : null}
              </div>
            )}

            {/* Advanced / Manual IP — hidden behind a toggle */}
            <div style={{ marginBottom: '0.75rem' }}>
              <button style={{ ...btn('transparent', '#64748b'), padding: '0.2rem 0', fontSize: '0.75rem', textDecoration: 'underline' }} onClick={() => setShowManual((v) => !v)}>
                {showManual ? `▾ ${tr('Hide manual IP', 'Ocultar IP manual', 'Ocultar IP manual')}` : `▸ ${tr('Advanced / Manual IP', 'Avanzado / IP manual', 'Avançado / IP manual')}`}
              </button>
              {showManual && (
                <div style={{ marginTop: '0.4rem' }}>
                  <label style={label}>{tr('Primary IP', 'IP de la Principal', 'IP do Principal')}</label>
                  <input style={{ ...input, fontFamily: 'monospace' }} value={primaryIp} onChange={(e) => setPrimaryIp(e.target.value)} placeholder="192.168.1.50" />
                </div>
              )}
            </div>

            {/* 6-digit code — the primary action */}
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={label}>{tr('6-digit code from the Primary', 'Código de 6 dígitos de la Principal', 'Código de 6 dígitos do Principal')}</label>
              <input style={{ ...input, fontFamily: 'monospace', letterSpacing: '0.3rem', fontSize: '1.1rem' }} value={code} maxLength={6} inputMode="numeric"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
            </div>

            {(() => {
              const targetUrl = showManual ? primaryIp.trim() : (selectedUrl || primaryIp.trim());
              const canPair = !pairing && code.length === 6 && targetUrl.length > 0;
              return (
                <button style={{ ...btn('linear-gradient(135deg,#10b981,#059669)', '#fff'), opacity: canPair ? 1 : 0.5 }}
                  disabled={!canPair}
                  onClick={handlePair}>
                  {pairing ? tr('Pairing…', 'Vinculando…', 'Vinculando…') : tr('Pair', 'Vincular', 'Vincular')}
                </button>
              );
            })()}
            {pairMsg && (
              <p style={{ fontSize: '0.82rem', marginTop: '0.6rem', color: pairMsg.ok ? '#34d399' : '#fca5a5' }}>{pairMsg.text}</p>
            )}
          </>
        )}
      </div>

      <p style={{ fontSize: '0.72rem', color: '#475569', fontStyle: 'italic' }}>
        {tr('Read-only mirror: the Secondary shows the Primary’s live data. Selling from the Secondary comes in a later update.',
            'Espejo de solo lectura: la Secundaria muestra los datos en vivo de la Principal. Vender desde la Secundaria llega en una actualización posterior.',
            'Espelho somente leitura: o Secundário mostra os dados ao vivo do Principal. Vender pelo Secundário virá em uma atualização posterior.')}
      </p>
    </div>
  );
}
