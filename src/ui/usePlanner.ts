import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import { rotationsOf } from '../core/geometry';
import { normalizeWorkbench, recalculatePlan, validateLocks, validatePlacement, VIOLATION_LABELS } from '../core/manual';
import type { Dimensions, PackingItem, PackingPlan, PackingSnapshot, Placement, PlanMode, Suitcase, WorkbenchState } from '../core/models';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

const MODES: PlanMode[] = ['minimal', 'comfort', 'shopping'];
const UNDO_LIMIT = 50;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const state = reactive<PackingSnapshot>(loaded.value);
  state.workbench = normalizeWorkbench(state.workbench);
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(false);
  const plans = ref<Record<PlanMode, PackingPlan>>(generatePlans(state.suitcase, state.items, state.workbench.locks));

  // 手动装箱工作台：待确认的预览、撤销栈
  const preview = ref<{ itemId: string; placement: Placement } | null>(null);
  const undoStack = ref<WorkbenchState[]>([]);

  const save = () => repository.save(clone(state) as PackingSnapshot);
  const markStale = () => { isStale.value = true; save(); };

  /** 已提交的摆放：手动调整优先于自动方案，锁定物品始终使用锁定位置 */
  function committedPlacements(mode: PlanMode): Placement[] {
    const locks = state.workbench.locks;
    const base = state.workbench.overrides[mode] ?? plans.value[mode].placements;
    const merged = base.filter((placement) => !locks[placement.itemId]);
    merged.push(...Object.values(locks).map((placement) => clone(placement)));
    return merged;
  }

  const displayPlans = computed(() => {
    const result = {} as Record<PlanMode, PackingPlan>;
    for (const mode of MODES) {
      let placements = committedPlacements(mode);
      if (preview.value && mode === state.selectedPlan) {
        placements = placements.map((placement) => (placement.itemId === preview.value!.itemId ? clone(preview.value!.placement) : placement));
      }
      result[mode] = recalculatePlan(plans.value[mode], placements, state.items, state.suitcase);
    }
    return result;
  });
  const currentPlan = computed(() => displayPlans.value[state.selectedPlan]);
  const risks = computed(() => detectRisks(currentPlan.value, state.suitcase, state.items));

  const conflicts = computed(() => validateLocks(state.workbench.locks, state.suitcase, state.items));
  const previewViolations = computed(() => (preview.value
    ? validatePlacement(preview.value.placement, committedPlacements(state.selectedPlan), state.suitcase)
    : []));
  const previewLabels = computed(() => previewViolations.value.map((violation) => VIOLATION_LABELS[violation]));
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRegenerate = computed(() => conflicts.value.length === 0 && !preview.value);

  /** 尺寸修改后跟踪锁定冲突：保留修改前状态以便“取消修改” */
  function trackConflicts(before: { suitcase: Suitcase; items: PackingItem[] }) {
    if (conflicts.value.length) {
      if (!state.workbench.pendingRevert) state.workbench.pendingRevert = before;
    } else {
      state.workbench.pendingRevert = null;
    }
  }

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const before = clone({ suitcase: state.suitcase, items: state.items });
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    trackConflicts(before);
    markStale();
  }
  function removeItem(id: string) {
    const before = clone({ suitcase: state.suitcase, items: state.items });
    state.items = state.items.filter((item) => item.id !== id);
    delete state.workbench.locks[id];
    for (const mode of MODES) {
      const override = state.workbench.overrides[mode];
      if (override) state.workbench.overrides[mode] = override.filter((placement) => placement.itemId !== id);
    }
    if (preview.value?.itemId === id) preview.value = null;
    trackConflicts(before);
    markStale();
  }
  function updateSuitcase(patch: Partial<Suitcase>) {
    const before = clone({ suitcase: state.suitcase, items: state.items });
    Object.assign(state.suitcase, patch);
    trackConflicts(before);
    markStale();
  }

  function regenerate() {
    if (conflicts.value.length) { notice.value = '请先解除锁定冲突或取消修改'; return; }
    if (preview.value) { notice.value = '请先确认或取消当前移动'; return; }
    plans.value = generatePlans(state.suitcase, state.items, state.workbench.locks);
    state.workbench.overrides = {};
    undoStack.value = [];
    isStale.value = false;
    notice.value = '三套方案已重新计算，锁定物品保持原位';
    save();
  }
  function selectPlan(mode: PlanMode) { preview.value = null; state.selectedPlan = mode; save(); }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample);
    state.workbench = normalizeWorkbench(sample.workbench);
    plans.value = generatePlans(state.suitcase, state.items, state.workbench.locks);
    preview.value = null;
    undoStack.value = [];
    isStale.value = false;
    notice.value = '已恢复登机箱示例';
    save();
  }

  // --- 手动调整：预览 → 确认 / 取消，撤销完整回到调整前 ---

  function pushUndo() {
    undoStack.value.push(clone(state.workbench));
    if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift();
  }

  function undo() {
    const previous = undoStack.value.pop();
    if (!previous) return;
    state.workbench = normalizeWorkbench(previous);
    preview.value = null;
    notice.value = '已撤销，完整回到调整前';
    save();
  }

  function committedPlacementOf(itemId: string): Placement | undefined {
    return committedPlacements(state.selectedPlan).find((placement) => placement.itemId === itemId);
  }

  function updatePreview(itemId: string, patch: Partial<Pick<Placement, 'x' | 'y' | 'z'>> & { dimensions?: Dimensions }) {
    const base = preview.value?.itemId === itemId ? preview.value.placement : committedPlacementOf(itemId);
    if (!base) return;
    const next: Placement = { itemId, x: base.x, y: base.y, z: base.z, dimensions: { ...base.dimensions } };
    if (Number.isFinite(patch.x)) next.x = patch.x!;
    if (Number.isFinite(patch.y)) next.y = patch.y!;
    if (Number.isFinite(patch.z)) next.z = patch.z!;
    if (patch.dimensions) next.dimensions = { ...patch.dimensions };
    preview.value = { itemId, placement: next };
  }

  function rotateItem(itemId: string) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;
    const base = preview.value?.itemId === itemId ? preview.value.placement : committedPlacementOf(itemId);
    if (!base) return;
    const rotations = rotationsOf(item);
    const index = rotations.findIndex((d) => d.length === base.dimensions.length
      && d.width === base.dimensions.width && d.height === base.dimensions.height);
    const dimensions = rotations[(index + 1) % rotations.length] ?? rotations[0];
    updatePreview(itemId, { dimensions });
  }

  function commitPreview(): boolean {
    if (!preview.value || previewViolations.value.length) return false;
    pushUndo();
    const { itemId, placement } = preview.value;
    const mode = state.selectedPlan;
    const next = committedPlacements(mode).map((entry) => (entry.itemId === itemId ? clone(placement) : entry));
    if (!next.some((entry) => entry.itemId === itemId)) next.push(clone(placement));
    state.workbench.overrides[mode] = next;
    if (state.workbench.locks[itemId]) state.workbench.locks[itemId] = clone(placement);
    preview.value = null;
    notice.value = '已确认移动：位置、风险与打印清单已更新';
    save();
    return true;
  }

  function cancelPreview() { preview.value = null; }

  function toggleLock(itemId: string) {
    if (preview.value) { notice.value = '请先确认或取消当前移动'; return; }
    const locks = state.workbench.locks;
    if (locks[itemId]) {
      pushUndo();
      delete locks[itemId];
      notice.value = '已解除锁定，重新装箱将重新安排该物品';
      save();
      return;
    }
    const placement = committedPlacementOf(itemId);
    if (!placement) { notice.value = '物品尚未装入，无法锁定'; return; }
    pushUndo();
    locks[itemId] = clone(placement);
    notice.value = '已锁定当前位置，重新装箱不会移动该物品';
    save();
  }

  // --- 锁定冲突：保留上次有效摆放，等待解除锁定或取消修改 ---

  function resolveConflictByUnlock(itemId: string) {
    if (!state.workbench.locks[itemId]) return;
    pushUndo();
    delete state.workbench.locks[itemId];
    for (const mode of MODES) {
      const override = state.workbench.overrides[mode];
      if (override) state.workbench.overrides[mode] = override.filter((placement) => placement.itemId !== itemId);
    }
    if (!conflicts.value.length) state.workbench.pendingRevert = null;
    notice.value = conflicts.value.length ? '仍有其他锁定冲突待处理' : '冲突已解除，可重新装箱';
    save();
  }

  function cancelPendingChange() {
    const revert = state.workbench.pendingRevert;
    if (!revert) return;
    Object.assign(state.suitcase, clone(revert.suitcase));
    state.items = clone(revert.items);
    state.workbench.pendingRevert = null;
    preview.value = null;
    isStale.value = true;
    notice.value = '已取消修改，箱体与物品尺寸恢复原值';
    save();
  }

  return {
    state, notice, isStale, plans, currentPlan, risks,
    preview, previewViolations, previewLabels, conflicts, canUndo, canRegenerate,
    addItem, updateItem, removeItem, updateSuitcase, regenerate, selectPlan, resetSample,
    updatePreview, rotateItem, commitPreview, cancelPreview, toggleLock, undo,
    resolveConflictByUnlock, cancelPendingChange,
    print: () => printPort.print(),
  };
}
