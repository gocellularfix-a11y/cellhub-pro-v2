// R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1
// Morning digest types — no imports from store or React.
// Future-proofed for: Companion push, scheduled gen, WhatsApp summary,
// multi-store owner overview, voice reading. None implemented yet.

export interface MorningDigestSection {
  title: string;

  priority: 'critical' | 'high' | 'medium';

  lines: string[];
}

export interface MorningDigest {
  generatedAt: number;

  summary: string;

  sections: MorningDigestSection[];

  topPriority?: string;

  recommendedFocus?: string;

  estimatedRecoverableCents?: number;
}
