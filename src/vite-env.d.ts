/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_SMS_PROXY_URL?: string;
  // R-BRIDGE-SIGNED-TOKEN-V1: must match BRIDGE_AUTH_SECRET on Railway bridge
  readonly VITE_BRIDGE_AUTH_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Electron preload bridge (available when running in Electron)
// r-pkg-a1: Slimmed to match hardened preload — only channels that the
// renderer actually consumes are declared. Removed: getConfig, saveConfig,
// getVersion, printToPdf, showSaveDialog, writeFile, readFile, openExternal.
interface ElectronAPI {
  checkLicense: () => Promise<{ valid: boolean; tier: string; expiresAt?: string }>;
  activateLicense: (key: string) => Promise<{ success: boolean; tier: string }>;
  getPrinters: () => Promise<Array<{ name: string; displayName?: string; isDefault: boolean; status: number }>>;
  // r-print-audit v2: internal preview + direct print
  printPreview: (payload: {
    html: string;
    pageSize?: { width: number; height: number } | string;
    landscape?: boolean;
    scaleFactor?: number;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
  }) => Promise<{ success: boolean; url?: string; error?: string }>;
  printRun: (payload: {
    html: string;
    deviceName: string;
    pageSize?: { width: number; height: number } | string;
    landscape?: boolean;
    scaleFactor?: number;
    copies?: number;
    color?: boolean;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
    // R-PRINT-PAGE-RANGES-V1: optional page-range filter (Electron expects
    // 1-based, inclusive {from, to} pairs). Empty/undefined = all pages.
    pageRanges?: Array<{ from: number; to: number }>;
  }) => Promise<{ success: boolean; error?: string | null }>;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => void;
  // r-pkg-a2: re-added — triggers download after update-available notification.
  downloadUpdate: () => void;
  // Backup folder
  getBackupFolder: () => Promise<string>;
  setBackupFolder: () => Promise<string | null>;
  // r-batch-a (5): return an unsubscribe function so React useEffect
  // cleanups can remove the listener and prevent leaks on re-mount.
  onUpdateAvailable: (cb: (info: unknown) => void) => () => void;
  onUpdateDownloaded: (cb: (info: unknown) => void) => () => void;
  // LAN pairing (LOCAL-LAN-PAIRING-PHASE-1-V1) — handshake only, no sync.
  lanStartPrimary: (opts?: { primaryName?: string }) => Promise<LanStatus>;
  lanStopPrimary: () => Promise<{ running: boolean }>;
  lanGetStatus: () => Promise<LanStatus>;
  lanGeneratePairCode: () => Promise<LanStatus>;
  lanPairWithPrimary: (opts: {
    primaryUrl: string; code: string; deviceId: string; deviceName: string;
  }) => Promise<LanPairResult>;
  // PHASE 2 (read-only snapshot)
  lanSetSnapshot: (snap: LanSnapshot) => Promise<{ ok: boolean; error?: string }>;
  lanFetchSnapshot: (opts: { primaryUrl: string; token: string }) => Promise<LanSnapshotResult>;
  // PHASE 3A (operation forwarding skeleton)
  lanSendOperation: (opts: { primaryUrl: string; token: string; operation: LanOperation }) => Promise<LanOperationAck>;
  onLanOperation: (cb: (op: LanIncomingOperation) => void) => () => void;
  // LAN-LICENSE-INHERITANCE-V1
  lanFetchLicense: (opts: { primaryUrl: string; token: string }) => Promise<LanLicenseResult>;
  // LOCAL-LAN-AUTO-DISCOVERY-V1
  lanDiscoverPrimaries: (opts?: { timeoutMs?: number }) => Promise<LanDiscoveryResult>;
  // LAN-PHASE-3B-CREATE-CUSTOMER-FORWARDING-V1: Primary renderer dispatcher bridge.
  onLanOperationDispatch: (cb: (req: LanOperationDispatchRequest) => void) => () => void;
  lanSendOperationResult: (payload: { requestId: string; result: LanOperationDispatchResult }) => void;
  // R-PRODUCTION-B3.2: open the local diagnostics logs folder (fixed path).
  openDiagnosticsLogsFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  // R-SECONDARY-FAILOVER-PERSIST: persist the latest LAN mirror snapshot (Secondary).
  saveMirrorFailover: (snapshot: unknown) => Promise<{ ok: boolean; path?: string; reason?: string }>;
  // R-PROMOTE-TO-PRIMARY: read the persisted failover snapshot (manual promotion).
  readMirrorFailover: () => Promise<{ ok: boolean; envelope?: unknown; reason?: string }>;
}

// LOCAL-LAN-AUTO-DISCOVERY-V1 discovery wire types
interface LanDiscoveredPrimary {
  primaryName: string;
  lanUrl: string;
  port: number;
  address: string;
  lastSeen: number;
}
interface LanDiscoveryResult {
  ok: boolean;
  error?: string;
  primaries: LanDiscoveredPrimary[];
}

// LAN-LICENSE-INHERITANCE-V1 license-status wire type
interface LanLicenseResult {
  ok: boolean;
  valid?: boolean;
  tier?: string;
  expiresAt?: string | null;
  isTrial?: boolean;
  daysRemaining?: number | null;
  allowedSecondaryCount?: number;
  primaryName?: string;
  pairedCount?: number;
  features?: unknown;
  error?: string;
}

// PHASE 3A/3B operation types
// LAN-PHASE-3B-CREATE-CUSTOMER-FORWARDING-V1: forwarded customer payload.
interface LanCustomerPayload {
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  communicationConsent?: boolean;
}
// LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1: forwarded customer-note payload.
interface LanCustomerNotePayload {
  customerId: string;
  text: string;
  timestamp?: number;
}
// LAN-OPERATION-FORWARDING-APPOINTMENT-V1: forwarded appointment payload.
interface LanAppointmentPayload {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  device?: string;
  issue?: string;
  estimatedDropOff?: string;
  notes?: string;
  employeeName?: string;
}
// LAN-HARDWARE-BRIDGE-FOUNDATION-V1: forwarded receipt-print payload. The
// Secondary renders the HTML and ships it; the Primary prints on ITS own
// default printer (it never receives/uses a Secondary device name).
interface LanPrintReceiptPayload {
  receiptType: string;
  html: string;
  copies: number;
  pageSize?: { width: number; height: number }; // microns; omitted → Primary default (4x6)
  printJobId: string;
  timestamp: number;
}
// R-LAN-POS-CHECKOUT-FORWARDING: the Secondary builds a completed Sale via the
// existing saleBuilder flow and forwards it; the Primary finalizes it headlessly
// via finalizeSaleCore (never the Primary POS UI). `sale` is the full Sale object
// (typed unknown here — this ambient file cannot import the Sale type).
interface LanCheckoutPayload {
  sale: unknown;
}
interface LanOperation {
  operationId: string;
  type: 'LAN_PING_OPERATION' | 'CREATE_CUSTOMER' | 'LAN_CUSTOMER_NOTE_ADD' | 'CREATE_APPOINTMENT' | 'LAN_PRINT_RECEIPT_REQUEST' | 'LAN_POS_CHECKOUT';
  payload: {
    message?: string;
    customer?: LanCustomerPayload;
    note?: LanCustomerNotePayload;
    appointment?: LanAppointmentPayload;
    print?: LanPrintReceiptPayload;
    checkout?: LanCheckoutPayload;
  };
  deviceId: string;
  createdAt: number;
}
interface LanOperationAck {
  ok: boolean;
  receivedAt?: number;
  operationId?: string;
  type?: string;
  // LAN-PHASE-3B / forwarding result fields.
  customerId?: string;
  appointmentId?: string;
  // LAN-HARDWARE-BRIDGE-FOUNDATION-V1
  printed?: boolean;
  // R-LAN-POS-CHECKOUT-FORWARDING: id of the sale the Primary committed.
  saleId?: string;
  duplicate?: boolean;
  error?: string;
}
// LAN-PHASE-3B: a forwarded op handed from main to the Primary renderer.
interface LanOperationDispatchRequest {
  requestId: string;
  op: LanOperation;
}
interface LanOperationDispatchResult {
  ok: boolean;
  customerId?: string;
  appointmentId?: string;
  printed?: boolean;
  // R-LAN-POS-CHECKOUT-FORWARDING: id of the sale the Primary committed.
  saleId?: string;
  duplicate?: boolean;
  error?: string;
}
interface LanIncomingOperation {
  operationId: string;
  type: string;
  deviceId: string;
  message: string;
  receivedAt: number;
}

// PHASE 2 snapshot types
interface LanSnapshotCounts {
  customers: number; inventory: number; sales: number; repairs: number;
  layaways: number; unlocks: number; specialOrders: number; appointments: number;
}
interface LanSnapshot {
  schemaVersion: number;
  generatedAt: number;
  primaryName: string;
  storeId: string;
  computerId: string;
  counts: LanSnapshotCounts;
  data?: Record<string, unknown> | null;
}
interface LanSnapshotResult extends Partial<LanSnapshot> {
  ok: boolean;
  stale?: boolean;
  error?: string;
}

// LAN pairing wire types
interface LanStatus {
  running: boolean;
  port?: number;
  lanIp?: string | null;
  lanUrl?: string | null;
  primaryName?: string;
  code?: string | null;
  codeExpiresAt?: number | null;
  pairedCount?: number;
  // PHASE 2: snapshot endpoint meta (null until the renderer first pushes one)
  snapshotServed?: { generatedAt?: number | null; receivedAt: number; stale: boolean } | null;
  error?: string;
}
interface LanPairResult {
  ok: boolean;
  token?: string;
  primaryName?: string;
  primaryUrl?: string | null;
  error?: string;
}

interface Window {
  electronAPI?: ElectronAPI;
}
