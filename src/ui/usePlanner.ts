import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import { packItems } from '../core/packing-engine';
import { rotationsOf } from '../core/geometry';
import { buildManualPlan, findLayoutConflicts, isRotationOfItem, placementIssues, planFromPlacements, stalenessIssues, type PlacementIssue } from '../core/manual-packing';
import type { Dimensions, ManualLayout, PackingItem, PackingSnapshot, Placement, PlanMode, Suitcase } from '../core/models';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }
export interface DraftState { itemId: string; placement: Placement }

type GeometryEdit = { kind: 'suitcase'; previous: Suitcase } | { kind: 'item'; id: string; previous: PackingItem };

const GEOMETRY_KEYS: ReadonlyArray<keyof Dimensions> = ['length', 'width', 'height'];
const SNAP = 0.5;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const snap = (value: number) => Math.round(value / SNAP) * SNAP;

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const state = reactive<PackingSnapshot>(loaded.value);
  state.manual ??= null;
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(false);
  const plans = ref(generatePlans(state.suitcase, state.items));
  const draft = ref<DraftState | null>(null);
  const manualHistory = ref<ManualLayout[]>([]);
  const geometryEdits: GeometryEdit[] = [];

  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const manualPlan = computed(() => (state.manual ? buildManualPlan(state.suitcase, state.items, state.manual) : null));
  const effectivePlan = computed(() => manualPlan.value ?? currentPlan.value);
  const risks = computed(() => detectRisks(effectivePlan.value, state.suitcase, state.items));
  const conflicts = computed(() => (state.manual ? findLayoutConflicts(state.suitcase, state.items, state.manual) : []));
  const canUndo = computed(() => manualHistory.value.length > 0);
  const lockedCount = computed(() => state.manual?.placements.filter((placement) => placement.locked).length ?? 0);

  const draftIssues = computed<PlacementIssue[]>(() => {
    if (!state.manual || !draft.value) return [];
    const item = state.items.find((entry) => entry.id === draft.value!.itemId);
    if (!item) return [{ kind: 'changed', message: '物品已被删除' }];
    const issues = placementIssues(state.suitcase, draft.value.placement, state.manual.placements);
    if (!isRotationOfItem(item, draft.value.placement.dimensions)) {
      issues.unshift({ kind: 'changed', message: '朝向与物品尺寸不匹配' });
    }
    return issues;
  });
  const previewPlan = computed(() => {
    if (!state.manual || !draft.value) return null;
    const placements: Placement[] = state.manual.placements
      .filter((placement) => placement.itemId !== draft.value!.itemId)
      .map(({ locked: _locked, ...rest }) => rest);
    placements.push(draft.value.placement);
    return planFromPlacements(state.suitcase, state.items, placements, '预览');
  });
  const previewRisks = computed(() => (previewPlan.value ? detectRisks(previewPlan.value, state.suitcase, state.items) : null));

  const save = () => repository.save(clone(state) as PackingSnapshot);
  const markStale = () => { isStale.value = true; save(); };
  const stashGeometryEdit = (edit: GeometryEdit) => {
    geometryEdits.push(edit);
    if (geometryEdits.length > 20) geometryEdits.shift();
  };
  function pushHistory() {
    if (!state.manual) return;
    manualHistory.value.push(clone(state.manual));
    if (manualHistory.value.length > 50) manualHistory.value.shift();
  }

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (GEOMETRY_KEYS.some((key) => key in patch)) stashGeometryEdit({ kind: 'item', id, previous: clone(state.items[index]) });
    state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    markStale();
  }
  function removeItem(id: string) {
    state.items = state.items.filter((item) => item.id !== id);
    if (state.manual) state.manual.placements = state.manual.placements.filter((placement) => placement.itemId !== id);
    if (draft.value?.itemId === id) draft.value = null;
    markStale();
  }
  function updateSuitcase(patch: Partial<Suitcase>) {
    if (GEOMETRY_KEYS.some((key) => key in patch)) stashGeometryEdit({ kind: 'suitcase', previous: clone(state.suitcase) });
    Object.assign(state.suitcase, patch);
    markStale();
  }

  function regenerate() {
    plans.value = generatePlans(state.suitcase, state.items);
    if (state.manual) {
      if (conflicts.value.length) {
        notice.value = `存在 ${conflicts.value.length} 处锁定冲突，请先解除锁定或取消修改`;
        save();
        return;
      }
      repackUnlocked();
      return;
    }
    isStale.value = false;
    notice.value = '三套方案已重新计算';
    save();
  }
  function selectPlan(mode: PlanMode) {
    state.selectedPlan = mode;
    if (state.manual) notice.value = '手动布局生效中，重新装箱将沿用该策略';
    save();
  }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample);
    plans.value = generatePlans(state.suitcase, state.items);
    draft.value = null;
    manualHistory.value = [];
    geometryEdits.length = 0;
    isStale.value = false;
    notice.value = '已恢复登机箱示例';
    save();
  }

  function startManual() {
    if (state.manual) { notice.value = '手动布局已存在，可直接调整'; return; }
    const plan = currentPlan.value;
    state.manual = { placements: plan.placements.map((placement) => ({ ...placement, dimensions: { ...placement.dimensions }, locked: false })) };
    manualHistory.value = [];
    notice.value = `已载入「${plan.name}」：俯视图拖动移动，侧视图调整高度，确认后生效`;
    save();
  }
  function discardManual() {
    if (!state.manual) return;
    state.manual = null;
    draft.value = null;
    manualHistory.value = [];
    geometryEdits.length = 0;
    notice.value = '已放弃手动布局，恢复自动方案';
    save();
  }

  function beginDraft(itemId: string) {
    if (!state.manual) return;
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;
    const existing = state.manual.placements.find((placement) => placement.itemId === itemId);
    if (existing?.locked) { notice.value = `「${item.name}」已锁定，解除锁定后才能移动`; return; }
    draft.value = {
      itemId,
      placement: existing
        ? { itemId, x: existing.x, y: existing.y, z: existing.z, dimensions: { ...existing.dimensions } }
        : { itemId, x: 0, y: 0, z: 0, dimensions: { ...rotationsOf(item)[0] } },
    };
  }
  function updateDraft(patch: Partial<Pick<Placement, 'x' | 'y' | 'z'>>) {
    if (!draft.value) return;
    const next = { ...draft.value.placement, dimensions: { ...draft.value.placement.dimensions } };
    for (const key of ['x', 'y', 'z'] as const) {
      const value = patch[key];
      if (value !== undefined && Number.isFinite(value)) next[key] = snap(value);
    }
    draft.value = { ...draft.value, placement: next };
  }
  function rotateDraft() {
    if (!draft.value) return;
    const item = state.items.find((entry) => entry.id === draft.value!.itemId);
    if (!item) return;
    const rotations = rotationsOf(item);
    const current = rotations.findIndex((rotation) => rotation.length === draft.value!.placement.dimensions.length
      && rotation.width === draft.value!.placement.dimensions.width
      && rotation.height === draft.value!.placement.dimensions.height);
    const next = rotations[(current + 1) % rotations.length];
    draft.value = { ...draft.value, placement: { ...draft.value.placement, dimensions: { ...next } } };
  }
  function commitDraft() {
    if (!state.manual || !draft.value) return;
    if (draftIssues.value.length) { notice.value = '位置无效：越界、相交或底面缺少完整支撑时不能提交'; return; }
    pushHistory();
    const committed = { ...draft.value.placement, dimensions: { ...draft.value.placement.dimensions }, locked: false };
    state.manual = { placements: [...state.manual.placements.filter((placement) => placement.itemId !== committed.itemId), committed] };
    draft.value = null;
    notice.value = '位置已确认，风险与打印清单已更新';
    save();
  }
  function cancelDraft() { draft.value = null; }

  function toggleLock(itemId: string) {
    if (!state.manual) return;
    const target = state.manual.placements.find((placement) => placement.itemId === itemId);
    const item = state.items.find((entry) => entry.id === itemId);
    if (!target || !item) return;
    if (!target.locked) {
      const issues = stalenessIssues(state.suitcase, item, target, state.manual.placements);
      if (issues.length) { notice.value = `「${item.name}」当前位置无效，无法锁定`; return; }
    }
    pushHistory();
    target.locked = !target.locked;
    if (!target.locked && conflicts.value.length === 0) geometryEdits.length = 0;
    notice.value = target.locked ? `已锁定「${item.name}」，重新装箱不会移动它` : `已解除「${item.name}」锁定，重新装箱时将自动安排`;
    save();
  }
  function removeFromLayout(itemId: string) {
    if (!state.manual) return;
    const target = state.manual.placements.find((placement) => placement.itemId === itemId);
    if (!target) return;
    if (target.locked) { notice.value = '已锁定，请先解除锁定再取出'; return; }
    pushHistory();
    state.manual = { placements: state.manual.placements.filter((placement) => placement.itemId !== itemId) };
    if (draft.value?.itemId === itemId) draft.value = null;
    notice.value = '已取出，回到待装列表';
    save();
  }
  function repackUnlocked() {
    if (!state.manual) return;
    if (conflicts.value.length) { notice.value = `存在 ${conflicts.value.length} 处锁定冲突，请先解除锁定或取消修改`; return; }
    pushHistory();
    const locked = state.manual.placements.filter((placement) => placement.locked && state.items.some((item) => item.id === placement.itemId));
    const fixed: Placement[] = locked.map(({ locked: _locked, ...rest }) => rest);
    const plan = packItems(state.suitcase, state.items, state.selectedPlan, fixed);
    const lockedIds = new Set(locked.map((placement) => placement.itemId));
    state.manual = { placements: plan.placements.map((placement) => ({ ...placement, locked: lockedIds.has(placement.itemId) })) };
    draft.value = null;
    isStale.value = false;
    notice.value = `已重新装箱：${locked.length} 件锁定保持不动，${plan.placements.length - locked.length} 件重新安排`;
    save();
  }
  function undoManual() {
    const previous = manualHistory.value.pop();
    if (!previous || !state.manual) { notice.value = '没有可撤销的调整'; return; }
    state.manual = previous;
    draft.value = null;
    notice.value = '已撤销，完整回到调整前';
    save();
  }
  function cancelConflictingChange() {
    if (!conflicts.value.length) { notice.value = '当前没有需要取消的修改'; return; }
    let guard = 0;
    while (conflicts.value.length && geometryEdits.length && guard < 20) {
      const edit = geometryEdits.pop()!;
      if (edit.kind === 'suitcase') Object.assign(state.suitcase, clone(edit.previous));
      else {
        const index = state.items.findIndex((item) => item.id === edit.id);
        if (index >= 0) state.items[index] = clone(edit.previous);
      }
      guard += 1;
    }
    if (!conflicts.value.length) {
      geometryEdits.length = 0;
      isStale.value = true;
      notice.value = '已取消修改，恢复冲突前的尺寸';
    } else {
      notice.value = '仍有锁定冲突，请解除锁定';
    }
    save();
  }

  return {
    state, notice, isStale, plans, currentPlan, manualPlan, effectivePlan, risks, conflicts, canUndo, lockedCount,
    draft, draftIssues, previewPlan, previewRisks,
    addItem, updateItem, removeItem, updateSuitcase, regenerate, selectPlan, resetSample,
    startManual, discardManual, beginDraft, updateDraft, rotateDraft, commitDraft, cancelDraft,
    toggleLock, removeFromLayout, repackUnlocked, undoManual, cancelConflictingChange,
    print: () => printPort.print(),
  };
}
