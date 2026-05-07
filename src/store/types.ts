// ============================================================
// CellHub Pro — Core Type Definitions
// All money values stored as CENTS (integer) in Firestore
// ============================================================

// ── Common ────────────────────────────────────────────────

export type Lang = 'en' | 'es' | 'pt';

export type PaymentMethod = string; // 'cash' | 'card' | 'store_credit' | 'split' (legacy uses capitalized)

export interface SplitPayment {
  cash: number;   // cents
  card: number;   // cents
  storeCredit: number; // cents
}

export interface Timestamp {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
}

// ── Settings ──────────────────────────────────────────────

export interface StoreSettings {
  // r-new-7: Firebase cloud sync opt-in. Default false. When true, App.tsx
  // calls initFirebase() on boot and useFirestoreSync connects. When false
  // (or undefined), app runs localStorage-only.
  cloudSyncEnabled?: boolean;

  // Store info
  storeName: string;
  storeAddress: string;
  storeCity: string;
  storeState: string;
  storeZip: string;
  storePhone: string;
  storeEmail: string;
  storeWebsite: string;
  storeLogo: string;
  businessHours: string;

  // Tax
  taxRate: number;           // e.g., 0.0925
  utilityUsersTax: number;   // e.g., 0.055
  mobileSurcharge: number;   // e.g., 0.41

  // CBE (Covered Battery-Embedded) fees
  cbeFeeEnabled: boolean;
  cbeFee: number;            // amount per unit
  cbeFeeRate: number;        // 1.5% default
  cbeFeeMax: number;         // $15 max cap per unit
  screenFeeAmount: number;   // per screen recycling fee

  // Receipt
  receiptFooter: string;
  paperSize: '4x6' | 'letter' | '80mm';
  detectedPrinters: string[];

  // Financial
  creditCardFee: number;     // percentage, e.g., 3.00
  defaultCommissionRate: number; // e.g., 0.07
  currency: string;          // 'USD'
  locale: string;            // 'en-US'
  timezone: string;          // 'America/Los_Angeles'

  // Invoice
  invoicePrefix: string;
  invoiceCounterLength: number;
  invoiceIncludeDate: boolean;
  customerNumberPrefix: string;

  // Inventory
  lowStockThreshold: number;
  /** R-INTEL-2-REORDER: days to receive stock from supplier (default 3). */
  reorderLeadTimeDays?: number;
  /** Custom field customization for Inventory form (null = use all defaults) */
  inventoryFieldConfig?: InventoryFieldConfig;

  // Warranty / Policy
  warrantyText: string;
  returnPolicy: string;        // free-text return policy displayed on receipts
  returnPolicyDays: number;    // r26: numeric window (days) for return eligibility

  // Google Reviews QR
  googleReviewUrl: string;   // e.g. https://g.page/r/CThz_PIcQfrrEBM/review
  showReviewQr: boolean;     // show QR on receipt

  // Repair Status Page
  repairStatusBaseUrl: string;  // e.g. https://cellhubpro.com/repair-status.html

  // Admin
  adminPin: string;
  autoBackup: boolean;

  // AI
  aiProvider: 'claude' | 'openai' | 'gemini' | 'custom';
  claudeApiKey: string;
  claudeModel: string;        // r26: added (closes r25 debt #2)
  openaiApiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  customAiUrl: string;
  customAiKey: string;
  customAiModel: string;

  // Loyalty
  loyaltyEnabled?: boolean;
  loyaltyRate?: number;

  // R-COMMS-SMS-INFRA-CLEANUP: 14 sms* fields removed.
  // See R-COMMS-RECON for forensic baseline. WhatsApp now sole
  // customer comm channel. Customer.smsConsent migration deferred
  // to round 3 (R-COMMS-CONSENT-UNIFY).

  // WhatsApp templates (wa.me click-to-chat)
  waEnabled: boolean;
  waTemplateRepairReady: string;
  waTemplateRepairReceived: string;
  waTemplateBalanceDue: string;
  waTemplateSpecialOrderReady: string;
  waTemplateLayawayReminder: string;
  waTemplateThankYou: string;

  // Carriers
  phoneCarriers: string[];
  carrierPortalUrls: Record<string, string>;
  topUpProviders: string[];
  carrierCommissions: Record<string, number>;

  // Activation Spiffs (carrier-paid bonuses for new activations)
  // trackActivationSpiffs: master toggle. When false, spiff UI is hidden entirely.
  // carrierSpiffs: per-carrier default amount in DOLLARS (editable per transaction).
  // spiffTaxableRatio: portion of spiff income reported as taxable (0..1, default 1.0).
  trackActivationSpiffs?: boolean;
  carrierSpiffs?: Record<string, number>;
  spiffTaxableRatio?: number;

  // Partnership / Tax entity (for Form 1065 / K-1 generation)
  partnership?: PartnershipInfo;

  // Per-year manually editable tax data (expenses, income, COGS, CA 540)
  taxData?: TaxData;
}

// ── Partnership ───────────────────────────────────────────

export interface PartnershipMember {
  id: string;
  name: string;
  ssn: string;                  // or ITIN — stored as entered, formatted on display
  ein?: string;                 // if member is itself an entity
  address: string;
  city: string;
  state: string;
  zip: string;
  ownershipPct: number;         // 0–100, all members must sum to 100
  isManaging: boolean;          // managing member checkbox on K-1
  isUSResident: boolean;        // domestic vs foreign partner

  // Capital account tracking (Schedule K-1 Item L)
  beginningCapital: number;     // cents
  contributions: number;        // cents — capital contributed during year
  distributions: number;        // cents — withdrawals during year
  guaranteedPayments: number;   // cents — Box 4 on K-1

  notes?: string;
}

export interface PartnershipInfo {
  ein: string;                            // Partnership's federal EIN (XX-XXXXXXX)
  legalName: string;                      // Legal name on Form 1065
  entityType: 'partnership' | 'llc-p';    // LLC taxed as partnership vs general partnership
  formationDate: string;                  // ISO date
  businessActivity: string;               // e.g. "Cell phone repair and retail"
  productOrService: string;               // e.g. "Repair services and accessories"
  accountingMethod: 'cash' | 'accrual';
  members: PartnershipMember[];
}

// ── Tax data (per year, manually editable inside Tax Center) ─

/**
 * Tax expense category — stored as the key. Pass-through is special:
 * money collected from customers that must be forwarded to a third party
 * (NOT income, NOT expense — just transit).
 */
export type TaxExpenseCategory =
  | 'Inventory/COGS'
  | 'Rent'
  | 'Utilities'
  | 'Internet/Phone'
  | 'Advertising'
  | 'Insurance'
  | 'Supplies'
  | 'Repairs'
  | 'Fees'
  | 'Software'
  | 'Payroll'
  | 'Licenses'
  | 'Taxes'
  | 'Meals'
  | 'Vehicle'
  | 'Pass-through'
  | 'Misc';

export type TaxIncomeCategory =
  | 'Product Sales'
  | 'Service Revenue'
  | 'Payment Commissions'
  | 'Repair Income'
  | 'Activation Fees'
  | 'Top-Up Commissions'
  | 'Unlock Services'
  | 'Insurance Sales'
  | 'Gift Card Sales'
  | 'Pass-Through Income'
  | 'Other Income';

export interface TaxExpense {
  id: string;
  date: string;            // ISO date
  vendor: string;
  category: TaxExpenseCategory;
  amount: number;          // CENTS
  notes?: string;
}

export interface TaxIncomeEntry {
  id: string;
  date: string;            // ISO date
  source: string;          // customer / vendor name
  category: TaxIncomeCategory;
  amount: number;          // CENTS
  notes?: string;
}

export interface TaxSupplierPurchase {
  id: string;
  date: string;            // ISO date
  name: string;            // supplier name
  items: string;           // description
  amount: number;          // CENTS
  paymentMethod?: string;
}

export type TaxReturnStatus = 'Pending' | 'Shipped' | 'Refunded' | 'Rejected';

export interface TaxSupplierReturn {
  id: string;
  date: string;            // ISO date
  supplier: string;
  product: string;
  quantity: number;
  amount: number;          // CENTS — refund amount
  qrCode?: string;         // RMA / QR code
  trackingNumber?: string;
  status: TaxReturnStatus;
  notes?: string;
}

export interface TaxInventoryData {
  beginningInventory: number;  // CENTS — value at start of year
  endingInventory: number;     // CENTS — value at end of year
}

export interface TaxAdjustments {
  otherIncome: number;     // CENTS — other income line
  returnsRefunds: number;  // CENTS — returns/refunds adjustment
}

export interface TaxCA540 {
  caWithholding: number;   // CENTS
  caQ1: number;            // CENTS — quarterly estimated payment Q1
  caQ2: number;
  caQ3: number;
  caQ4: number;
  selfEmployedHealthInsuranceCA: number;  // CENTS
  otherCADeductions: number;              // CENTS
  useStandardDeductionCA: boolean;
  itemizedDeductionsCA: number;           // CENTS
}

// ── R-TAX-SCHEMA-EXTEND: legacy v1 tax forms hoisted as first-class
//    fields on TaxYearData. All money in CENTS (int). All 6 new fields
//    on TaxYearData are OPTIONAL — adapter populates on import; UI must
//    check presence. emptyYearData() intentionally does NOT initialize
//    them, so pristine years have them undefined.

/** Form 1040 Personal — filing header, income lines, credits, estimated
 *  payments, filer/spouse PII. Singleton per year. */
export interface Tax1040Data {
  // Filing
  filingStatus: 'single' | 'married' | 'mfs' | 'hoh' | 'qw';
  dependents: number;

  // Income (cents)
  wages: number;
  interestDividends: number;
  capitalGains: number;
  otherIncome1040: number;

  // Adjustments (cents)
  iraDeduction: number;
  studentLoanInterest: number;
  hsaDeduction: number;
  otherAdjustments: number;

  // Deduction
  useStandardDeduction: boolean;
  itemizedDeductions: number;   // cents

  // Credits (cents)
  childTaxCredit: number;
  earnedIncomeCredit: number;
  otherCredits: number;

  // Withholding & estimated payments (cents)
  federalWithholding: number;
  q1Payment: number;
  q2Payment: number;
  q3Payment: number;
  q4Payment: number;

  // Filer PII
  firstName: string;
  lastName: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  zip: string;

  // Spouse PII (optional)
  spouseFirstName?: string;
  spouseLastName?: string;
  spouseSsn?: string;
}

/** Form 1065 Schedule L — partnership balance sheet. Begin/End pairs
 *  per line item (cents). */
export interface TaxBalanceSheet {
  // Assets — Begin/End pairs (cents)
  cashBegin: number;                 cashEnd: number;
  accountsReceivableBegin: number;   accountsReceivableEnd: number;
  inventoryBegin: number;            inventoryEnd: number;
  otherCurrentAssetsBegin: number;   otherCurrentAssetsEnd: number;
  buildingsBegin: number;            buildingsEnd: number;
  accDepreciationBegin: number;      accDepreciationEnd: number;
  landBegin: number;                 landEnd: number;
  otherAssetsBegin: number;          otherAssetsEnd: number;

  // Liabilities — Begin/End pairs (cents)
  accountsPayableBegin: number;      accountsPayableEnd: number;
  shortTermDebtBegin: number;        shortTermDebtEnd: number;
  longTermDebtBegin: number;         longTermDebtEnd: number;
  otherLiabilitiesBegin: number;     otherLiabilitiesEnd: number;
}

/** Dependent claimed on Form 1040. Kept as TaxYearData.dependents[] to
 *  preserve the v1 year-scoped shape — semántica estable entre años
 *  pero el form lo pide year-by-year. */
export interface TaxDependent {
  id: string;
  firstName: string;
  lastName: string;
  ssn: string;
  dateOfBirth: string;   // ISO date 'YYYY-MM-DD'
  relationship: string;  // 'Child' | 'Other' — string for flexibility
}

/** Partner draw / distribution — withdrawals a partner takes from the
 *  partnership during the year. Relevant for K-1 Line 19 distributions
 *  + capital account tracking. */
export interface TaxDraw {
  id: string;
  memberId: string;   // FK to settings.partnership.members[].id
  amount: number;     // cents
  date: string;       // ISO date
  notes?: string;
}

/** IRS Schedule C (Form 1040) — 24 expense category totals. Lines 8–27
 *  plus line 30 (home office). All in cents. */
export interface TaxScheduleC {
  advertising: number;
  carAndTruck: number;
  commissions: number;
  contractLabor: number;
  depletion: number;
  depreciation: number;
  employeeBenefits: number;
  insurance: number;
  mortgageInterest: number;
  otherInterest: number;
  legalProfessional: number;
  officeExpense: number;
  pensionProfit: number;
  rentVehicles: number;
  rentProperty: number;
  repairs: number;
  supplies: number;
  taxesLicenses: number;
  travel: number;
  meals: number;
  utilities: number;
  wages: number;
  otherExpenses: number;
  homeOffice: number;
}

/** Form 1065 Schedule M-1 — Reconciliation of Income per Books vs per
 *  Return. 6 standard book-to-tax adjustments (cents). */
export interface TaxScheduleM {
  federalIncomeTax: number;
  excessCapitalLosses: number;
  incomeNotRecorded: number;
  expensesNotDeducted: number;
  taxExemptInterest: number;
  deductionsNotCharged: number;
}

/** Per-year tax data — all manually editable inside the Tax Center */
export interface TaxYearData {
  expenses: TaxExpense[];
  income: TaxIncomeEntry[];
  suppliers: TaxSupplierPurchase[];
  returns: TaxSupplierReturn[];
  inventory: TaxInventoryData;
  adjustments: TaxAdjustments;
  ca540: TaxCA540;

  // R-TAX-SCHEMA-EXTEND: legacy v1 tax forms (optional — adapter populates)
  form1040?: Tax1040Data;
  balanceSheet?: TaxBalanceSheet;
  dependents?: TaxDependent[];
  draws?: TaxDraw[];
  scheduleC?: TaxScheduleC;
  scheduleM?: TaxScheduleM;
}

/** Map of year-string → TaxYearData */
export interface TaxData {
  byYear: Record<string, TaxYearData>;
}

// ── Customer ──────────────────────────────────────────────

export interface Customer {
  id: string;
  storeId?: string;  // Multi-store: which store this belongs to

  // ── Name (firstName/lastName are canonical; `name` kept for legacy compat) ──
  firstName: string;       // required by form, backfilled by migration for old records
  lastName: string;        // required by form, backfilled by migration for old records
  name: string;            // derived: `${firstName} ${lastName}`.trim() — kept for legacy reads

  // ── Contact ──
  phone: string;           // primary phone (kept for legacy reads); mirrors phones[0]
  phones?: string[];       // all phones for this customer (multi-line support)
  carriers?: string[];     // carrier per phone, parallel array to phones[]
  email: string;

  // ── Address ──
  address?: string;        // street
  city?: string;
  state?: string;          // e.g. "CA"
  zip?: string;

  // ── Wireless service (Go Cellular core business) ──
  carrier?: string;        // primary carrier (mirrors carriers[0])
  carrier2?: string;       // legacy secondary carrier (mirrors carriers[1])
  plan?: string;           // plan name (e.g. "Unlimited Elite")
  monthlyPayment?: string; // stored as string for form editing; parseFloat on use

  // ── Visual / credential ──
  photo?: string;          // base64 data URL, used for printed credential
  credentialPhoto?: string; // legacy alias — kept for retrocompat with existing data

  // ── Loyalty / credit / referral ──
  loyaltyPoints: number;
  storeCredit: number;         // cents
  customerNumber: string;      // e.g., "GC-0001"
  referralCode?: string;       // unique code others can use to refer this customer
  referredBy?: string;         // referralCode of whoever referred this customer

  // ── Meta ──
  notes: string;
  // R-COMMS-CONSENT-UNIFY: unified consent field replaces sms-specific
  // smsConsent. Future-proof for email/other comm channel opt-ins.
  // Legacy v1 imports auto-migrated by customerNormalize.
  communicationConsent: boolean;

  // ── Top-up history (r28) ──
  // Persistent memory of recipients this customer has sent top-ups to.
  // Lives on the Customer doc itself (not a separate collection) so writes
  // piggyback on the existing persist.customer() call in handleCompleteSale.
  // Optional — legacy customers without this field continue to work; the
  // TopUpModal renders the legacy notes-regex fallback for them.
  topUpHistory?: TopUpHistoryEntry[];

  createdAt: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
}

// ── Top-Up History (r28) ──────────────────────────────────

/**
 * One recipient phone number this customer has previously sent top-ups to.
 * Stored inside Customer.topUpHistory[]. Updated by recordTopUp() called
 * from POSModule.handleCompleteSale on every completed sale that contains
 * top_up category items with a customerId.
 */
export interface TopUpHistoryEntry {
  recipient: string;        // recipient phone (digits only, normalized)
  nickname?: string;        // user-assigned alias ("Mamá", "Hermano") — editable via TopUpModal
  provider: string;         // last provider used for this recipient (e.g. "Telcel")
  lastAmount: number;       // CENTS — amount of the most recent top-up to this recipient
  lastAt: string;           // ISO timestamp of the most recent top-up
  count: number;            // total number of top-ups sent to this recipient
}

// ── Inventory ─────────────────────────────────────────────

export type InventoryCategory =
  | 'phone'
  | 'accessory'
  | 'part'
  | 'service'
  | 'quick_charge'
  | 'top_up'
  | 'phone_payment'
  | string; // allow custom categories

export interface InventoryItem {
  id: string;
  storeId?: string;  // Multi-store: which store this belongs to
  sku: string;
  barcode?: string;
  imei?: string;
  name: string;
  description?: string;
  category: InventoryCategory;
  /** Item condition (New, Excellent, Good, Fair, Refurbished, For Parts, etc.) */
  condition?: string;
  /** Brand (Apple, Samsung, etc.) */
  brand?: string;
  cost: number;          // cents
  price: number;         // cents
  qty: number;
  minQty?: number;
  cbeEligible: boolean;  // per-item CBE flag
  screenFeeEligible?: boolean;
  taxable: boolean;
  image?: string;
  supplier?: string;
  location?: string;     // store location / shelf
  /** Values for user-defined custom fields (see StoreSettings.inventoryFieldConfig) */
  customFields?: Record<string, string | number>;
  createdAt: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
}

// ── Inventory Field Customization ─────────────────────────

export type CustomFieldType = 'text' | 'number' | 'date' | 'dropdown';

export interface CustomInventoryField {
  /** Stable unique id — used as key in InventoryItem.customFields */
  id: string;
  /** Display label (EN) */
  label: string;
  /** Display label (ES) — optional */
  labelEs?: string;
  type: CustomFieldType;
  /** For dropdown type: list of allowed values */
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

/** Which built-in fields are visible and (where applicable) required */
export interface DefaultFieldToggle {
  visible: boolean;
  required?: boolean;
}

export interface InventoryFieldConfig {
  /** Toggles for built-in fields. Missing keys = visible=true, required=default */
  defaults: Partial<Record<
    'sku' | 'category' | 'condition' | 'cost' | 'price' | 'qty'
    | 'supplier' | 'brand' | 'description',
    DefaultFieldToggle
  >>;
  /** User-defined custom fields (rendered in order) */
  customFields: CustomInventoryField[];
}

// ── Cart ──────────────────────────────────────────────────

export interface CartItem {
  id: string;              // unique cart line ID
  inventoryId?: string;    // link to inventory item
  name: string;
  sku?: string;
  imei?: string;           // Phone IMEI, copied from inventory for legal/warranty tracking
  category: InventoryCategory;
  price: number;           // cents (may be overridden)
  originalPrice?: number;  // cents
  qty: number;
  cost?: number;           // cents
  notes?: string;
  cbeEligible: boolean;
  cbeOverride?: boolean;   // sale-time override of CBE flag
  screenFeeEligible?: boolean;
  taxable: boolean;
  // For phone payments
  phoneNumber?: string;
  carrier?: string;
  accountPin?: string;
  portal?: string;
  commissionRate?: number;  // carrier commission % (e.g. 0.10 for AT&T), used by PhonePaymentModal
  // For repairs / special orders added to cart
  repairId?: string;
  specialOrderId?: string;
  unlockId?: string;
  layawayId?: string;
  // R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1: optional audit fields stamped
  // when the cashier applies a per-line override / discount via the new
  // line-discount modal. The effective per-unit price stays in `price`
  // (existing field) so all downstream math (totals, tax, receipts,
  // reports) keeps working without changes. `originalPrice` already
  // existed and is stamped at addToCart — we just preserve it across
  // line-discount edits.
  lineDiscountReason?: string;
  lineDiscountApprovedBy?: string; // future-ready; not yet enforced
}

// ── Sale ──────────────────────────────────────────────────

export type SaleStatus = 'completed' | 'voided' | 'refunded' | 'partial_refund';

export interface SaleItem {
  id: string;
  inventoryId?: string;
  name: string;
  sku?: string;
  imei?: string;           // Preserved from CartItem at checkout for compliance
  category: InventoryCategory;
  price: number;         // cents
  originalPrice?: number;
  qty: number;
  cost?: number;         // cents
  notes?: string;
  cbeEligible: boolean;
  screenFeeEligible?: boolean;
  taxable: boolean;
  // Return tracking (written by ReturnsModule.processReturn)
  returnedQty?: number;     // cumulative qty returned across all returns
  fullyReturned?: boolean;  // true when returnedQty >= qty
  // Phone payment fields
  phoneNumber?: string;
  carrier?: string;
  portal?: string;
  // Linked entities
  repairId?: string;
  specialOrderId?: string;
  unlockId?: string;
  layawayId?: string;
  // R-CART-LINE-DISCOUNT-PRICE-OVERRIDE-V1: audit fields preserved from
  // CartItem at checkout. Pure record metadata — totals/tax already
  // reflect the post-line-discount `price` value above.
  lineDiscountReason?: string;
  lineDiscountApprovedBy?: string;
}

export interface Sale {
  id: string;
  storeId?: string;  // Multi-store: which store this belongs to
  invoiceNumber: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  items: SaleItem[];
  subtotal: number;                  // cents (before discount)
  subtotalAfterDiscount?: number;    // cents (after discount — use this for loyalty points)
  taxAmount: number;       // cents (legacy aggregate: salesTax + utilityTax + mobileSurcharge)
  salesTax?: number;       // cents (CA sales tax on taxable items)
  utilityTax?: number;     // cents (Utility Users Tax on phone payments)
  mobileSurcharge?: number;// cents (CDTFA mobility fee per line)
  cbeTotal: number;        // cents
  screenFeeTotal?: number; // cents
  creditCardFee?: number;  // cents — surcharge passed to customer (Card/Split only). Classified as surcharge income in books; tracked separately to reconcile against processing fee expenses.
  total: number;           // cents
  paymentMethod: PaymentMethod;
  splitPayment?: SplitPayment;
  cashReceived?: number;   // cents
  changeDue?: number;      // cents
  status: SaleStatus;
  employeeId?: string;
  employeeName?: string;
  notes?: string;
  voidReason?: string;
  // R-OPERATIONS-VOID-SALE-AND-LOSSES-AUDIT-V1: audit fields populated by
  // the manager-PIN-gated void flow in Reports. Voided sales remain in
  // the sales array (no hard delete); existing isCountableSale / status
  // filters already exclude them from active totals/profit/KPIs.
  voidedAt?: string;        // ISO timestamp
  voidedBy?: string;        // employee name at void time
  refundReason?: string;
  // Return tracking (written by ReturnsModule.processReturn)
  hasReturn?: boolean;
  lastReturnAt?: string;    // ISO timestamp of most recent return against this sale
  // R9-1 linked cancellation cross-ref (written to refund sales when Returns cancels
  // a linked repair/unlock/SO/layaway entity as part of processing a return).
  linkedRefunds?: { type: string; id: string; depositCents: number }[];
  createdAt: Timestamp | Date | string;
}

// ── Customer Return ──────────────────────────────────────

export interface CustomerReturnItem {
  id?: string;
  name: string;
  qty: number;
  // ── Canonical cents fields (Round 9 migration) ──
  priceCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  // ── Legacy dollars fields (kept for backward compat with Reports/Dashboard) ──
  /** @deprecated use priceCents */
  price?: number;
  /** @deprecated use subtotalCents */
  subtotal?: number;
  /** @deprecated use taxCents */
  tax?: number;
  /** @deprecated use totalCents */
  total?: number;
}

export interface CustomerReturn {
  id: string;
  storeId?: string;
  returnNumber: string;          // "RTN-XXXXXXXX-XXXX"
  originalInvoice: string;
  originalSaleId: string | null;
  customerName: string;
  customerPhone: string;
  employeeName: string;
  createdAt: string;             // ISO timestamp
  reason: string;                // defective | not_working | wrong_item | changed_mind | other
  resolution: string;            // cash | card | store_credit | exchange
  notes: string;
  items: CustomerReturnItem[];
  // ── Canonical cents fields (Round 9 migration) ──
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  // ── Legacy dollars fields (kept for backward compat with Reports/Dashboard) ──
  /** @deprecated use subtotalCents */
  subtotal?: number;
  /** @deprecated use taxCents */
  taxRefunded?: number;
  /** @deprecated use totalCents */
  total?: number;
}

// ── Vendor Return ────────────────────────────────────────

export interface VendorReturn {
  id: string;
  storeId?: string;
  returnNumber: string;          // "VND-XXXXXXXX-XXXX"
  productId: string;
  productName: string;
  sku: string;
  supplier: string;
  qty: number;
  cost: number;                  // cents (from InventoryItem.cost)
  // ── Canonical cents field (Round 9 migration) ──
  totalValueCents: number;       // cents: cost * qty
  /** @deprecated use totalValueCents */
  totalValue?: number;
  reason: string;                // defective | overstock | wrong_item | warranty
  resolution: string;            // credit | replacement | refund
  notes: string;
  employeeName: string;
  createdAt: string;             // ISO timestamp
}

// ── R-EDIT-AUDIT: shared audit fields for post-completion edit tracking ──

export interface EditAuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface EditAuditEntry {
  editedAt: string;
  editedBy: string;
  pinUsedBy: string;
  reason: 'additional_balance' | 'absorbed' | 'refund' | 'typo_correction';
  fieldsChanged: EditAuditFieldChange[];
  note?: string;
  sideEffects?: {
    balanceChange?: number;
    statusChange?: { from: string; to: string };
    refundOwedAmount?: number;
    absorbedAmount?: number;
  };
}

export interface EditAuditSnapshot {
  capturedAt: string;
  snapshot: Record<string, unknown>;
}

// ── Repair ────────────────────────────────────────────────

export type RepairStatus = string; // 'received' | 'diagnosing' | 'waiting_parts' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled'

export interface RepairPart {
  id: string;
  name: string;
  cost: number;     // cents
  price: number;    // cents
  qty: number;
  inventoryId?: string;
}

export interface Repair {
  id: string;
  storeId?: string;  // Multi-store: which store this belongs to
  customerId?: string;
  customerName: string;
  customerPhone: string;
  device: string;
  deviceModel?: string;
  imei?: string;
  issue: string;
  status: RepairStatus;
  parts: RepairPart[];
  laborCost: number;       // cents
  estimatedCost: number;   // cents
  depositAmount: number;   // cents
  balance: number;         // cents (estimatedCost - depositAmount)
  total?: number;          // cents — legacy field used by reports (mirrors estimatedCost)
  techNotes: string;
  employeeId?: string;
  employeeName?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  estimatedCompletion?: string;
  warranty?: string;
  trackingToken?: string;  // short random token for public status page URL
  devicePhoto?: string;    // base64 image of device at intake
  createdAt: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
  completedAt?: Timestamp | Date | string;
  // Cancellation tracking (set only when status transitions to 'Cancelled')
  cancelledAt?: string;
  depositRefundMethod?: 'store_credit' | 'cash' | 'forfeit';
  depositRefundAmount?: number;
  cancellationNote?: string;
  // R-EDIT-AUDIT: post-completion edit tracking
  originalSnapshot?: EditAuditSnapshot;
  editHistory?: EditAuditEntry[];
  refundOwedAmount?: number;  // cents; set when reason='refund', cleared on Mark Refunded
}

// ── Unlock ────────────────────────────────────────────────

export type UnlockStatus = string; // 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export type UnlockType = 'factory' | 'imei' | 'subsidy' | 'custom' | '';

export interface Unlock {
  id: string;
  storeId?: string;  // Multi-store: which store this belongs to
  customerId?: string;
  customerName: string;
  // Split name fields (used by form autocomplete)
  firstName?: string;
  lastName?: string;
  customerPhone: string;
  device: string;
  imei: string;
  carrier: string;
  targetCarrier?: string;
  // Service details
  unlockType?: UnlockType;       // Factory / IMEI / Subsidy / Custom
  unlockCode?: string;           // Code returned by supplier (NCK, FRP bypass, etc.)
  supplier?: string;             // DoctorSIM, UnlockBoot, etc.
  orderDate?: string;            // ISO date string — manual entry
  completionDate?: string;       // ISO date string — manual entry
  price: number;          // cents
  cost: number;           // cents
  depositAmount: number;  // cents
  balance: number;        // cents
  status: UnlockStatus;
  notes: string;
  employeeId?: string;
  employeeName?: string;
  createdAt: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
  completedAt?: Timestamp | Date | string;
  // R-EDIT-AUDIT: post-completion edit tracking
  originalSnapshot?: EditAuditSnapshot;
  editHistory?: EditAuditEntry[];
  refundOwedAmount?: number;
}

// ── Special Order ─────────────────────────────────────────

export type SpecialOrderStatus = string; // 'ordered' | 'in_transit' | 'received' | 'ready' | 'picked_up' | 'cancelled'

export interface SpecialOrder {
  id: string;
  storeId?: string;  // Multi-store: which store this belongs to
  customerId?: string;
  firstName?: string;     // form field, used for autocomplete & split name
  lastName?: string;
  customerName: string;
  customerPhone: string;
  itemDescription: string;
  supplier?: string;
  cost: number;            // cents
  price: number;           // cents
  depositAmount: number;   // cents
  balance: number;         // cents
  status: SpecialOrderStatus;
  notes: string;
  employeeId?: string;
  employeeName?: string;
  estimatedArrival?: string;
  createdAt: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
  // R-EDIT-AUDIT: post-completion edit tracking
  originalSnapshot?: EditAuditSnapshot;
  editHistory?: EditAuditEntry[];
  refundOwedAmount?: number;
}

// ── Layaway ───────────────────────────────────────────────

export type LayawayStatus = string; // 'active' | 'completed' | 'cancelled' | 'forfeited'

export interface LayawayPayment {
  id: string;
  amount: number;          // cents
  method: PaymentMethod;
  date: string;
  employeeId?: string;
}

export interface LayawayItem {
  id: string;
  inventoryId?: string;
  name: string;
  price: number;           // cents
  qty: number;
}

export interface Layaway {
  id: string;
  storeId?: string;  // Multi-store: which store this belongs to
  customerId?: string;
  customerName: string;
  customerPhone: string;
  items: LayawayItem[];
  totalPrice: number;      // cents
  payments: LayawayPayment[];
  paidAmount: number;      // cents
  balance: number;         // cents
  status: LayawayStatus;
  notes: string;
  employeeId?: string;
  employeeName?: string;
  dueDate?: string;
  createdAt: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
  /**
   * Round 15b M4: Payment method used for the FIRST deposit payment.
   * Written by POSModule.handleCompleteSale on the first sale linked
   * to this layaway via cart item meta.layawayId. Never overwritten
   * on subsequent partial payments (refund policy: refund to original
   * method). Optional — undefined on layaways created before Round 15b.
   * Readers must fall back to 'Cash' with console.warn.
   */
  depositMethod?: string;
}

// ── Employee ──────────────────────────────────────────────

export type EmployeeRole = 'owner' | 'manager' | 'technician' | 'sales' | 'cashier';

export interface ClockEntry {
  clockIn: string;    // ISO string
  clockOut?: string;  // ISO string
}

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  pin: string;              // 4-digit PIN for clock-in
  phone?: string;
  email?: string;
  commissionRate: number;   // e.g., 0.07
  active: boolean;
  clockLog: ClockEntry[];
  onboardingSigned: boolean;
  startDate: string;
  createdAt: Timestamp | Date | string;
}

// ── SMS Log ───────────────────────────────────────────────

export interface SmsLogEntry {
  id: string;
  to: string;
  message: string;
  status: 'sent' | 'failed' | 'queued';
  provider: string;
  createdAt: Timestamp | Date | string;
}

// ── Firebase Config (stored in Setup Wizard) ──────────────

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

// ── Store (multi-store support) ───────────────────────────

export interface Store {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  taxRate: number;
  active: boolean;
  createdAt: Timestamp | Date | string;
}

// ── Expense ───────────────────────────────────────────────

export type ExpenseCategory =
  | 'rent'
  | 'payroll'
  | 'utilities'
  | 'parts_supplies'
  | 'marketing'
  | 'insurance'
  | 'equipment'
  | 'carrier_fees'
  | 'software'
  | 'professional_fees'
  | 'taxes_licenses'
  | 'other';

export type ExpensePaymentMethod = 'cash' | 'card' | 'check' | 'transfer' | 'other';

export interface Expense {
  id: string;
  storeId?: string;
  date: string;              // ISO date string  e.g. "2026-04-04"
  vendor: string;
  description: string;
  category: ExpenseCategory;
  amount: number;            // cents
  paymentMethod: ExpensePaymentMethod;
  notes?: string;
  receiptUrl?: string;       // future: photo of receipt
  createdAt: string;
  updatedAt?: string;
}

// ── Inventory Loss / Shrinkage ────────────────────────────
// R-LOSSES-SHRINKAGE-V1: business loss recorded when stock leaves the
// store as defective / damaged / unsellable. NOT a sale, NOT a refund,
// NOT a void — separate audit shape. Inventory qty is decremented at
// time of record creation; the InventoryLoss record itself is the
// audit trail (never edited or hard-deleted in V1).

export type LossReason =
  | 'defective'
  | 'damaged'
  | 'unsellable_return'
  | 'vendor_non_returnable'
  | 'opened_package'
  | 'other';

export interface InventoryLoss {
  id: string;
  storeId?: string;
  itemId: string;
  sku?: string;
  itemName: string;
  qty: number;
  unitCost: number;     // cents
  totalLoss: number;    // cents (qty * unitCost)
  reason: LossReason;
  notes?: string;
  createdAt: string;    // ISO
  approvedBy?: string;
}

// ── Purchase Order ────────────────────────────────────────

export type POStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';

export interface POItem {
  id: string;
  inventoryId?: string;   // link to inventory item (optional)
  name: string;
  sku?: string;
  cost: number;           // cents — price we pay vendor
  qtyOrdered: number;
  qtyReceived: number;    // increments on each reception
}

export interface PurchaseOrder {
  id: string;
  storeId?: string;
  poNumber: string;       // "PO-2026-0001"
  vendor: string;
  vendorContact?: string; // phone or email
  status: POStatus;
  items: POItem[];
  subtotal: number;       // cents (sum of cost * qtyOrdered)
  shippingCost: number;   // cents
  total: number;          // cents (subtotal + shippingCost)
  notes?: string;
  expectedDate?: string;  // ISO date string
  receivedAt?: string;    // ISO when fully received
  createdAt: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
}

// ── App State ─────────────────────────────────────────────

export interface AppState {
  // Auth
  currentEmployee: Employee | null;
  isAdminMode: boolean;

  // Language
  lang: Lang;

  // Navigation
  activeTab: string;

  // Data collections
  customers: Customer[];
  inventory: InventoryItem[];
  sales: Sale[];
  repairs: Repair[];
  unlocks: Unlock[];
  specialOrders: SpecialOrder[];
  layaways: Layaway[];
  employees: Employee[];
  purchaseOrders: PurchaseOrder[];
  expenses: Expense[];
  inventoryLosses: InventoryLoss[];
  appointments: Appointment[];
  customerReturns: CustomerReturn[];
  vendorReturns: VendorReturn[];

  // Cart
  cart: CartItem[];

  // Settings
  settings: StoreSettings;

  // UI
  loading: boolean;
  isFirstTimeSetup: boolean;
  showAIAssistant: boolean;

  // Multi-store (r-multi-m2)
  currentStoreId: string;        // active store ID ('default' for single-store)
  consolidatedView: boolean;     // true = show all stores, false = filter by currentStoreId

  // Search states (for cross-module navigation)
  customerSearchTerm: string;
  inventorySearchTerm: string;
  globalSearchTerm: string;
  pendingBarcodeInvoice: string;
  pendingPhonePaymentCustomerId: string;  // set by scanner when customer credential scanned → opens PhonePaymentModal pre-filled
  pendingPosCustomer: string;             // set by RepairModule cart-add → POSModule picks up and sets selectedCustomer
  highlightRecordId: string;    // set by GlobalSearch navigate → consumed by list modules to flash+scroll
}

// ── Appointment ───────────────────────────────────────────

export type AppointmentStatus = 'scheduled' | 'arrived' | 'converted' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  storeId?: string;
  customerId?: string;              // linked customer (new — round 23 fix)
  customerName: string;
  customerPhone: string;
  device: string;
  issue: string;
  estimatedDropOff: string;         // ISO date-time string
  status: AppointmentStatus;
  notes: string;
  employeeId?: string;
  employeeName?: string;
  repairId?: string;                // set when converted to repair ticket
  // R-COMMS-CONSENT-UNIFY: sendConfirmationSms removed (SMS path retired in Round 1).
  createdAt: string;
  updatedAt: string;
}

// ── Action Types ──────────────────────────────────────────

export type AppAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LANG'; payload: Lang }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'SET_CURRENT_EMPLOYEE'; payload: Employee | null }
  | { type: 'SET_ADMIN_MODE'; payload: boolean }
  | { type: 'SET_FIRST_TIME_SETUP'; payload: boolean }
  | { type: 'SET_SHOW_AI_ASSISTANT'; payload: boolean }
  | { type: 'SET_CUSTOMERS'; payload: Customer[] }
  | { type: 'SET_INVENTORY'; payload: InventoryItem[] }
  | { type: 'SET_SALES'; payload: Sale[] }
  | { type: 'SET_REPAIRS'; payload: Repair[] }
  | { type: 'SET_UNLOCKS'; payload: Unlock[] }
  | { type: 'SET_SPECIAL_ORDERS'; payload: SpecialOrder[] }
  | { type: 'SET_LAYAWAYS'; payload: Layaway[] }
  | { type: 'SET_EMPLOYEES'; payload: Employee[] }
  | { type: 'SET_PURCHASE_ORDERS'; payload: PurchaseOrder[] }
  | { type: 'SET_EXPENSES'; payload: Expense[] }
  | { type: 'SET_INVENTORY_LOSSES'; payload: InventoryLoss[] }
  | { type: 'SET_APPOINTMENTS'; payload: Appointment[] }
  | { type: 'SET_CUSTOMER_RETURNS'; payload: CustomerReturn[] }
  | { type: 'SET_VENDOR_RETURNS'; payload: VendorReturn[] }
  | { type: 'SET_CART'; payload: CartItem[] }
  | { type: 'SET_SETTINGS'; payload: Partial<StoreSettings> }
  | { type: 'REPLACE_SETTINGS'; payload: StoreSettings }
  | { type: 'SET_CUSTOMER_SEARCH'; payload: string }
  | { type: 'SET_INVENTORY_SEARCH'; payload: string }
  | { type: 'SET_GLOBAL_SEARCH'; payload: string }
  | { type: 'SET_PENDING_BARCODE_INVOICE'; payload: string }
  | { type: 'SET_PENDING_PHONE_PAYMENT_CUSTOMER'; payload: string }
  | { type: 'SET_PENDING_POS_CUSTOMER'; payload: string }
  | { type: 'SET_HIGHLIGHT_RECORD'; payload: string }
  | { type: 'SET_CURRENT_STORE_ID'; payload: string }
  | { type: 'SET_CONSOLIDATED_VIEW'; payload: boolean }
  | { type: 'HYDRATE'; payload: Partial<AppState> };
