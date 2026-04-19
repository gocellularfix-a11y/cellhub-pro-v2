# CellHub Pro — Migration Plan: Single HTML → Vite + React + TypeScript + Electron

## Architecture Overview

```
cellhub-pro/
├── electron/                    # Electron main process
│   ├── main.ts                  # Main process entry
│   ├── preload.ts               # Context bridge (from existing preload.js)
│   └── ipc-handlers.ts          # IPC handler registration
├── src/                         # React app (renderer)
│   ├── main.tsx                 # React entry point
│   ├── App.tsx                  # Root component (replaces CellHubProV2)
│   ├── config/
│   │   ├── firebase.ts          # Firebase init (configurable per Setup Wizard)
│   │   ├── constants.ts         # Tax rates, carrier lists, defaults
│   │   └── i18n.ts              # LABELS object (EN/ES)
│   ├── hooks/
│   │   ├── useFirestore.ts      # Firestore CRUD + real-time listeners
│   │   ├── useAuth.ts           # Firebase Auth (or PIN-based)
│   │   ├── useDebounce.ts       # Debounce hook
│   │   ├── useSettings.ts       # Settings with defaults
│   │   ├── useOffline.ts        # Offline detection
│   │   └── usePrint.ts          # Print abstraction (Chrome vs Electron)
│   ├── store/                   # Global state (React Context + reducers)
│   │   ├── AppProvider.tsx      # Context provider wrapping all state
│   │   ├── types.ts             # TypeScript interfaces for all entities
│   │   └── actions.ts           # Reducer action types
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx      # Navigation sidebar
│   │   │   ├── MainContent.tsx  # Content area wrapper
│   │   │   └── AppShell.tsx     # Sidebar + MainContent layout
│   │   ├── ui/                  # Shared UI primitives
│   │   │   ├── Modal.tsx        # Non-blocking modal (replaces alert/confirm)
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── Toast.tsx        # Toast notifications
│   │   │   ├── SearchInput.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Tabs.tsx
│   │   │   └── LoadingSpinner.tsx
│   │   └── shared/
│   │       ├── AdminPinGate.tsx  # Admin PIN modal
│   │       ├── EmployeeLogin.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── ReceiptPrinter.tsx
│   ├── modules/                 # One folder per business module
│   │   ├── dashboard/
│   │   │   └── Dashboard.tsx
│   │   ├── pos/
│   │   │   ├── POSModule.tsx         # Main POS view
│   │   │   ├── Cart.tsx              # Cart sidebar
│   │   │   ├── ProductGrid.tsx       # Product/category grid
│   │   │   ├── PaymentModal.tsx      # Payment flow
│   │   │   ├── PhonePayment.tsx      # Carrier payment flow
│   │   │   ├── QuickCharge.tsx       # Quick charge items
│   │   │   ├── ReceiptModal.tsx      # 4x6 receipt
│   │   │   ├── CustomerCredential.tsx
│   │   │   └── MiniCartPanel.tsx
│   │   ├── repairs/
│   │   │   ├── RepairModule.tsx
│   │   │   ├── RepairModal.tsx
│   │   │   ├── RepairReceipt.tsx
│   │   │   └── types.ts
│   │   ├── unlocks/
│   │   │   ├── UnlockModule.tsx
│   │   │   ├── UnlockModal.tsx
│   │   │   ├── UnlockReceipt.tsx
│   │   │   └── types.ts
│   │   ├── special-orders/
│   │   │   ├── SpecialOrdersModule.tsx
│   │   │   ├── SpecialOrderModal.tsx
│   │   │   └── types.ts
│   │   ├── layaways/
│   │   │   ├── LayawayModule.tsx
│   │   │   └── types.ts
│   │   ├── inventory/
│   │   │   ├── InventoryModule.tsx
│   │   │   ├── InventoryModal.tsx
│   │   │   └── types.ts
│   │   ├── returns/
│   │   │   ├── ReturnsModule.tsx
│   │   │   └── types.ts
│   │   ├── customers/
│   │   │   ├── CustomerModule.tsx
│   │   │   ├── CustomerModal.tsx
│   │   │   ├── CustomerHistory.tsx
│   │   │   └── types.ts
│   │   ├── employees/
│   │   │   ├── EmployeeFormModal.tsx
│   │   │   └── types.ts
│   │   ├── reports/
│   │   │   ├── ReportsModule.tsx
│   │   │   └── types.ts
│   │   ├── tax/
│   │   │   ├── TaxReportsModule.tsx  # CDTFA / CBE
│   │   │   ├── TaxModule.tsx         # Federal tax (1065, K-1, etc.)
│   │   │   └── types.ts
│   │   ├── marketing/
│   │   │   ├── MarketingModule.tsx   # SMS broadcast
│   │   │   └── types.ts
│   │   ├── accounts/
│   │   │   ├── AccountsModule.tsx    # Store credit / phone accounts
│   │   │   └── types.ts
│   │   ├── settings/
│   │   │   ├── SettingsModule.tsx
│   │   │   └── types.ts
│   │   ├── certificates/
│   │   │   └── CertificateModule.tsx
│   │   ├── setup-wizard/
│   │   │   ├── SetupWizard.tsx
│   │   │   └── steps/
│   │   ├── ai-assistant/
│   │   │   └── AIAssistantPanel.tsx
│   │   └── image-editor/
│   │       └── ImageEditorModule.tsx
│   ├── services/
│   │   ├── storage.ts           # StorageManager → Firestore adapter
│   │   ├── sms.ts               # Textbelt / SMS provider abstraction
│   │   ├── printing.ts          # Print service (Chrome / Electron)
│   │   ├── barcode.ts           # JsBarcode / DYMO label printing
│   │   └── importer.ts          # JSON backup importer
│   ├── utils/
│   │   ├── currency.ts          # formatCurrency, cents ↔ dollars
│   │   ├── tax.ts               # Tax calculation helpers
│   │   ├── normalize.ts         # normalizeCarrier, normalizePhone
│   │   ├── fuzzyMatch.ts        # Fuzzy string matching (repairs)
│   │   ├── dates.ts             # Date formatting helpers
│   │   └── platform.ts          # isElectron() detection
│   └── styles/
│       └── index.css            # Tailwind + custom CSS
├── assets/                      # Icons, images for electron-builder
│   ├── icon.ico
│   ├── icon.icns
│   └── icon.png
├── index.html                   # Vite HTML entry
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── electron-builder.config.js   # From existing file
└── .env.example                 # Firebase config template
```

## Migration Phases

### Phase 1: Project Scaffold + Shell (THIS SESSION)
- [x] Project structure, package.json, Vite config, TypeScript config
- [x] Tailwind setup with existing color system
- [x] Firebase configuration (configurable)
- [x] i18n labels system (EN/ES)
- [x] Shared UI components (Modal, Toast, Button, etc.)
- [x] AppShell (Sidebar + MainContent)
- [x] Auth flow (Employee PIN login)
- [x] Admin PIN gate
- [x] AppProvider (global state context)
- [x] Entity type definitions

### Phase 2: POS / Sales Module
- Cart, product grid, payment flow
- Receipt printing (4x6 thermal)
- Phone payments (carrier portals)
- Quick charges
- Store credit as payment method

### Phase 3: Repair + Unlock + Special Orders
- Repair tickets with status workflow
- Parts tracking, deposits
- Fuzzy name matching for deposits
- Unlock tracking
- Special order lifecycle

### Phase 4: Inventory + Layaways + Returns
- IMEI tracking, barcode labels
- Layaway partial payments
- Customer returns + vendor RMAs

### Phase 5: Customers + Employees + Reports
- Loyalty program, SMS notifications
- Employee time tracking, hiring form
- P&L, sales by category, portal reconciliation

### Phase 6: Tax + Marketing + AI + Image Editor
- CDTFA/CBE compliance
- Federal tax modules
- SMS broadcast
- AI Assistant
- PixelForge Pro

### Phase 7: Electron Packaging
- Main process with IPC handlers
- Silent thermal printing
- Auto-update via GitHub
- License key system (Basic/Pro tiers)

### Phase 8: Multi-Store Support
- Store selection/registration
- Per-store settings, employees, inventory
- Consolidated reporting

## Key Migration Decisions

1. **State Management**: React Context + useReducer (not Redux — keeps it simple, the app is single-user)
2. **Money Storage**: All amounts as cents (integer) in Firestore, converted to dollars only for display
3. **Printing**: `usePrint()` hook abstracts Chrome vs Electron paths
4. **Modals**: All blocking dialogs → React modal components with Promise-based API
5. **Firebase**: Modular SDK v10 (not compat) — cleaner tree-shaking
6. **StorageManager**: Becomes a thin Firestore wrapper with localStorage fallback for offline
7. **Labels**: Static object import, not window global — same EN/ES structure
