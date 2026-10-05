import { describe, expect, it } from 'vitest';
import { bottomSupported, buildManualPlan, findLayoutConflicts, placementIssues } from '../manual-packing';
import { packItems } from '../packing-engine';
import type { ManualLayout, PackingItem, Placement, Suitcase } from '../models';

const suitcase = (overrides: Partial<Suitcase> = {}): Suitcase => ({ length: 10, width: 8, height: 6, maxWeight: 10, ...overrides });
const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({
  id, name: id, category: '衣物', length: 3, width: 2, height: 1, weight: 1, priority: 2, mustHave: false, ...overrides,
});
const placement = (itemId: string, overrides: Partial<Placement> = {}): Placement => ({
  itemId, x: 0, y: 0, z: 0, dimensions: { length: 3, width: 2, height: 1 }, ...overrides,
});
const kinds = (issues: { kind: string }[]) => issues.map((issue) => issue.kind);

describe('placementIssues', () => {
  it('flags placements crossing the suitcase boundary', () => {
    expect(kinds(placementIssues(suitcase(), placement('a', { x: 8 }), []))).toContain('out-of-bounds');
    expect(kinds(placementIssues(suitcase(), placement('a', { y: -1 }), []))).toContain('out-of-bounds');
    expect(placementIssues(suitcase(), placement('a', { x: 7, y: 6 }), [])).toHaveLength(0);
  });

  it('flags overlap but allows face contact', () => {
    const touching = placement('b', { x: 3 });
    expect(placementIssues(suitcase(), placement('a'), [touching])).toHaveLength(0);
    const overlapping = placement('b', { x: 2.5 });
    expect(kinds(placementIssues(suitcase(), placement('a'), [overlapping]))).toContain('overlap');
  });

  it('requires the bottom face to be fully supported', () => {
    const floating = placement('a', { z: 1 });
    expect(kinds(placementIssues(suitcase(), floating, []))).toContain('unsupported');

    const fullSupport = placement('b', { z: 0 });
    expect(placementIssues(suitcase(), floating, [fullSupport])).toHaveLength(0);

    const halfSupport = placement('b', { z: 0, dimensions: { length: 1.5, width: 2, height: 1 } });
    expect(kinds(placementIssues(suitcase(), floating, [halfSupport]))).toContain('unsupported');

    const otherHalf = placement('c', { x: 1.5, z: 0, dimensions: { length: 1.5, width: 2, height: 1 } });
    expect(placementIssues(suitcase(), floating, [halfSupport, otherHalf])).toHaveLength(0);
  });
});

describe('bottomSupported', () => {
  it('treats the floor as full support', () => {
    expect(bottomSupported(placement('a'), [])).toBe(true);
  });

  it('rejects supporters whose top is not exactly at the placement bottom', () => {
    const below = placement('b', { z: 0 });
    expect(bottomSupported(placement('a', { z: 2 }), [below])).toBe(false);
    expect(bottomSupported(placement('a', { z: 1 }), [below])).toBe(true);
  });
});

describe('findLayoutConflicts', () => {
  it('reports locked placements invalidated by a suitcase shrink', () => {
    const layout: ManualLayout = { placements: [{ ...placement('a', { x: 7 }), locked: true }] };
    const conflicts = findLayoutConflicts(suitcase({ length: 9 }), [item('a')], layout);
    expect(conflicts).toHaveLength(1);
    expect(kinds(conflicts[0].issues)).toContain('out-of-bounds');
  });

  it('reports locked placements invalidated by an item dimension change', () => {
    const layout: ManualLayout = { placements: [{ ...placement('a'), locked: true }] };
    const conflicts = findLayoutConflicts(suitcase(), [item('a', { length: 4 })], layout);
    expect(conflicts).toHaveLength(1);
    expect(kinds(conflicts[0].issues)).toContain('changed');
  });

  it('ignores unlocked placements and deleted items', () => {
    const layout: ManualLayout = { placements: [{ ...placement('a', { x: 7 }), locked: false }, { ...placement('gone'), locked: true }] };
    expect(findLayoutConflicts(suitcase({ length: 9 }), [item('a')], layout)).toHaveLength(0);
  });
});

describe('buildManualPlan', () => {
  it('keeps invalid locked placements in place but drops invalid unlocked ones to unplaced', () => {
    const layout: ManualLayout = { placements: [
      { ...placement('locked', { x: 7 }), locked: true },
      { ...placement('free', { x: 7, y: 3 }), locked: false },
    ] };
    const plan = buildManualPlan(suitcase({ length: 9 }), [item('locked'), item('free')], layout);
    expect(plan.placements.map((p) => p.itemId)).toEqual(['locked']);
    expect(plan.unplaced.map((entry) => entry.item.id)).toEqual(['free']);
    expect(plan.unplaced[0].reason).toContain('失效');
  });

  it('lists items missing from the layout as unplaced and computes totals', () => {
    const plan = buildManualPlan(suitcase(), [item('a'), item('b')], { placements: [{ ...placement('a'), locked: false }] });
    expect(plan.unplaced.map((entry) => entry.item.id)).toEqual(['b']);
    expect(plan.totalWeight).toBe(1);
    expect(plan.usedVolume).toBe(6);
  });
});

describe('packItems with fixed placements', () => {
  it('never moves fixed placements and counts their weight and volume', () => {
    const fixed = placement('heavy', { x: 6, y: 6, z: 0 });
    const plan = packItems(suitcase({ maxWeight: 2 }), [item('heavy'), item('light', { weight: 0.5 })], 'comfort', [fixed]);
    expect(plan.placements.find((p) => p.itemId === 'heavy')).toMatchObject({ x: 6, y: 6, z: 0 });
    expect(plan.totalWeight).toBe(1.5);
    expect(plan.usedVolume).toBe(12);
  });

  it('packs remaining items around fixed obstacles without overlap', () => {
    const slab = placement('a', { dimensions: { length: 10, width: 8, height: 3 } });
    const plan = packItems(suitcase(), [item('a', { length: 10, width: 8, height: 3 }), item('b')], 'comfort', [slab]);
    const b = plan.placements.find((p) => p.itemId === 'b');
    expect(b?.z).toBe(3);
    expect(plan.placements).toHaveLength(2);
  });

  it('leaves items unplaced when fixed placements consume the weight reserve', () => {
    const fixed = placement('heavy', { x: 0, y: 0, z: 0 });
    const plan = packItems(suitcase({ maxWeight: 1.5 }), [item('heavy'), item('extra')], 'comfort', [fixed]);
    expect(plan.placements.map((p) => p.itemId)).toEqual(['heavy']);
    expect(plan.unplaced[0]?.item.id).toBe('extra');
    expect(plan.unplaced[0]?.reason).toContain('承重');
  });
});
