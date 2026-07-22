// ============================================================
// P0-C1 — per-line carrier authority tests. Each phone line resolves its OWN
// saved carrier from customer.carriers[index]; no global carrier overwrites
// all rows. Mixed H2O/Verizon/Verizon customer is the mandated case.
// ============================================================

import { describe, it, expect } from 'vitest';
import type { Customer } from '@/store/types';
import { getCarrierForPhone } from './linePayments';

const mixed = {
  id: 'c1',
  phone: '8055705895',
  phones: ['8055705895', '8052238255', '8052205932'],
  carriers: ['H2O', 'Verizon', 'Verizon'],
  carrier: 'H2O',
} as unknown as Customer;

describe('getCarrierForPhone — per-line carrier authority', () => {
  it('resolves each line to its own saved carrier', () => {
    expect(getCarrierForPhone(mixed, '8055705895')).toBe('H2O');
    expect(getCarrierForPhone(mixed, '8052238255')).toBe('Verizon');
    expect(getCarrierForPhone(mixed, '8052205932')).toBe('Verizon');
  });

  it('never returns one global carrier for every row (line 2 ≠ line 1)', () => {
    expect(getCarrierForPhone(mixed, '8052238255')).not.toBe(getCarrierForPhone(mixed, '8055705895'));
  });

  it('matches on last-10 digits regardless of formatting', () => {
    expect(getCarrierForPhone(mixed, '(805) 223-8255')).toBe('Verizon');
    expect(getCarrierForPhone(mixed, '1-805-570-5895')).toBe('H2O');
  });

  it('falls back to primary carrier for index 0 when carriers[] is short', () => {
    const legacy = { id: 'c2', phone: '8050001111', phones: ['8050001111'], carrier: 'AT&T' } as unknown as Customer;
    expect(getCarrierForPhone(legacy, '8050001111')).toBe('AT&T');
  });

  it('returns empty for an unknown phone or missing customer', () => {
    expect(getCarrierForPhone(mixed, '9999999999')).toBe('');
    expect(getCarrierForPhone(null, '8055705895')).toBe('');
  });
});
