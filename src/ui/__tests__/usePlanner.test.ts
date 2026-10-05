import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../../core/sample-data';
import { emptyWorkbench } from '../../core/manual';
import { usePlanner } from '../usePlanner';
import type { PackingSnapshot } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  constructor(private snapshot = createSampleSnapshot()) {}
  load() { return { value: structuredClone(this.snapshot) }; }
  save(snapshot: PackingSnapshot) { this.saved = structuredClone(snapshot); }
}

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    const initial = planner.state.items.length;
    planner.addItem({ id: 'new', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.state.items).toHaveLength(initial + 1);
    expect(planner.isStale.value).toBe(true);
    planner.updateItem('new', { name: '遮阳帽' });
    expect(planner.state.items.find((item) => item.id === 'new')?.name).toBe('遮阳帽');
    planner.removeItem('new');
    expect(planner.state.items).toHaveLength(initial);
  });

  it('regenerates plans and persists the selected mode', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.selectedPlan).toBe('shopping');
  });
});

describe('manual workbench', () => {
  const smallSnapshot = (): PackingSnapshot => ({
    suitcase: { length: 10, width: 8, height: 6, maxWeight: 10 },
    selectedPlan: 'comfort',
    workbench: emptyWorkbench(),
    items: [
      { id: 'a', name: '物品A', category: '衣物', length: 4, width: 2, height: 2, weight: 1, priority: 2, mustHave: false },
      { id: 'b', name: '物品B', category: '衣物', length: 4, width: 2, height: 2, weight: 1, priority: 2, mustHave: false },
    ],
  });
  const setup = () => {
    const repository = new MemoryRepository(smallSnapshot());
    const planner = usePlanner({ repository, printPort: { print() {} } });
    return { repository, planner };
  };
  const placementOf = (planner: ReturnType<typeof usePlanner>, id: string) => planner.currentPlan.value.placements.find((p) => p.itemId === id);

  it('previews a move and commits it only when valid', () => {
    const { planner } = setup();
    planner.updatePreview('a', { x: 6, y: 2 });
    expect(planner.preview.value?.placement).toMatchObject({ itemId: 'a', x: 6, y: 2, z: 0 });
    expect(planner.previewViolations.value).toEqual([]);
    expect(planner.commitPreview()).toBe(true);
    expect(placementOf(planner, 'a')).toMatchObject({ x: 6, y: 2 });
    expect(planner.preview.value).toBeNull();
  });

  it('blocks committing out-of-bounds, intersecting or unsupported previews', () => {
    const { planner } = setup();
    planner.updatePreview('a', { x: 8 });
    expect(planner.previewViolations.value).toContain('out-of-bounds');
    expect(planner.commitPreview()).toBe(false);

    planner.updatePreview('a', { x: 4, y: 0, z: 0 });
    expect(planner.previewViolations.value).toContain('intersection');
    expect(planner.commitPreview()).toBe(false);

    planner.updatePreview('a', { x: 0, y: 0, z: 1 });
    expect(planner.previewViolations.value).toContain('unsupported');
    expect(planner.commitPreview()).toBe(false);

    planner.cancelPreview();
    expect(planner.preview.value).toBeNull();
    expect(placementOf(planner, 'a')).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('rotates the selected item through unique orientations', () => {
    const { planner } = setup();
    planner.rotateItem('a');
    expect(planner.preview.value?.placement.dimensions).toEqual({ length: 2, width: 4, height: 2 });
    expect(planner.commitPreview()).toBe(true);
    expect(placementOf(planner, 'a')?.dimensions).toEqual({ length: 2, width: 4, height: 2 });
  });

  it('undo restores the exact state before an adjustment', () => {
    const { planner } = setup();
    planner.updatePreview('a', { x: 6, y: 2 });
    planner.commitPreview();
    planner.toggleLock('a');
    expect(planner.state.workbench.locks.a).toBeDefined();
    planner.undo();
    expect(planner.state.workbench.locks.a).toBeUndefined();
    planner.undo();
    expect(placementOf(planner, 'a')).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(planner.canUndo.value).toBe(false);
  });

  it('keeps locked items in place when regenerating plans', () => {
    const { planner } = setup();
    planner.updatePreview('a', { x: 6, y: 2 });
    planner.commitPreview();
    planner.toggleLock('a');
    planner.updateSuitcase({ maxWeight: 9 });
    planner.regenerate();
    expect(placementOf(planner, 'a')).toMatchObject({ x: 6, y: 2, z: 0 });
    expect(planner.state.workbench.locks.a).toMatchObject({ x: 6, y: 2 });
  });

  it('lists conflicts when the suitcase shrinks and waits for unlock or cancel', () => {
    const { planner } = setup();
    planner.toggleLock('a');
    planner.updateSuitcase({ length: 3 });
    expect(planner.conflicts.value).toEqual([{ itemId: 'a', reasons: ['out-of-bounds'] }]);
    // 保留上次有效摆放，且暂时不能重新装箱
    expect(placementOf(planner, 'a')).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(planner.canRegenerate.value).toBe(false);
    planner.regenerate();
    expect(planner.isStale.value).toBe(true);

    planner.cancelPendingChange();
    expect(planner.state.suitcase.length).toBe(10);
    expect(planner.conflicts.value).toEqual([]);
  });

  it('resolves conflicts by unlocking the item', () => {
    const { planner } = setup();
    planner.toggleLock('a');
    planner.updateSuitcase({ length: 3 });
    expect(planner.conflicts.value).toHaveLength(1);
    planner.resolveConflictByUnlock('a');
    expect(planner.conflicts.value).toEqual([]);
    expect(planner.state.workbench.locks.a).toBeUndefined();
    expect(planner.canRegenerate.value).toBe(true);
  });

  it('flags locked items whose dimensions were edited', () => {
    const { planner } = setup();
    planner.toggleLock('a');
    planner.updateItem('a', { length: 6 });
    expect(planner.conflicts.value[0]?.reasons).toContain('dimensions-changed');
    planner.cancelPendingChange();
    expect(planner.state.items.find((item) => item.id === 'a')?.length).toBe(4);
    expect(planner.conflicts.value).toEqual([]);
  });

  it('persists locks and manual arrangements across sessions', () => {
    const { repository, planner } = setup();
    planner.updatePreview('a', { x: 6, y: 2 });
    planner.commitPreview();
    planner.toggleLock('a');
    expect(repository.saved?.workbench.locks.a).toMatchObject({ x: 6, y: 2 });

    const reopened = usePlanner({ repository: new MemoryRepository(repository.saved!), printPort: { print() {} } });
    expect(reopened.state.workbench.locks.a).toMatchObject({ x: 6, y: 2 });
    expect(reopened.currentPlan.value.placements.find((p) => p.itemId === 'a')).toMatchObject({ x: 6, y: 2 });
  });
});
