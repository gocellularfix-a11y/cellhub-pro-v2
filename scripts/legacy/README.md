# Legacy Migration Scripts

Retired scripts preserved for historical reference.

## migrate-v1-to-v2.js

Standalone Node.js script for v1 → v2 backup conversion. **Superseded**
by `src/services/import/legacyAdapter.ts` (invoked via Settings →
Backup & Restore → Import Backup in the app).

This script contains the same mapping logic that lives in the adapter.
Kept here as historical reference and for advanced debugging scenarios
only. **Do not run for normal migrations — use the in-app Import Backup
button instead.**

Last updated: 2026-04-24 (R-IMPORT-LEGACY-ADAPTER) — received 8 vocabulary
normalization fixes before retirement:

1. mapItemCategory → Title Case plural output
2. mapSaleStatus → Title Case output
3. mapRepairStatus (new) → normalizes 'Complete' → 'Completed'
4. mapLayawayStatus (new)
5. mapSpecialOrderStatus (new)
6. mapRepairPriority (new) → normalizes to 'Normal'/'High'/'Low'
7. storeId: 'default' auto-tag in inventory/repair/layaway/special_order
8. Layaway item.category passed through mapItemCategory
