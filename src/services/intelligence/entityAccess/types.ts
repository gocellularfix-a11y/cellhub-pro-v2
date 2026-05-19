// INTELLIGENCE-UNIVERSAL-ENTITY-ACCESS-V1
// Universal normalized entity layer for Intelligence.
// All money values follow the project convention: CENTS (integer).

export type EntityKind =
  | 'customer'
  | 'repair'
  | 'sale'
  | 'invoice'
  | 'layaway'
  | 'special_order'
  | 'unlock'
  | 'phone_payment'
  | 'inventory_product'
  | 'employee';

export type EntityAction =
  | 'open'
  | 'whatsapp'
  | 'call'
  | 'collect_payment'
  | 'open_history'
  | 'open_ticket'
  | 'promote'
  | 'follow_up'
  | 'mark_ready';

export interface ResolvedEntity {
  kind: EntityKind;
  id: string;
  title: string;
  subtitle?: string;
  /** Normalized lowercase tokens used by searchOperationalEntities */
  searchableText: string[];
  availableActions: EntityAction[];
  /** Raw source object for callers that need module-specific fields */
  raw: unknown;
}
