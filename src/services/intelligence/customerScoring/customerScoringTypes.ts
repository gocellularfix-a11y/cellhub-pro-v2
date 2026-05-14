// CellHub Intelligence — Customer Business Scoring Types
// Pure types. No logic, no store imports, no side effects.

export type CustomerTier = 'VIP' | 'Loyal' | 'Active' | 'Casual' | 'At Risk' | 'Lost';

export interface CustomerBusinessProfile {
  customerId: string;
  customerName: string;

  // Five deterministic scores (0–100)
  vipScore: number;           // lifetime value, frequency, consistency
  churnRisk: number;          // inactivity, declining cadence
  upsellOpportunity: number;  // service-without-accessories, premium device, multi-line
  collectionPriority: number; // outstanding balances across all service types
  engagementScore: number;    // recent activity, service depth, profile completeness

  lastVisitAt: Date | null;
  estimatedCustomerTier: CustomerTier;
  recommendedActions: string[];
  detectedPatterns: string[];

  /** ms epoch — for stale-cache detection */
  computedAt: number;
}
