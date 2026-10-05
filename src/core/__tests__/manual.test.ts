import { describe, expect, it } from 'vitest';
import { recalculatePlan, supportRatio, validateLocks, validatePlacement } from '../manual';
import type { PackingItem, PackingPlan, Placement, Suitcase } from '../models';

const suitcase = (overrides: Partial<Suitcase> = {}): Suitcase => ({ length: 10, width: 8, height: 6, maxWeight: 10, ...overrides });
const placement = (itemId: string, overrides: Partial<Placement> = {}): Placement => ({ itemId, x: 0, y: 0, z: 0, dimensions: { length: 4, width: 2, height: 2 }, ...overrides });
const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({
  id, name: id, category: '衣物', length: 4, width: 2, height: 2, weight: 1, priority: 2, mustHave: false, ...overrides,
});

describe('supportRatio', () => {
  it('treats the floor as full support', () => {
    expect(supportRatio(placement('a'), [])).toBe(1);
  });

  it('measures footprint coverage from items directly below', () => {
    const below = placement('b', { dimensions: { length: 4, width: 1, height: 2 } });
    expect(supportRatio(placement('a', { z: 2 }), [below])).toBe(0.5);
  });

  it('ignores items whose top does not align with the base', () => {
    const below = placement('b', { dimensions: { length: 4, width: 2, height: 1 } });
    expect(supportRatio(placement('a', { z: 2 }), [below])).toBe(0);
  });
});

describe('validatePlacement', () => {
  it('flags out-of-bounds positions', () => {
    expect(validatePlacement(placement('a', { x: 8 }), [], suitcase())).toContain('out-of-bounds');
    expect(validatePlacement(placement('a', { z: -1 }), [], suitcase())).toContain('out-of-bounds');
  });

  it('flags intersections with other items', () => {
    expect(validatePlacement(placement('a'), [placement('b')], suitcase())).toContain('intersection');
  });

  it('flags a base without full support', () => {
    const below = placement('b', { dimensions: { length: 4, width: 1, height: 2 } });
    expect(validatePlacement(placement('a', { z: 2 }), [below], suitcase())).toContain('unsupported');
  });

  it('accepts a fully supported stacked placement', () => {
    const below = placement('b', { dimensions: { length: 4, width: 2, height: 2 } });
    expect(validatePlacement(placement('a', { z: 2 }), [below], suitcase())).toEqual([]);
  });

  it('ignores the candidate itself in the surroundings', () => {
    expect(validatePlacement(placement('a'), [placement('a')], suitcase())).toEqual([]);
  });
});

describe('validateLocks', () => {
  it('reports locked placements that no longer fit the suitcase', () => {
    const locks = { a: placement('a', { x: 6 }) };
    expect(validateLocks(locks, suitcase({ length: 8 }), [item('a')])).toEqual([{ itemId: 'a', reasons: ['out-of-bounds'] }]);
  });

  it('reports locks whose dimensions stopped matching the item', () => {
    const conflicts = validateLocks({ a: placement('a') }, suitcase(), [item('a', { length: 9 })]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reasons).toContain('dimensions-changed');
  });

  it('reports locks colliding with other locked items', () => {
    const locks = { a: placement('a'), b: placement('b') };
    const conflicts = validateLocks(locks, suitcase(), [item('a'), item('b')]);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]?.reasons).toContain('intersection');
  });

  it('accepts locks that remain valid', () => {
    expect(validateLocks({ a: placement('a') }, suitcase(), [item('a')])).toEqual([]);
  });
});

describe('recalculatePlan', () => {
  const base: PackingPlan = { id: 'comfort', name: '舒适版', placements: [placement('a')], unplaced: [], totalWeight: 1, usedVolume: 16, capacityRatio: 16 / 480 };

  it('recomputes weight, volume and unplaced items from the given placements', () => {
    const plan = recalculatePlan(base, [placement('a'), placement('b', { x: 4 })], [item('a'), item('b', { weight: 2 }), item('c')], suitcase());
    expect(plan.totalWeight).toBe(3);
    expect(plan.usedVolume).toBe(32);
    expect(plan.unplaced.map((entry) => entry.item.id)).toEqual(['c']);
  });

  it('drops placements of removed items', () => {
    const plan = recalculatePlan(base, [placement('a'), placement('ghost')], [item('a')], suitcase());
    expect(plan.placements).toHaveLength(1);
    expect(plan.totalWeight).toBe(1);
  });
});
