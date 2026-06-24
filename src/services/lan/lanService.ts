// ============================================================
// CellHub Pro — LAN Pairing renderer service (LOCAL-LAN-PAIRING-PHASE-1-V1)
//
// Thin wrapper around the Electron `electronAPI.lan*` IPC channels plus the
// local role/connection state (localStorage). PHASE 1 = handshake only:
// this does NOT redirect persist, mirror data, or disable POS. It just
// records "we are paired" so a later phase can build sync on top.
// ============================================================

export type LanRole = 'standalone' | 'primary' | 'secondary';

export interface LanConnection {
  role: LanRole;
  primaryUrl?: string;   // secondary: URL of the primary it paired with
  token?: string;        // secondary: trusted token issued by the primary
  primaryName?: string;  // secondary: friendly name of the primary
  pairedAt?: string;     // ISO
  deviceId: string;      // this device's stable id
  deviceName: string;    // this device's friendly name
}

const ROLE_KEY = 'cellhub:lan:connection:v1';
const DEVICE_ID_KEY = 'computer_id'; // reuse MultiStoreProvider's id when present

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.lanGetStatus;
}

// ── Device identity (reuses the existing computer_id) ──
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY) || '';
    if (!id) {
      id = `PC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'PC-unknown';
  }
}

export function getDeviceName(): string {
  try { return localStorage.getItem('cellhub:lan:deviceName:v1') || 'CellHub Computer'; }
  catch { return 'CellHub Computer'; }
}
export function setDeviceName(name: string): void {
  try { localStorage.setItem('cellhub:lan:deviceName:v1', name.slice(0, 60)); } catch { /* ignore */ }
}

// ── Local connection state ──
export function getConnection(): LanConnection {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LanConnection>;
      return {
        role: parsed.role || 'standalone',
        primaryUrl: parsed.primaryUrl,
        token: parsed.token,
        primaryName: parsed.primaryName,
        pairedAt: parsed.pairedAt,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
      };
    }
  } catch { /* fall through */ }
  return { role: 'standalone', deviceId: getDeviceId(), deviceName: getDeviceName() };
}

function setConnection(c: Partial<LanConnection>): void {
  const next = { ...getConnection(), ...c };
  try { localStorage.setItem(ROLE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

export function clearConnection(): void {
  try { localStorage.removeItem(ROLE_KEY); } catch { /* ignore */ }
}

// ── Primary controls ──
export async function startPrimary(primaryName: string): Promise<LanStatus> {
  if (!isElectron()) return { running: false, error: 'not_electron' };
  const status = await window.electronAPI!.lanStartPrimary({ primaryName });
  if (status.running) setConnection({ role: 'primary' });
  return status;
}

export async function stopPrimary(): Promise<{ running: boolean }> {
  if (!isElectron()) return { running: false };
  const res = await window.electronAPI!.lanStopPrimary();
  // Stopping the server returns this machine to standalone (it was a primary).
  if (getConnection().role === 'primary') setConnection({ role: 'standalone' });
  return res;
}

export async function getStatus(): Promise<LanStatus> {
  if (!isElectron()) return { running: false, error: 'not_electron' };
  return window.electronAPI!.lanGetStatus();
}

export async function generateCode(): Promise<LanStatus> {
  if (!isElectron()) return { running: false, error: 'not_electron' };
  return window.electronAPI!.lanGeneratePairCode();
}

// ── Secondary control ──
export async function pairWithPrimary(primaryUrl: string, code: string): Promise<LanPairResult> {
  if (!isElectron()) return { ok: false, error: 'not_electron' };
  const result = await window.electronAPI!.lanPairWithPrimary({
    primaryUrl: normalizeUrl(primaryUrl),
    code: code.trim(),
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
  });
  if (result.ok && result.token) {
    setConnection({
      role: 'secondary',
      primaryUrl: result.primaryUrl || normalizeUrl(primaryUrl),
      token: result.token,
      primaryName: result.primaryName,
      pairedAt: new Date().toISOString(),
    });
  }
  return result;
}

export function disconnectSecondary(): void {
  if (getConnection().role === 'secondary') setConnection({ role: 'standalone', primaryUrl: undefined, token: undefined, primaryName: undefined, pairedAt: undefined });
}

// R-PROMOTE-TO-PRIMARY: flip this machine from Secondary to Primary and sever
// the old-Primary link. Clearing primaryUrl/token disables operation
// forwarding (every forwarder bails when role !== 'secondary') and the
// read-only persist guard (which keys off role === 'secondary'), so normal
// local persistence + local hardware ownership resume. Caller is responsible
// for the Admin-PIN gate and split-brain check BEFORE calling this — there is
// NO automatic promotion anywhere.
export function promoteToPrimaryRole(): void {
  setConnection({ role: 'primary', primaryUrl: undefined, token: undefined, primaryName: undefined, pairedAt: undefined });
}

// ── Auto-discovery (LOCAL-LAN-AUTO-DISCOVERY-V1) ──
// Listen for Primary UDP beacons on the LAN. Returns convenience candidates
// only — pairing still requires the 6-digit code. No-op outside Electron.
export async function discoverPrimaries(timeoutMs = 3500): Promise<LanDiscoveryResult> {
  if (!isElectron() || !window.electronAPI?.lanDiscoverPrimaries) {
    return { ok: false, error: 'not_electron', primaries: [] };
  }
  return window.electronAPI.lanDiscoverPrimaries({ timeoutMs });
}

// Nudge the global secondary mirror to re-fetch immediately (e.g. right after
// pairing) instead of waiting for the next auto-refresh tick. Pure event — no
// state, no persist.
export const LAN_RESYNC_EVENT = 'cellhub:lan-resync';
export function requestMirrorResync(): void {
  try { window.dispatchEvent(new CustomEvent(LAN_RESYNC_EVENT)); } catch { /* ignore */ }
}

// LAN-HARDWARE-BRIDGE-FOUNDATION-V1: result of a forwarded receipt print. The
// print funnel (usePrint) is non-React, so it emits this event and a global
// <LanPrintBridgeListener> turns it into a localized toast.
export const LAN_PRINT_RESULT_EVENT = 'cellhub:lan-print-result';
export interface LanPrintResultDetail { ok: boolean; error?: string }
export function emitLanPrintResult(detail: LanPrintResultDetail): void {
  try { window.dispatchEvent(new CustomEvent(LAN_PRINT_RESULT_EVENT, { detail })); } catch { /* ignore */ }
}

// ── Snapshot (PHASE 2, read-only) ──
// Sensitive settings fields stripped before a snapshot ever leaves the
// Primary. PIN hashes / Firebase config / detected printers are never shared.
const SETTINGS_SECRET_KEYS = ['adminPin', 'firebaseConfig', 'detectedPrinters'];

export interface SnapshotState {
  customers?: unknown[]; inventory?: unknown[]; sales?: unknown[]; repairs?: unknown[];
  layaways?: unknown[]; unlocks?: unknown[]; specialOrders?: unknown[]; appointments?: unknown[];
  settings?: Record<string, unknown>;
}

/** Pure: assemble the read-only snapshot from current app state. No business
 *  logic, no mutation — just collects collections + counts and strips secrets. */
export function buildSnapshot(state: SnapshotState, primaryName: string): LanSnapshot {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const settings = { ...(state.settings || {}) };
  for (const k of SETTINGS_SECRET_KEYS) delete settings[k];
  const counts: LanSnapshotCounts = {
    customers: arr(state.customers).length,
    inventory: arr(state.inventory).length,
    sales: arr(state.sales).length,
    repairs: arr(state.repairs).length,
    layaways: arr(state.layaways).length,
    unlocks: arr(state.unlocks).length,
    specialOrders: arr(state.specialOrders).length,
    appointments: arr(state.appointments).length,
  };
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    primaryName,
    storeId: String((settings as { storeId?: string }).storeId || 'default'),
    computerId: getDeviceId(),
    counts,
    data: {
      customers: arr(state.customers),
      inventory: arr(state.inventory),
      sales: arr(state.sales),
      repairs: arr(state.repairs),
      layaways: arr(state.layaways),
      unlocks: arr(state.unlocks),
      specialOrders: arr(state.specialOrders),
      appointments: arr(state.appointments),
      settings,
    },
  };
}

/** Primary: push the current snapshot to main (which serves it over /snapshot). */
export async function pushSnapshot(snap: LanSnapshot): Promise<void> {
  if (!isElectron() || !window.electronAPI?.lanSetSnapshot) return;
  try { await window.electronAPI.lanSetSnapshot(snap); } catch { /* best-effort */ }
}

/** Secondary: fetch the read-only snapshot from the paired Primary. */
export async function fetchSnapshot(): Promise<LanSnapshotResult> {
  if (!isElectron() || !window.electronAPI?.lanFetchSnapshot) return { ok: false, error: 'not_electron' };
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) {
    return { ok: false, error: 'not_paired' };
  }
  return window.electronAPI.lanFetchSnapshot({ primaryUrl: conn.primaryUrl, token: conn.token });
}

// ── Operation forwarding skeleton (PHASE 3A) ──
function randomId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* fall through */ }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Secondary: send the harmless LAN_PING_OPERATION to the paired Primary.
 *  Proves the mutation pipeline — touches NO business data. */
export async function sendTestOperation(message = 'ping'): Promise<LanOperationAck> {
  if (!isElectron() || !window.electronAPI?.lanSendOperation) return { ok: false, error: 'not_electron' };
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) {
    return { ok: false, error: 'not_paired' };
  }
  const operation: LanOperation = {
    operationId: randomId(),
    type: 'LAN_PING_OPERATION',
    payload: { message: message.slice(0, 200) },
    deviceId: getDeviceId(),
    createdAt: Date.now(),
  };
  return window.electronAPI.lanSendOperation({ primaryUrl: conn.primaryUrl, token: conn.token, operation });
}

// ── LAN-PHASE-3B-CREATE-CUSTOMER-FORWARDING-V1 ──
// Secondary: forward a CREATE_CUSTOMER operation to the paired Primary. The
// Primary creates + persists the customer and returns the ACK (with the created
// id, or duplicate:true). NOTHING is persisted on the Secondary — on ACK success
// we trigger an immediate mirror re-sync so the new customer appears from the
// Primary's snapshot. Returns a clear error (not_paired / unreachable / timeout)
// so the caller can show friendly feedback without ever saving a local record.
export interface LanCreateCustomerInput {
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  communicationConsent?: boolean;
}
export async function sendCreateCustomer(input: LanCreateCustomerInput): Promise<LanOperationAck> {
  if (!isElectron() || !window.electronAPI?.lanSendOperation) return { ok: false, error: 'not_electron' };
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) {
    return { ok: false, error: 'not_paired' };
  }
  const customer: LanCustomerPayload = {
    firstName: (input.firstName || '').trim().slice(0, 80),
    lastName: (input.lastName || '').trim().slice(0, 80),
    name: (input.name || '').trim().slice(0, 160),
    phone: (input.phone || '').slice(0, 40),
    email: (input.email || '').trim().slice(0, 120),
    notes: (input.notes || '').slice(0, 500),
    communicationConsent: !!input.communicationConsent,
  };
  const operation: LanOperation = {
    operationId: randomId(),
    type: 'CREATE_CUSTOMER',
    payload: { customer },
    deviceId: getDeviceId(),
    createdAt: Date.now(),
  };
  const ack = await window.electronAPI.lanSendOperation({ primaryUrl: conn.primaryUrl, token: conn.token, operation });
  // On success, pull the Primary's fresh snapshot so the new customer shows in
  // the mirror immediately (the Primary dispatcher pushes a fresh snapshot
  // before ACKing, so the re-fetch is guaranteed to include it).
  if (ack && ack.ok) requestMirrorResync();
  return ack;
}

// ── LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1 ──
// Secondary: forward a customer-note add to the paired Primary. Nothing is
// persisted on the Secondary; on ACK success the mirror re-syncs so the
// appended note shows from the Primary's snapshot.
export async function sendCustomerNote(input: { customerId: string; text: string }): Promise<LanOperationAck> {
  if (!isElectron() || !window.electronAPI?.lanSendOperation) return { ok: false, error: 'not_electron' };
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) {
    return { ok: false, error: 'not_paired' };
  }
  const customerId = String(input.customerId || '');
  const text = (input.text || '').trim().slice(0, 1000);
  if (!customerId || !text) return { ok: false, error: 'bad_payload' };
  const operation: LanOperation = {
    operationId: randomId(),
    type: 'LAN_CUSTOMER_NOTE_ADD',
    payload: { note: { customerId, text, timestamp: Date.now() } },
    deviceId: getDeviceId(),
    createdAt: Date.now(),
  };
  const ack = await window.electronAPI.lanSendOperation({ primaryUrl: conn.primaryUrl, token: conn.token, operation });
  if (ack && ack.ok) requestMirrorResync();
  return ack;
}

// ── LAN-OPERATION-FORWARDING-APPOINTMENT-V1 ──
// Secondary: forward an appointment create to the paired Primary. Nothing is
// persisted on the Secondary; on ACK success the mirror re-syncs so the new
// appointment shows from the Primary's snapshot.
export interface LanCreateAppointmentInput {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  device?: string;
  issue?: string;
  estimatedDropOff?: string;
  notes?: string;
  employeeName?: string;
}
export async function sendCreateAppointment(input: LanCreateAppointmentInput): Promise<LanOperationAck> {
  if (!isElectron() || !window.electronAPI?.lanSendOperation) return { ok: false, error: 'not_electron' };
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) {
    return { ok: false, error: 'not_paired' };
  }
  const appointment: LanAppointmentPayload = {
    customerId: (input.customerId || '').slice(0, 80) || undefined,
    customerName: (input.customerName || '').trim().slice(0, 160),
    customerPhone: (input.customerPhone || '').slice(0, 40),
    device: (input.device || '').trim().slice(0, 120),
    issue: (input.issue || '').trim().slice(0, 500),
    estimatedDropOff: (input.estimatedDropOff || '').slice(0, 40),
    notes: (input.notes || '').slice(0, 1000),
    employeeName: (input.employeeName || '').slice(0, 80) || undefined,
  };
  if (!appointment.device || !appointment.issue) return { ok: false, error: 'bad_payload' };
  const operation: LanOperation = {
    operationId: randomId(),
    type: 'CREATE_APPOINTMENT',
    payload: { appointment },
    deviceId: getDeviceId(),
    createdAt: Date.now(),
  };
  const ack = await window.electronAPI.lanSendOperation({ primaryUrl: conn.primaryUrl, token: conn.token, operation });
  if (ack && ack.ok) requestMirrorResync();
  return ack;
}

// ── LAN-HARDWARE-BRIDGE-FOUNDATION-V1 ──
// Secondary: forward a rendered receipt to the Primary, which prints it on its
// own default printer. NOT idempotent — printing must NOT be auto-retried, so
// this sends exactly once and surfaces the Primary's success/failure as-is.
export interface LanPrintReceiptInput {
  receiptType?: string;
  html: string;
  copies?: number;
  pageSize?: { width: number; height: number }; // microns
}
export async function sendPrintReceipt(input: LanPrintReceiptInput): Promise<LanOperationAck> {
  if (!isElectron() || !window.electronAPI?.lanSendOperation) return { ok: false, error: 'not_electron' };
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) return { ok: false, error: 'not_paired' };
  const html = String(input.html || '');
  if (!html) return { ok: false, error: 'bad_payload' };
  const operation: LanOperation = {
    operationId: randomId(),
    type: 'LAN_PRINT_RECEIPT_REQUEST',
    payload: {
      print: {
        receiptType: String(input.receiptType || 'receipt').slice(0, 40),
        html,
        copies: Math.max(1, Math.min(10, Math.round(input.copies || 1))),
        pageSize: input.pageSize,
        printJobId: randomId(),
        timestamp: Date.now(),
      },
    },
    deviceId: getDeviceId(),
    createdAt: Date.now(),
  };
  return window.electronAPI.lanSendOperation({ primaryUrl: conn.primaryUrl, token: conn.token, operation });
}

// Primary side: last operation received from a Secondary (display only).
// Module-level store — the LanOperationListener writes it, the settings panel
// reads it on its poll. Never touches business state.
let _lastIncomingOp: LanIncomingOperation | null = null;
export function recordIncomingOperation(op: LanIncomingOperation): void { _lastIncomingOp = op; }
export function getLastIncomingOperation(): LanIncomingOperation | null { return _lastIncomingOp; }

/** Subscribe to inbound operations forwarded by Electron main (Primary).
 *  Returns an unsubscribe fn. No-op outside Electron. */
export function onLanOperation(cb: (op: LanIncomingOperation) => void): () => void {
  if (!isElectron() || !window.electronAPI?.onLanOperation) return () => { /* no-op */ };
  return window.electronAPI.onLanOperation(cb);
}

// ── License inheritance (LAN-LICENSE-INHERITANCE-V1) ──
const INHERITED_KEY = 'cellhub:lan:inheritedLicense:v1';
const GRACE_MS = 72 * 60 * 60 * 1000; // 72h offline grace

export interface InheritedLicense {
  checkedAt: number;     // ms — last successful live check
  valid: boolean;
  tier: string;
  expiresAt: string | null;
  primaryName?: string;
  features?: unknown;
}

export interface ResolvedInheritance {
  valid: boolean;
  tier: string;
  features?: unknown;
  grace: boolean;        // true = serving from cache (Primary unreachable)
  checkedAt?: number;
  primaryName?: string;
  reason?: 'live' | 'grace' | 'primary_invalid' | 'expired' | 'unreachable' | 'not_paired';
}

export function getInheritedLicense(): InheritedLicense | null {
  try { const r = localStorage.getItem(INHERITED_KEY); return r ? JSON.parse(r) as InheritedLicense : null; }
  catch { return null; }
}
function setInheritedLicense(rec: InheritedLicense): void {
  try { localStorage.setItem(INHERITED_KEY, JSON.stringify(rec)); } catch { /* ignore */ }
}
export function clearInheritedLicense(): void {
  try { localStorage.removeItem(INHERITED_KEY); } catch { /* ignore */ }
}

/** Secondary: live-fetch the paired Primary's license status. */
export async function fetchPrimaryLicense(): Promise<LanLicenseResult> {
  if (!isElectron() || !window.electronAPI?.lanFetchLicense) return { ok: false, error: 'not_electron' };
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) return { ok: false, error: 'not_paired' };
  return window.electronAPI.lanFetchLicense({ primaryUrl: conn.primaryUrl, token: conn.token });
}

/**
 * Resolve the Secondary's inherited license: live fetch when the Primary is
 * reachable (and cache it), otherwise fall back to the cached check within a
 * 72h grace window. Only meaningful for role === 'secondary'.
 */
export async function resolveInheritedLicense(): Promise<ResolvedInheritance> {
  const conn = getConnection();
  if (conn.role !== 'secondary') return { valid: false, tier: 'none', grace: false, reason: 'not_paired' };

  const res = await fetchPrimaryLicense();
  if (res.ok && res.valid) {
    const rec: InheritedLicense = {
      checkedAt: Date.now(), valid: true, tier: res.tier || 'none',
      expiresAt: res.expiresAt ?? null, primaryName: res.primaryName, features: res.features,
    };
    setInheritedLicense(rec);
    return { valid: true, tier: rec.tier, features: rec.features, grace: false, checkedAt: rec.checkedAt, primaryName: rec.primaryName, reason: 'live' };
  }
  if (res.ok && !res.valid) {
    // Primary reachable but its OWN license is invalid → no inheritance.
    clearInheritedLicense();
    return { valid: false, tier: 'none', grace: false, reason: 'primary_invalid' };
  }
  // Primary unreachable → cached grace.
  const cached = getInheritedLicense();
  if (cached && cached.valid && Date.now() - cached.checkedAt < GRACE_MS) {
    if (cached.expiresAt && new Date(cached.expiresAt).getTime() < Date.now()) {
      return { valid: false, tier: 'none', grace: false, reason: 'expired' };
    }
    return { valid: true, tier: cached.tier, features: cached.features, grace: true, checkedAt: cached.checkedAt, primaryName: cached.primaryName, reason: 'grace' };
  }
  return { valid: false, tier: 'none', grace: false, reason: 'unreachable' };
}

// Accept "192.168.1.50", "192.168.1.50:47615", or a full URL.
export function normalizeUrl(input: string): string {
  const v = (input || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v.replace(/\/$/, '');
  const hasPort = /:\d+$/.test(v);
  return `http://${v}${hasPort ? '' : ':47615'}`;
}

export { isElectron };
