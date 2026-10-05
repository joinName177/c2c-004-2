import { packWithLocks } from './packing-engine';
import type { PackingItem, PackingPlan, Placement, PlanMode, Suitcase } from './models';

export function generatePlans(suitcase: Suitcase, items: PackingItem[], locks: Record<string, Placement> = {}): Record<PlanMode, PackingPlan> {
  return {
    minimal: packWithLocks(suitcase, items, 'minimal', locks),
    comfort: packWithLocks(suitcase, items, 'comfort', locks),
    shopping: packWithLocks(suitcase, items, 'shopping', locks),
  };
}
