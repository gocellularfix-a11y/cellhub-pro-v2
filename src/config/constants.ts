import type { StoreSettings } from '@/store/types';

// ── Shared defaults used across modules ──────────────────
// Single source of truth so Dashboard, Inventory, Reports, etc. all agree.
export const DEFAULT_LOW_STOCK_THRESHOLD = 2;

// ── Default Settings ──────────────────────────────────────
// Matches the existing defaults from CellHubProV2 useState(settings)

export const DEFAULT_SETTINGS: StoreSettings = {
  // Store info
  storeName: '',
  storeAddress: '',
  storeCity: '',
  storeState: '',
  storeZip: '',
  storePhone: '',
  storeEmail: '',
  storeWebsite: '',
  storeLogo: '',
  businessHours: '',

  // Tax — California / Santa Barbara County defaults
  taxRate: 0.0925,
  utilityUsersTax: 0.055,
  mobileSurcharge: 0.41,

  // CBE
  cbeFeeEnabled: false,
  cbeFee: 0.0,
  cbeFeeRate: 0.015,    // 1.5%
  cbeFeeMax: 15.0,      // $15 cap per unit
  screenFeeAmount: 0.5,

  // Receipt
  receiptFooter: '',
  paperSize: '4x6',
  detectedPrinters: [],

  // Financial — cents (integer). e.g. 500 = $5.00. Legacy percentage stored as >10 values.
  creditCardFee: 500,
  defaultCommissionRate: 0.07,
  currency: 'USD',
  locale: 'en-US',
  timezone: 'America/Los_Angeles',

  // Invoice
  invoicePrefix: 'INV',
  invoiceCounterLength: 4,
  invoiceIncludeDate: true,
  customerNumberPrefix: 'GC',

  // Inventory
  lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,

  // Warranty / Policy
  warrantyText: '',
  returnPolicy: '',
  returnPolicyDays: 30,

  // Google Reviews QR
  googleReviewUrl: 'https://g.page/r/CThz_PIcQfrrEBM/review',
  showReviewQr: false,

  // Repair Status Page
  repairStatusBaseUrl: 'https://cellhubpro.com/repair-status.html',

  // Admin
  // r-settings-1 S-01: empty by default. AdminPinGate (r27 B2) rejects access
  // if empty, forcing the user through Setup Wizard or Settings → Store Info.
  adminPin: '',
  autoBackup: true,

  // AI
  aiProvider: 'claude' as const,
  claudeApiKey: '',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  geminiApiKey: '',
  geminiModel: 'gemini-1.5-flash',
  customAiUrl: '',
  customAiKey: '',
  customAiModel: '',

  // R-COMMS-SMS-INFRA-CLEANUP: sms* defaults removed (14 fields).

  // WhatsApp templates (wa.me — blank = use built-in defaults)
  waEnabled: true,
  waTemplateRepairReady: '',
  waTemplateRepairReceived: '',
  waTemplateBalanceDue: '',
  waTemplateSpecialOrderReady: '',
  waTemplateLayawayReminder: '',
  waTemplateThankYou: '',

  // Carriers
  phoneCarriers: [
    'AT&T', 'T-Mobile', 'Verizon', 'Simple Mobile',
    'H2O', 'Page Plus', 'Cricket', 'Ultra Mobile', 'Tracfone',
  ],
  carrierPortalUrls: {
    'AT&T': 'https://spid.myrtpay.com/',
    'T-Mobile': 'https://paymasterwebpos.epayworldwide.com/#!/',
    'Verizon': 'https://paymasterwebpos.epayworldwide.com/#!/',
    'Simple Mobile': 'https://id.vidapay.com/Account/Login',
    'H2O': 'https://www.h2odirectnow.com/',
    'Page Plus': 'https://id.vidapay.com/Account/Login',
    'Cricket': '',
    'Ultra Mobile': '',
    'Tracfone': '',
  },
  topUpProviders: [
    'Telcel', 'Movistar', 'AT&T Mexico', 'Unefon',
    'International Unlimited', 'Claro',
  ],
  carrierCommissions: {
    'H2O': 0.06,
    'AT&T': 0.10,
    'Verizon': 0.10,
    'T-Mobile': 0.08,
    'Simple Mobile': 0.05,
    'Page Plus': 0.05,
    'Cricket': 0.05,
    'Ultra Mobile': 0.05,
    'Tracfone': 0.05,
  },
  // Activation spiffs — disabled by default. Owner enables in Settings if applicable.
  trackActivationSpiffs: false,
  carrierSpiffs: {},
  claudeModel: 'claude-sonnet-4-6',
  spiffTaxableRatio: 1.0,
};

// ── Sidebar Navigation Tabs ──────────────────────────────

export interface NavTab {
  id: string;
  labelKey: string;       // key into LABELS
  icon: string;           // emoji or icon identifier
  adminOnly?: boolean;
  // allowedRoles: which roles can see this tab. Omit = all roles allowed.
  // owner and manager always see everything.
  allowedRoles?: Array<'owner' | 'manager' | 'technician' | 'sales' | 'cashier'>;
}

export const NAV_TABS: NavTab[] = [
  { id: 'dashboard',     labelKey: 'dashboard',     icon: '📊' },
  { id: 'pos',           labelKey: 'pointOfSale',   icon: '💰', allowedRoles: ['owner','manager','sales','cashier'] },
  { id: 'inventory',     labelKey: 'inventory',     icon: '📦', allowedRoles: ['owner','manager','technician'] },
  { id: 'repairs',       labelKey: 'repairs',       icon: '🔧', allowedRoles: ['owner','manager','technician'] },
  { id: 'unlocks',       labelKey: 'unlocks',       icon: '🔓', allowedRoles: ['owner','manager','technician','sales'] },
  { id: 'specialOrders', labelKey: 'specialOrder',  icon: '📋', allowedRoles: ['owner','manager','sales'] },
  { id: 'layaways',      labelKey: 'layaways',      icon: '📅', allowedRoles: ['owner','manager','sales','cashier'] },
  { id: 'returns',       labelKey: 'returns',       icon: '↩️', allowedRoles: ['owner','manager','sales'] },
  { id: 'customers',     labelKey: 'customers',     icon: '👤', allowedRoles: ['owner','manager','sales','cashier'] },
  { id: 'appointments',  labelKey: 'appointments',  icon: '📅', allowedRoles: ['owner','manager','sales','technician'] },
  { id: 'intelligence',  labelKey: 'intelligence',  icon: '🧠', adminOnly: true },
  // CELLHUB-INTELLIGENCE-I5: read-only visible Business Manager surface.
  { id: 'manager',       labelKey: 'businessManager', icon: '💼', adminOnly: true },
  // COMPANION: simplified companion (REST polling, no socket).
  { id: 'companion',     labelKey: 'companion',     icon: '📲', adminOnly: true },
  { id: 'purchaseOrders', labelKey: 'purchaseOrders',  icon: '🛒', adminOnly: true },
  { id: 'reports',       labelKey: 'reports',        icon: '📈', adminOnly: true },
  // P1-SC-CENTER: operational certificate manager (financial → admin-gated,
  // same treatment as Reports).
  { id: 'storeCredit',   labelKey: 'storeCredit',    icon: '🎫', adminOnly: true },
  // P1-COLIBRI-LAUNCHER: independent commercial-studio launcher. Paired with
  // Store Credit so the sidebar grid stays balanced.
  { id: 'colibri',       labelKey: 'colibri',        icon: '🐦', adminOnly: true },
  { id: 'tax',           labelKey: 'caTaxReports',   icon: '🏛️', adminOnly: true },
  { id: 'settings',      labelKey: 'settings',       icon: '⚙️', adminOnly: true },
  // R-HELP-MANUAL-V1: in-app manual. Visible to every role (no adminOnly, no
  // allowedRoles) so any logged-in user can read the documentation.
  { id: 'help',          labelKey: 'help',           icon: '📖' },
];

/**
 * Check if a role is allowed to access a tab.
 * Owner and manager always have access to everything.
 */
export function canAccessTab(tabId: string, role: string | undefined, allowedModules?: string[]): boolean {
  // R-HELP-MANUAL-V1: the Help manual is always accessible, regardless of role
  // or an employee's explicit allowedModules list.
  if (tabId === 'help') return true;
  if (!role || role === 'owner' || role === 'manager') return true;
  // If employee has explicit allowedModules list, use it
  if (allowedModules && allowedModules.length > 0) {
    return allowedModules.includes(tabId);
  }
  // Fallback to role-based defaults
  const tab = NAV_TABS.find((t) => t.id === tabId);
  if (!tab) return true;
  if (tab.adminOnly) return false;
  if (!tab.allowedRoles) return true;
  return tab.allowedRoles.includes(role as any);
}

/** Default modules for each role (used as presets when creating employees) */
export const ROLE_DEFAULT_MODULES: Record<string, string[]> = {
  owner: ['dashboard','pos','inventory','repairs','unlocks','specialOrders','layaways','returns','customers','appointments','intelligence','companion','purchaseOrders','reports','tax','settings'],
  manager: ['dashboard','pos','inventory','repairs','unlocks','specialOrders','layaways','returns','customers','appointments','intelligence','companion','purchaseOrders','reports','tax','settings'],
  technician: ['dashboard','inventory','repairs','unlocks','appointments'],
  sales: ['dashboard','pos','inventory','unlocks','specialOrders','layaways','returns','customers','appointments'],
  cashier: ['dashboard','pos','layaways','customers'],
};

/** Modules available for checkbox selection */
export const ASSIGNABLE_MODULES = [
  { id: 'dashboard',      label: 'Dashboard',        icon: '📊' },
  { id: 'pos',            label: 'Point of Sale',    icon: '💰' },
  { id: 'inventory',      label: 'Inventory',        icon: '📦' },
  { id: 'repairs',        label: 'Repairs',          icon: '🔧' },
  { id: 'unlocks',        label: 'Unlocks',          icon: '🔓' },
  { id: 'specialOrders',  label: 'Special Orders',   icon: '📋' },
  { id: 'layaways',       label: 'Layaways',         icon: '📅' },
  { id: 'returns',        label: 'Returns',          icon: '↩️' },
  { id: 'customers',      label: 'Customers',        icon: '👤' },
  { id: 'appointments',   label: 'Appointments',     icon: '📅' },
  { id: 'intelligence',  label: 'Intelligence',    icon: '🧠' },
  { id: 'companion',     label: 'Companion',        icon: '📲' },
  { id: 'purchaseOrders', label: 'Purchase Orders',  icon: '🛒' },
  { id: 'reports',        label: 'Reports',          icon: '📈' },
  { id: 'tax',            label: 'Taxes',            icon: '🏛️' },
  { id: 'settings',       label: 'Settings',         icon: '⚙️' },
];

// ── Repair Status Colors ──────────────────────────────────

export const REPAIR_STATUS_COLORS: Record<string, string> = {
  received: 'badge-info',
  diagnosing: 'badge-warning',
  waiting_parts: 'badge-warning',
  in_progress: 'badge-info',
  ready: 'badge-success',
  picked_up: 'badge-neutral',
  cancelled: 'badge-danger',
};

// ── Firebase Collection Names ─────────────────────────────

export const COLLECTIONS = {
  customers: 'customers',
  inventory: 'inventory',
  sales: 'sales',
  repairs: 'repairTickets',
  unlocks: 'unlocks',
  specialOrders: 'specialOrders',
  layaways: 'layaways',
  employees: 'employees',
  settings: 'settings',
  smsLog: 'smsLog',
  purchaseOrders: 'purchaseOrders',
  appointments: 'appointments',
  // r-batch-a (1b): expenses was missing from COLLECTIONS, causing
  // persist.expense() to be unimplemented and expenses to never hydrate
  // at boot. Was producing 3 of the 6 baseline TS errors.
  expenses: 'expenses',
  // r-pkg-b3: Returns foundation — promote from localStorage-only to
  // first-class Firestore collections with typed state + hydration.
  customerReturns: 'customerReturns',
  vendorReturns: 'vendorReturns',
  // R-LOSSES-SHRINKAGE-V1: inventory shrinkage / business-loss audit.
  inventoryLosses: 'inventoryLosses',
  // R-STORE-CREDIT-REDEMPTION-SYSTEM: append-only certificate ledger
  storeCreditLedger: 'storeCreditLedger',
} as const;
