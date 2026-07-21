// ============================================================
// CELLHUB-INTELLIGENCE-I6-C1 — Unified presentation layer contracts.
//
// The ONE place canonical proactive insights become owner-facing, ready-to-
// render view models. Detectors stay data-only (structures + evidence +
// thresholds, never wording); this layer owns ALL wording, ordering,
// grouping, suppression, localization, recommendation and the executive
// summary. Every current and future consumer (Business Manager 💼,
// Recommendation Bubble, Intelligence Chat, notifications) reads THESE
// models — never a detector's raw output — so there is a single source of
// presentation truth.
//
// Deterministic by construction: same ProactiveInsightsResult + same lang →
// same PresentedInsights, forever. No timers, no persistence, no UI widgets.
// ============================================================

import type { BusinessLanguage } from '../language/types';
import type {
  ProactiveInsightCategory, ProactiveInsightDirection, ProactiveInsightSeverity,
  ProactiveDetectorId,
} from '../proactiveInsights/types';

export type PresenterLang = BusinessLanguage;

/** Visual priority tier every surface renders and orders by — the ONE shared
 *  ordering axis. Derived deterministically from (severity, direction):
 *  positive movement is separated from watch-risk so good news never
 *  outranks a risk of the same severity, and never gets buried under
 *  data-quality noise either. */
export type InsightPriority = 'critical' | 'important' | 'watch' | 'positive' | 'info';

/** Machine action hint for FUTURE executable wiring. Data only — never a UI
 *  widget, never a button. Consumers decide how (or whether) to surface it. */
export interface InsightActionHint {
  kind: string;
  category: ProactiveInsightCategory;
}

/** Canonical, ready-to-render card. Answers the three convention questions:
 *  headline = "What happened?", summary = "Why should I care?",
 *  recommendation = "What should I do?" (null when evidence supports none). */
export interface InsightCard {
  /** Stable identity carried verbatim from the canonical insight (react key,
   *  dedup, cross-surface correlation). */
  fingerprint: string;
  detectorId: ProactiveDetectorId;
  category: ProactiveInsightCategory;
  severity: ProactiveInsightSeverity;
  direction: ProactiveInsightDirection;
  priority: InsightPriority;
  /** 0..1 EVIDENCE confidence, carried verbatim (never reworded as a score). */
  confidence: number;
  /** Whole-percent confidence for display (0..100). */
  confidencePct: number;
  icon: string;
  headline: string;
  summary: string;
  recommendation: string | null;
  /** Localized supporting lines (the numbers behind the card). */
  expandableDetails: string[];
  actions: InsightActionHint[];
}

/** A coherent theme. Singletons are groups of one (headline/summary/
 *  recommendation mirror the single member). Multi-member groups carry a
 *  synthesized narrative so near-duplicate warnings collapse into one
 *  message (e.g. sales decline + margin decline → "profitability pressure"). */
export interface InsightGroup {
  groupKey: string;
  priority: InsightPriority;
  icon: string;
  headline: string;
  summary: string;
  recommendation: string | null;
  members: InsightCard[];
}

export interface ExecutivePresentation {
  /** e.g. "Today I found 2 important things." — or an honest no-finding line. */
  headline: string;
  /** One localized clause per top theme (faithful to emitted evidence only). */
  lines: string[];
  /** Count of critical + important cards driving the headline. */
  actionableCount: number;
}

/** The complete presentation payload. Consumers pick what they render:
 *  Bubble → executive + top group; Manager → cards/groups; Chat → executive. */
export interface PresentedInsights {
  referenceYMD: string;
  lang: PresenterLang;
  executive: ExecutivePresentation;
  /** Flat, priority-ordered, suppression-applied cards (top-level view). */
  cards: InsightCard[];
  /** Coherent groups, priority-ordered; every retained card is in exactly one. */
  groups: InsightGroup[];
  /** Cards removed from the top-level view as noise — audit trail, never lost. */
  suppressed: InsightCard[];
  actionableCount: number;
}
