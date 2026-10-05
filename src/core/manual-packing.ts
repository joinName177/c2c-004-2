import { intersects, rotationsOf } from './geometry';
import { itemVolume, suitcaseVolume, type Dimensions, type ManualLayout, type PackingItem, type PackingPlan, type Placement, type Suitcase } from './models';

const EPS = 1e-6;

export type PlacementIssueKind = 'out-of-bounds' | 'overlap' | 'unsupported' | 'changed';

export interface PlacementIssue {
  kind: PlacementIssueKind;
  message: string;
}

export interface LayoutConflict {
  itemId: string;
  itemName: string;
  issues: PlacementIssue[];
}

function sameDimensions(a: Dimensions, b: Dimensions): boolean {
  return a.length === b.length && a.width === b.width && a.height === b.height;
}

export function isRotationOfItem(item: PackingItem, dimensions: Dimensions): boolean {
  return rotationsOf(item).some((rotation) => sameDimensions(rotation, dimensions));
}

/** 底面是否被地面或其他物品的顶面完整覆盖。 */
export function bottomSupported(placement: Placement, others: Placement[]): boolean {
  if (placement.z <= EPS) return true;
  const x0 = placement.x;
  const y0 = placement.y;
  const x1 = x0 + placement.dimensions.length;
  const y1 = y0 + placement.dimensions.width;
  const clips = others
    .filter((other) => other.itemId !== placement.itemId && Math.abs(other.z + other.dimensions.height - placement.z) <= EPS)
    .map((other) => ({
      x0: Math.max(x0, other.x),
      y0: Math.max(y0, other.y),
      x1: Math.min(x1, other.x + other.dimensions.length),
      y1: Math.min(y1, other.y + other.dimensions.width),
    }))
    .filter((clip) => clip.x1 - clip.x0 > EPS && clip.y1 - clip.y0 > EPS);
  if (!clips.length) return false;
  const uniqueSorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const xs = uniqueSorted([x0, x1, ...clips.flatMap((clip) => [clip.x0, clip.x1])]);
  const ys = uniqueSorted([y0, y1, ...clips.flatMap((clip) => [clip.y0, clip.y1])]);
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const covered = clips.some((clip) => cx > clip.x0 - EPS && cx < clip.x1 + EPS && cy > clip.y0 - EPS && cy < clip.y1 + EPS);
      if (!covered) return false;
    }
  }
  return true;
}

/** 校验单个摆放：越界、相交，以及（可选）底面完整支撑。 */
export function placementIssues(suitcase: Suitcase, placement: Placement, others: Placement[], options: { support?: boolean } = {}): PlacementIssue[] {
  const checkSupport = options.support ?? true;
  const issues: PlacementIssue[] = [];
  const d = placement.dimensions;
  const outOfBounds = placement.x < -EPS || placement.y < -EPS || placement.z < -EPS
    || placement.x + d.length > suitcase.length + EPS
    || placement.y + d.width > suitcase.width + EPS
    || placement.z + d.height > suitcase.height + EPS;
  if (outOfBounds) issues.push({ kind: 'out-of-bounds', message: '超出箱体边界' });
  const rest = others.filter((other) => other.itemId !== placement.itemId);
  if (rest.some((other) => intersects(placement, other))) issues.push({ kind: 'overlap', message: '与其他物品相交' });
  if (checkSupport && !bottomSupported(placement, rest)) issues.push({ kind: 'unsupported', message: '底面缺少完整支撑' });
  return issues;
}

/**
 * 尺寸修改导致的失效检查：越界、相交或朝向不再匹配。
 * 不检查底面支撑——自动装箱引擎本身不保证支撑，失效只由箱体/物品尺寸修改触发。
 */
export function stalenessIssues(suitcase: Suitcase, item: PackingItem, placement: Placement, others: Placement[]): PlacementIssue[] {
  const issues = placementIssues(suitcase, placement, others, { support: false });
  if (!isRotationOfItem(item, placement.dimensions)) {
    issues.unshift({ kind: 'changed', message: '物品尺寸已修改，原朝向失效' });
  }
  return issues;
}

/** 锁定摆放在箱体或物品尺寸修改后是否仍然有效；返回失效冲突列表。 */
export function findLayoutConflicts(suitcase: Suitcase, items: PackingItem[], layout: ManualLayout): LayoutConflict[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const conflicts: LayoutConflict[] = [];
  for (const placement of layout.placements) {
    if (!placement.locked) continue;
    const item = byId.get(placement.itemId);
    if (!item) continue;
    const others = layout.placements.filter((other) => other.itemId !== placement.itemId);
    const issues = stalenessIssues(suitcase, item, placement, others);
    if (issues.length) conflicts.push({ itemId: item.id, itemName: item.name, issues });
  }
  return conflicts;
}

function totals(placements: Placement[], byId: Map<string, PackingItem>) {
  const totalWeight = placements.reduce((sum, p) => sum + (byId.get(p.itemId)?.weight ?? 0), 0);
  const usedVolume = placements.reduce((sum, p) => sum + itemVolume(p.dimensions), 0);
  return { totalWeight, usedVolume };
}

/** 不做合法性过滤，直接由摆放列表生成计划（用于预览）。 */
export function planFromPlacements(suitcase: Suitcase, items: PackingItem[], placements: Placement[], name: string): PackingPlan {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placedIds = new Set(placements.map((p) => p.itemId));
  const unplaced = items.filter((item) => !placedIds.has(item.id)).map((item) => ({ item, reason: '尚未安排' }));
  const { totalWeight, usedVolume } = totals(placements, byId);
  return { id: 'manual', name, placements, unplaced, totalWeight, usedVolume, capacityRatio: suitcaseVolume(suitcase) ? usedVolume / suitcaseVolume(suitcase) : 0 };
}

/**
 * 由手动布局生成当前生效计划：锁定摆放永远保留在原位；
 * 未锁定但已失效（箱体/物品修改导致）的摆放自动回到待装列表，等待重新装箱。
 */
export function buildManualPlan(suitcase: Suitcase, items: PackingItem[], layout: ManualLayout): PackingPlan {
  const byId = new Map(items.map((item) => [item.id, item]));
  const alive = layout.placements.filter((p) => byId.has(p.itemId));
  const placements: Placement[] = [];
  const unplaced: PackingPlan['unplaced'] = [];
  for (const placement of alive) {
    const item = byId.get(placement.itemId)!;
    if (!placement.locked && stalenessIssues(suitcase, item, placement, alive).length > 0) {
      unplaced.push({ item, reason: '原位置已失效，待重新装箱' });
    } else {
      placements.push(placement);
    }
  }
  const placedIds = new Set(placements.map((p) => p.itemId));
  for (const item of items) {
    if (!placedIds.has(item.id) && !unplaced.some((entry) => entry.item.id === item.id)) {
      unplaced.push({ item, reason: '尚未安排，可在工作台放入' });
    }
  }
  const { totalWeight, usedVolume } = totals(placements, byId);
  return { id: 'manual', name: '手动调整', placements, unplaced, totalWeight, usedVolume, capacityRatio: suitcaseVolume(suitcase) ? usedVolume / suitcaseVolume(suitcase) : 0 };
}
