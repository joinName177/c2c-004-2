export type Dimensions = Readonly<{ length: number; width: number; height: number }>;
export type PlanMode = 'minimal' | 'comfort' | 'shopping';
export type RiskSeverity = 'critical' | 'warning' | 'info';

export interface Suitcase extends Dimensions {
  maxWeight: number;
}

export interface PackingItem extends Dimensions {
  id: string;
  name: string;
  category: string;
  weight: number;
  priority: 1 | 2 | 3;
  mustHave: boolean;
  fragile?: boolean;
}

export interface Placement {
  itemId: string;
  x: number;
  y: number;
  z: number;
  dimensions: Dimensions;
}

export interface PackingPlan {
  id: PlanMode;
  name: string;
  placements: Placement[];
  unplaced: Array<{ item: PackingItem; reason: string }>;
  totalWeight: number;
  usedVolume: number;
  capacityRatio: number;
}

export interface Risk {
  id: string;
  severity: RiskSeverity;
  title: string;
  message: string;
  itemId?: string;
}

export type PlacementViolation = 'out-of-bounds' | 'intersection' | 'unsupported' | 'dimensions-changed';

export interface LockConflict {
  itemId: string;
  reasons: PlacementViolation[];
}

export interface WorkbenchState {
  /** 锁定物品及其固定摆放，重新装箱时保持不动 */
  locks: Record<string, Placement>;
  /** 各方案下手动调整后的完整摆放（未调整的方案沿用自动结果） */
  overrides: Partial<Record<PlanMode, Placement[]>>;
  /** 导致锁定冲突的修改前箱体与物品，用于“取消修改”恢复原尺寸 */
  pendingRevert: { suitcase: Suitcase; items: PackingItem[] } | null;
}

export interface PackingSnapshot {
  suitcase: Suitcase;
  items: PackingItem[];
  selectedPlan: PlanMode;
  workbench: WorkbenchState;
}

export function itemVolume(item: Dimensions): number {
  return item.length * item.width * item.height;
}

export function suitcaseVolume(suitcase: Dimensions): number {
  return suitcase.length * suitcase.width * suitcase.height;
}
