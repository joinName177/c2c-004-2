import { describe, expect, it } from 'vitest';
import { usePlanner } from '../usePlanner';
import type { PackingSnapshot } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

const makeSnapshot = (): PackingSnapshot => ({
  suitcase: { length: 10, width: 10, height: 10, maxWeight: 20 },
  selectedPlan: 'comfort',
  manual: null,
  items: [
    { id: 'a', name: '物品A', category: '衣物', length: 4, width: 4, height: 2, weight: 1, priority: 2, mustHave: false },
    { id: 'b', name: '物品B', category: '衣物', length: 4, width: 4, height: 2, weight: 1, priority: 2, mustHave: false },
  ],
});

class MemoryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  constructor(private snapshot: PackingSnapshot = makeSnapshot()) {}
  load() { return { value: structuredClone(this.snapshot) }; }
  save(next: PackingSnapshot) { this.saved = structuredClone(next); }
}

function manualPlanner() {
  const repository = new MemoryRepository();
  const planner = usePlanner({ repository, printPort: { print() {} } });
  planner.startManual();
  return { planner, repository };
}

const placementOf = (planner: ReturnType<typeof usePlanner>, itemId: string) =>
  planner.state.manual?.placements.find((placement) => placement.itemId === itemId);

describe('manual workbench draft flow', () => {
  it('commits a valid draft and updates plan, risks and persistence together', () => {
    const { planner, repository } = manualPlanner();
    planner.beginDraft('a');
    planner.updateDraft({ y: 1 });
    planner.commitDraft();
    expect(placementOf(planner, 'a')?.y).toBe(1);
    expect(planner.draft.value).toBeNull();
    expect(planner.effectivePlan.value.id).toBe('manual');
    expect(repository.saved?.manual?.placements.find((p) => p.itemId === 'a')?.y).toBe(1);
  });

  it('previews but never commits out-of-bounds, overlapping or unsupported drafts', () => {
    const { planner } = manualPlanner();
    planner.beginDraft('a');

    planner.updateDraft({ x: 8 });
    expect(planner.draftIssues.value.map((issue) => issue.kind)).toContain('out-of-bounds');
    planner.commitDraft();
    expect(planner.draft.value).not.toBeNull();
    expect(placementOf(planner, 'a')?.x).toBe(0);

    planner.updateDraft({ x: 4 }); // 与 b (x 4..8) 相交
    expect(planner.draftIssues.value.map((issue) => issue.kind)).toContain('overlap');
    planner.commitDraft();
    expect(planner.draft.value).not.toBeNull();

    planner.updateDraft({ x: 0, y: 6, z: 3 }); // 悬空
    expect(planner.draftIssues.value.map((issue) => issue.kind)).toContain('unsupported');
    planner.commitDraft();
    expect(planner.draft.value).not.toBeNull();

    planner.updateDraft({ z: 0 });
    expect(planner.draftIssues.value).toHaveLength(0);
    planner.commitDraft();
    expect(placementOf(planner, 'a')).toMatchObject({ x: 0, y: 6, z: 0 });
  });

  it('rotates a draft through the item rotations and keeps it committable', () => {
    const { planner } = manualPlanner();
    planner.beginDraft('a');
    const before = { ...planner.draft.value!.placement.dimensions };
    planner.rotateDraft();
    const after = planner.draft.value!.placement.dimensions;
    expect(after).not.toEqual(before);
    expect([after.length, after.width, after.height].sort()).toEqual([2, 4, 4]);
    expect(planner.draftIssues.value).toHaveLength(0);
    planner.commitDraft();
    expect(placementOf(planner, 'a')?.dimensions).toEqual(after);
  });

  it('undoes a commit completely, including locks', () => {
    const { planner } = manualPlanner();
    planner.beginDraft('a');
    planner.updateDraft({ x: 1 });
    planner.commitDraft();
    planner.toggleLock('a');
    expect(placementOf(planner, 'a')?.locked).toBe(true);
    planner.undoManual();
    expect(placementOf(planner, 'a')?.locked).toBe(false);
    planner.undoManual();
    expect(placementOf(planner, 'a')?.x).toBe(0);
    expect(planner.canUndo.value).toBe(false);
  });

  it('takes an unplaced item back into the layout via draft', () => {
    const { planner } = manualPlanner();
    planner.removeFromLayout('b');
    expect(planner.manualPlan.value?.unplaced.map((entry) => entry.item.id)).toEqual(['b']);
    planner.beginDraft('b');
    expect(planner.draftIssues.value.map((issue) => issue.kind)).toContain('overlap'); // 原点与 a 相交
    planner.updateDraft({ x: 0, y: 4, z: 0 });
    expect(planner.draftIssues.value).toHaveLength(0);
    planner.commitDraft();
    expect(placementOf(planner, 'b')).toMatchObject({ x: 0, y: 4, z: 0 });
  });
});

describe('locked placements', () => {
  it('repacks only unlocked items and never moves locked ones', () => {
    const { planner } = manualPlanner();
    planner.beginDraft('a');
    planner.updateDraft({ x: 5, y: 5 });
    planner.commitDraft();
    planner.toggleLock('a');
    planner.repackUnlocked();
    expect(placementOf(planner, 'a')).toMatchObject({ x: 5, y: 5, locked: true });
    expect(planner.manualPlan.value?.placements).toHaveLength(2);
    expect(planner.isStale.value).toBe(false);
  });

  it('refuses to lock an invalid placement', () => {
    const { planner } = manualPlanner();
    planner.updateSuitcase({ length: 5 }); // a 在 0..4 仍有效，b 在 4..8 越界失效
    planner.toggleLock('b');
    expect(placementOf(planner, 'b')?.locked).toBe(false);
    expect(planner.notice.value).toContain('无法锁定');
  });

  it('restores locked arrangements after a reload', () => {
    const { planner, repository } = manualPlanner();
    planner.toggleLock('a');
    const reopened = usePlanner({ repository: new MemoryRepository(repository.saved!), printPort: { print() {} } });
    expect(reopened.state.manual?.placements.find((p) => p.itemId === 'a')?.locked).toBe(true);
    expect(reopened.effectivePlan.value.id).toBe('manual');
  });
});

describe('dimension change conflicts', () => {
  it('keeps the last valid placement, lists the conflict and waits for unlock', () => {
    const { planner } = manualPlanner();
    planner.beginDraft('a');
    planner.updateDraft({ x: 6, y: 6 });
    planner.commitDraft();
    planner.toggleLock('a');

    planner.updateSuitcase({ length: 5 }); // a 现在 6..10，越界
    expect(planner.conflicts.value).toHaveLength(1);
    expect(planner.conflicts.value[0].itemId).toBe('a');
    expect(placementOf(planner, 'a')?.x).toBe(6); // 保留上次有效摆放

    planner.repackUnlocked();
    expect(planner.notice.value).toContain('冲突'); // 冲突未解决前不重新装箱

    planner.toggleLock('a'); // 用户解除锁定
    expect(planner.conflicts.value).toHaveLength(0);
    expect(planner.manualPlan.value?.unplaced.map((entry) => entry.item.id)).toContain('a'); // 失效位置自动回到待装
    planner.repackUnlocked();
    const packed = placementOf(planner, 'a');
    expect(packed).toBeDefined();
    expect(packed!.x + packed!.dimensions.length).toBeLessThanOrEqual(5);
  });

  it('cancels the conflicting suitcase change and restores the previous size', () => {
    const { planner } = manualPlanner();
    planner.beginDraft('a');
    planner.updateDraft({ x: 6, y: 6 });
    planner.commitDraft();
    planner.toggleLock('a');
    planner.updateSuitcase({ length: 5 });
    expect(planner.conflicts.value).toHaveLength(1);

    planner.cancelConflictingChange();
    expect(planner.state.suitcase.length).toBe(10);
    expect(planner.conflicts.value).toHaveLength(0);
    expect(placementOf(planner, 'a')).toMatchObject({ x: 6, locked: true });
  });

  it('flags locked placements when the item itself changes size, and cancel restores it', () => {
    const { planner } = manualPlanner();
    planner.toggleLock('a');
    planner.updateItem('a', { length: 8 });
    expect(planner.conflicts.value).toHaveLength(1);
    expect(planner.conflicts.value[0].issues.map((issue) => issue.kind)).toContain('changed');

    planner.cancelConflictingChange();
    expect(planner.state.items.find((item) => item.id === 'a')?.length).toBe(4);
    expect(planner.conflicts.value).toHaveLength(0);
  });
});
