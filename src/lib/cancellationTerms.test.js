import { describe, it, expect } from 'vitest';
import { getCancellationTerms, GRACE_PERIOD_MS } from './cancellationTerms';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date('2026-09-16T12:00:00Z');

describe('getCancellationTerms', () => {
  it('grace period: 0% fee no matter how close the start date is', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString(), // 30 min ago
        startDate: new Date(now.getTime() + DAY).toISOString(), // starts tomorrow — 25% by tier alone
        amountPaid: 1000,
      },
      now
    );
    expect(terms.isGracePeriod).toBe(true);
    expect(terms.feePercent).toBe(0);
    expect(terms.fee).toBe(0);
    expect(terms.refund).toBe(1000);
  });

  it('just after the grace period expires, falls through to the tier table', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - (GRACE_PERIOD_MS + 1)).toISOString(), // 2h + 1ms ago
        startDate: new Date(now.getTime() + 2 * DAY).toISOString(), // 2 days out -> 25% tier
        amountPaid: 1000,
      },
      now
    );
    expect(terms.isGracePeriod).toBe(false);
    expect(terms.feePercent).toBe(25);
    expect(terms.fee).toBe(250);
    expect(terms.refund).toBe(750);
  });

  it('exactly 7 days before start: 0% fee (top of the "7+" tier)', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 3 * DAY).toISOString(),
        startDate: new Date(now.getTime() + 7 * DAY).toISOString(),
        amountPaid: 2000,
      },
      now
    );
    expect(terms.daysUntilStart).toBe(7);
    expect(terms.feePercent).toBe(0);
    expect(terms.fee).toBe(0);
    expect(terms.refund).toBe(2000);
  });

  it('exactly 3 days before start: 10% fee (top of the "3-6" tier)', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 3 * DAY).toISOString(),
        startDate: new Date(now.getTime() + 3 * DAY).toISOString(),
        amountPaid: 2000,
      },
      now
    );
    expect(terms.daysUntilStart).toBe(3);
    expect(terms.feePercent).toBe(10);
    expect(terms.fee).toBe(200);
    expect(terms.refund).toBe(1800);
  });

  it('exactly 1 day before start: 25% fee (top of the "1-2" tier)', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 3 * DAY).toISOString(),
        startDate: new Date(now.getTime() + 1 * DAY).toISOString(),
        amountPaid: 2000,
      },
      now
    );
    expect(terms.daysUntilStart).toBe(1);
    expect(terms.feePercent).toBe(25);
    expect(terms.fee).toBe(500);
    expect(terms.refund).toBe(1500);
  });

  it('0 days (rental starts today): 100% fee, non-refundable', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 3 * DAY).toISOString(),
        startDate: new Date(now.getTime()).toISOString(),
        amountPaid: 2000,
      },
      now
    );
    expect(terms.daysUntilStart).toBe(0);
    expect(terms.feePercent).toBe(100);
    expect(terms.fee).toBe(2000);
    expect(terms.refund).toBe(0);
  });

  it('negative days (rental already started): 100% fee, non-refundable', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 5 * DAY).toISOString(),
        startDate: new Date(now.getTime() - 1 * DAY).toISOString(),
        amountPaid: 2000,
      },
      now
    );
    expect(terms.daysUntilStart).toBeLessThan(0);
    expect(terms.feePercent).toBe(100);
    expect(terms.fee).toBe(2000);
    expect(terms.refund).toBe(0);
  });

  it('grace period overrides the tier table even when the tier would say otherwise', () => {
    // Booked 1 hour ago (inside grace), rental starts tomorrow — the tier
    // table alone would say 25%, but grace period wins outright.
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 1 * HOUR).toISOString(),
        startDate: new Date(now.getTime() + 1 * DAY).toISOString(),
        amountPaid: 1000,
      },
      now
    );
    expect(terms.isGracePeriod).toBe(true);
    expect(terms.feePercent).toBe(0);
    expect(terms.fee).toBe(0);
    expect(terms.refund).toBe(1000);
  });

  it('rounds the fee to the nearest whole currency unit', () => {
    const terms = getCancellationTerms(
      {
        createdAt: new Date(now.getTime() - 3 * DAY).toISOString(),
        startDate: new Date(now.getTime() + 3 * DAY).toISOString(), // 10% tier
        amountPaid: 999,
      },
      now
    );
    expect(terms.feePercent).toBe(10);
    expect(terms.fee).toBe(100); // round(99.9) = 100
    expect(terms.refund).toBe(899);
  });
});
