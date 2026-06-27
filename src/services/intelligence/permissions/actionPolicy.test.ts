// R-INTELLIGENCE-V2-F1 — shadow policy engine tests. Pure-function coverage:
// every executionTarget resolves; risk classes map to the right gate/role;
// store kill-switch and unknown fallback behave safely. Shadow: nothing here
// asserts enforcement — only the computed ActionPolicy.

import { describe, it, expect } from 'vitest';
import {
  resolveActionPolicy,
  POLICY_KNOWN_TARGETS,
  INTELLIGENCE_DISABLED_ACTIONS_KEY,
  type ActionPolicy,
} from './actionPolicy';

// The full executionTarget surface emitted by actionExecutor / the action
// registry (kept in sync with the grep'd set). Every one must resolve.
const ALL_TARGETS = [
  'open_customer', 'open_repair', 'open_layaway', 'open_unlock', 'open_special_order',
  'open_inventory', 'open_sale', 'view_receipt', 'open_promote_panel', 'copy_to_clipboard',
  'review_panel', 'none',
  'add_to_operator_queue', 'queue_manager_review', 'reminder_queue', 'record_outreach_outcome',
  'whatsapp_url', 'notify_customer',
  'mark_repair_ready', 'escalate_repair', 'promote_product', 'reorder_product',
  'pos_discount', 'pos_bundle', 'discount_product', 'collect_payment',
  'collect_layaway_payment', 'customer_loyalty_reward',
];

const READ_ONLY = [
  'open_customer', 'open_repair', 'open_layaway', 'open_unlock', 'open_special_order',
  'open_inventory', 'open_sale', 'view_receipt', 'open_promote_panel', 'copy_to_clipboard',
  'review_panel', 'none',
];
const COMMUNICATION = ['whatsapp_url', 'notify_customer'];
const FINANCIAL = [
  'pos_discount', 'pos_bundle', 'discount_product', 'collect_payment',
  'collect_layaway_payment', 'customer_loyalty_reward',
];
const OPERATIONAL_MANAGER = ['mark_repair_ready', 'escalate_repair', 'promote_product', 'reorder_product'];
const OPERATIONAL_AUTO = ['add_to_operator_queue', 'queue_manager_review', 'reminder_queue', 'record_outreach_outcome'];

describe('resolveActionPolicy — coverage', () => {
  it('every known executionTarget resolves to a complete policy', () => {
    for (const target of ALL_TARGETS) {
      const p = resolveActionPolicy(target, 'owner');
      expect(p.gate, target).toBeDefined();
      expect(p.minimumRole, target).toBeDefined();
      expect(typeof p.reason, target).toBe('string');
      expect(p.reason.length, target).toBeGreaterThan(0);
    }
  });

  it('the exported known-target list matches the registry surface', () => {
    // Sanity: every ALL_TARGETS entry is a known (non-fallback) target.
    for (const target of ALL_TARGETS) {
      expect(POLICY_KNOWN_TARGETS, target).toContain(target);
    }
  });
});

describe('resolveActionPolicy — risk classification', () => {
  it('read-only / navigation → auto_execute, any', () => {
    for (const target of READ_ONLY) {
      const p = resolveActionPolicy(target, 'employee');
      expect(p.gate, target).toBe('auto_execute');
      expect(p.minimumRole, target).toBe('any');
    }
  });

  it('internal operational queue/log → auto_execute, any', () => {
    for (const target of OPERATIONAL_AUTO) {
      const p = resolveActionPolicy(target, 'employee');
      expect(p.gate, target).toBe('auto_execute');
      expect(p.minimumRole, target).toBe('any');
      expect(p.reason, target).toBe('operational');
    }
  });

  it('communication → approval_required, manager_allowed', () => {
    for (const target of COMMUNICATION) {
      const p = resolveActionPolicy(target, 'manager');
      expect(p.gate, target).toBe('approval_required');
      expect(p.minimumRole, target).toBe('manager_allowed');
      expect(p.reason, target).toBe('communication');
    }
  });

  it('operational mutation / marketing / purchasing → approval_required, manager_allowed', () => {
    for (const target of OPERATIONAL_MANAGER) {
      const p = resolveActionPolicy(target, 'manager');
      expect(p.gate, target).toBe('approval_required');
      expect(p.minimumRole, target).toBe('manager_allowed');
      expect(p.reason, target).toBe('operational');
    }
  });

  it('financial → approval_required, owner_only', () => {
    for (const target of FINANCIAL) {
      const p = resolveActionPolicy(target, 'owner');
      expect(p.gate, target).toBe('approval_required');
      expect(p.minimumRole, target).toBe('owner_only');
      expect(p.reason, target).toBe('financial');
    }
  });
});

describe('resolveActionPolicy — store kill-switch', () => {
  it('a target listed in settings.intelligenceDisabledActions → disabled', () => {
    const settings = { [INTELLIGENCE_DISABLED_ACTIONS_KEY]: ['whatsapp_url', 'pos_discount'] };
    const wa = resolveActionPolicy('whatsapp_url', 'owner', settings);
    expect(wa.gate).toBe('disabled');
    expect(wa.reason).toBe('disabled_by_store');
    // disabled wins over the intrinsic financial classification too.
    const disc = resolveActionPolicy('pos_discount', 'owner', settings);
    expect(disc.gate).toBe('disabled');
  });

  it('store kill-switch does not affect un-listed targets', () => {
    const settings = { [INTELLIGENCE_DISABLED_ACTIONS_KEY]: ['whatsapp_url'] };
    const p = resolveActionPolicy('open_customer', 'owner', settings);
    expect(p.gate).toBe('auto_execute');
  });

  it('ignores a malformed disabled list safely', () => {
    const settings = { [INTELLIGENCE_DISABLED_ACTIONS_KEY]: 'not-an-array' as unknown };
    const p = resolveActionPolicy('whatsapp_url', 'owner', settings as Record<string, unknown>);
    expect(p.gate).toBe('approval_required'); // intrinsic, not disabled
  });
});

describe('resolveActionPolicy — safety & purity', () => {
  it('unknown / unregistered target → fail-safe (approval_required, owner_only)', () => {
    const p = resolveActionPolicy('do_something_dangerous', 'owner');
    expect(p.gate).toBe('approval_required');
    expect(p.minimumRole).toBe('owner_only');
    expect(p.reason).toBe('unknown_action');
  });

  it('empty / whitespace / null-ish target → fail-safe, never throws', () => {
    for (const bad of ['', '   ', undefined as unknown as string, null as unknown as string]) {
      const p = resolveActionPolicy(bad, 'owner');
      expect(p.gate).toBe('approval_required');
      expect(p.reason).toBe('unknown_action');
    }
  });

  it('is deterministic & role-independent for the intrinsic policy', () => {
    const a = resolveActionPolicy('pos_discount', 'owner');
    const b = resolveActionPolicy('pos_discount', 'employee');
    const c = resolveActionPolicy('pos_discount', 'manager');
    const expected: ActionPolicy = { gate: 'approval_required', minimumRole: 'owner_only', reason: 'financial' };
    expect(a).toEqual(expected);
    expect(b).toEqual(expected);
    expect(c).toEqual(expected);
  });

  it('returns a fresh object (no shared mutable state across calls)', () => {
    const a = resolveActionPolicy('open_customer', 'owner');
    const b = resolveActionPolicy('open_customer', 'owner');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
