import { intersects, rotationsOf } from './geometry';
import { itemVolume, suitcaseVolume, type LockConflict, type PackingItem, type PackingPlan, type Placement, type PlacementViolation, type Suitcase, type WorkbenchState } from './models';

const EPSILON = 1e-6;
const SUPPORT_TOLERANCE = 1e-4;

export const VIOLATION_LABELS: Record<PlacementViolation, string> = {
  'out-of-bounds': '超出箱体边界',
  intersection: '与其他物品相交',
  unsupported: '底面缺少完整支撑',
  'dimensions-changed': '物品尺寸已变化，原位置失效',
};

export function emptyWorkbench(): WorkbenchState {
  return { locks: {}, overrides: {}, pendingRevert: null };
}

export function normalizeWorkbench(value: Partial<WorkbenchState> | undefined): WorkbenchState {
  return { locks: value?.locks ?? {}, overrides: value?.overrides ?? {}, pendingRevert: value?.pendingRevert ?? null };
}

/** 底面支撑比例：贴地为 1，否则统计顶面与 z 对齐的其他物品覆盖的 footprint 面积比 */
export function supportRatio(placement: Placement, others: Placement[]): number {
  if (placement.z <= EPSILON) return 1;
  const base = placement.dimensions.length * placement.dimensions.width;
  if (base <= 0) return 0;
  let covered = 0;
  for (const other of others) {
    if (other.itemId === placement.itemId) continue;
    if (Math.abs(other.z + other.dimensions.height - placement.z) > EPSILON) continue;
    const overlapX = Math.min(placement.x + placement.dimensions.length, other.x + other.dimensions.length) - Math.max(placement.x, other.x);
    const overlapY = Math.min(placement.y + placement.dimensions.width, other.y + other.dimensions.width) - Math.max(placement.y, other.y);
    if (overlapX > 0 && overlapY > 0) covered += overlapX * overlapY;
  }
  return Math.min(1, covered / base);
}

/** 手动提交的摆放必须：不越界、不相交、底面被完整支撑 */
export function validatePlacement(candidate: Placement, others: Placement[], suitcase: Suitcase): PlacementViolation[] {
  const violations: PlacementViolation[] = [];
  const d = candidate.dimensions;
  if (candidate.x < -EPSILON || candidate.y < -EPSILON || candidate.z < -EPSILON
    || candidate.x + d.length > suitcase.length + EPSILON
    || candidate.y + d.width > suitcase.width + EPSILON
    || candidate.z + d.height > suitcase.height + EPSILON) violations.push('out-of-bounds');
  const neighbors = others.filter((other) => other.itemId !== candidate.itemId);
  if (neighbors.some((other) => intersects(candidate, other))) violations.push('intersection');
  else if (supportRatio(candidate, neighbors) < 1 - SUPPORT_TOLERANCE) violations.push('unsupported');
  return violations;
}

/** 箱体或物品尺寸变化后，校验锁定位置是否仍然成立（只与其余锁定物品比较，未锁定物品会被重新安排） */
export function validateLocks(locks: Record<string, Placement>, suitcase: Suitcase, items: PackingItem[]): LockConflict[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const locked = Object.values(locks);
  const conflicts: LockConflict[] = [];
  for (const [itemId, placement] of Object.entries(locks)) {
    const item = byId.get(itemId);
    if (!item) continue;
    const reasons = new Set<PlacementViolation>();
    const dimsValid = rotationsOf(item).some((d) => d.length === placement.dimensions.length
      && d.width === placement.dimensions.width && d.height === placement.dimensions.height);
    if (!dimsValid) reasons.add('dimensions-changed');
    for (const violation of validatePlacement(placement, locked, suitcase)) reasons.add(violation);
    if (reasons.size) conflicts.push({ itemId, reasons: [...reasons] });
  }
  return conflicts;
}

/** 用手动摆放重算方案指标，保持重量、体积、未装清单与视图一致 */
export function recalculatePlan(base: PackingPlan, placements: Placement[], items: PackingItem[], suitcase: Suitcase): PackingPlan {
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept = placements.filter((placement) => byId.has(placement.itemId));
  const placedIds = new Set(kept.map((placement) => placement.itemId));
  const baseReasons = new Map(base.unplaced.map((entry) => [entry.item.id, entry.reason]));
  let totalWeight = 0;
  let usedVolume = 0;
  for (const placement of kept) {
    totalWeight += byId.get(placement.itemId)!.weight;
    usedVolume += itemVolume(placement.dimensions);
  }
  const unplaced = items
    .filter((item) => !placedIds.has(item.id))
    .map((item) => ({ item, reason: baseReasons.get(item.id) ?? '未装入当前摆放，可重新装箱' }));
  const capacity = suitcaseVolume(suitcase);
  return { ...base, placements: kept, unplaced, totalWeight, usedVolume, capacityRatio: capacity ? usedVolume / capacity : 0 };
}
