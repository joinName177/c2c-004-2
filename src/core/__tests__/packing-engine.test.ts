import { describe, expect, it } from 'vitest';
import { packItems, packWithLocks, validateSuitcase } from '../packing-engine';
import { intersects } from '../geometry';
import type { PackingItem, Suitcase } from '../models';

const suitcase = (overrides: Partial<Suitcase> = {}): Suitcase => ({ length: 10, width: 8, height: 6, maxWeight: 10, ...overrides });
const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({
  id, name: id, category: '衣物', length: 3, width: 2, height: 1, weight: 1, priority: 2, mustHave: false, ...overrides,
});

describe('validateSuitcase', () => {
  it('rejects each non-positive capacity', () => {
    expect(validateSuitcase(suitcase({ height: 0 }))).toContain('行李箱高度必须大于 0');
    expect(validateSuitcase(suitcase({ maxWeight: -1 }))).toContain('承重必须大于 0');
  });
});

describe('packItems', () => {
  it('allows total weight exactly at the suitcase limit', () => {
    const plan = packItems(suitcase({ maxWeight: 2 }), [item('a'), item('b')], 'comfort');
    expect(plan.placements).toHaveLength(2);
    expect(plan.totalWeight).toBe(2);
  });

  it('uses rotation when the original orientation does not fit', () => {
    const plan = packItems(suitcase({ length: 4, width: 3, height: 2 }), [item('rotated', { length: 2, width: 4, height: 3 })], 'comfort');
    expect(plan.placements[0]?.dimensions).toEqual({ length: 4, width: 3, height: 2 });
  });

  it('keeps placements inside bounds and non-overlapping', () => {
    const plan = packItems(suitcase(), [item('a'), item('b'), item('c')], 'comfort');
    expect(plan.placements.every((p) => p.x + p.dimensions.length <= 10 && p.y + p.dimensions.width <= 8 && p.z + p.dimensions.height <= 6)).toBe(true);
    expect(new Set(plan.placements.map((p) => `${p.x}:${p.y}:${p.z}`)).size).toBe(3);
  });

  it('returns deterministic coordinates and an unplaced reason', () => {
    const inputs = [item('a'), item('huge', { length: 30 })];
    expect(packItems(suitcase(), inputs, 'comfort')).toEqual(packItems(suitcase(), inputs, 'comfort'));
    expect(packItems(suitcase(), inputs, 'comfort').unplaced[0]?.reason).toContain('空间');
  });
});

describe('packWithLocks', () => {
  it('keeps locked placements untouched and packs unlocked items around them', () => {
    const locks = { a: { itemId: 'a', x: 5, y: 5, z: 0, dimensions: { length: 3, width: 2, height: 1 } } };
    const plan = packWithLocks(suitcase(), [item('a'), item('b')], 'comfort', locks);
    const locked = plan.placements.find((p) => p.itemId === 'a');
    expect(locked).toMatchObject({ x: 5, y: 5, z: 0, dimensions: { length: 3, width: 2, height: 1 } });
    const other = plan.placements.find((p) => p.itemId === 'b');
    expect(other).toBeDefined();
    expect(intersects(locked!, other!)).toBe(false);
  });

  it('counts locked items toward weight and volume reserves', () => {
    const locks = { a: { itemId: 'a', x: 0, y: 0, z: 0, dimensions: { length: 3, width: 2, height: 1 } } };
    const plan = packWithLocks(suitcase({ maxWeight: 1.5 }), [item('a'), item('b')], 'comfort', locks);
    expect(plan.placements.map((p) => p.itemId)).toEqual(['a']);
    expect(plan.unplaced[0]?.item.id).toBe('b');
  });

  it('ignores locks that no longer fit and packs the item as unlocked', () => {
    const locks = { a: { itemId: 'a', x: 9, y: 0, z: 0, dimensions: { length: 3, width: 2, height: 1 } } };
    const plan = packWithLocks(suitcase(), [item('a')], 'comfort', locks);
    expect(plan.placements[0]).toMatchObject({ itemId: 'a', x: 0, y: 0, z: 0 });
  });
});
