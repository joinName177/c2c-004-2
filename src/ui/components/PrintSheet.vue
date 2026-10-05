<script setup lang="ts">
import { computed } from 'vue';
import type { PackingItem, PackingPlan, Placement, Risk, Suitcase } from '../../core/models';
const props = defineProps<{ suitcase: Suitcase; items: PackingItem[]; plan: PackingPlan; risks: Risk[] }>();
const placementOf = computed(() => new Map(props.plan.placements.map((placement) => [placement.itemId, placement])));
function formatPlacement(placement: Placement) {
  const d = placement.dimensions;
  return `位置 (${placement.x}, ${placement.y}, ${placement.z}) · 朝向 ${d.length}×${d.width}×${d.height} cm`;
}
</script>

<template><section class="print-sheet"><h1>行李箱空间规划单</h1><p>{{ suitcase.length }} × {{ suitcase.width }} × {{ suitcase.height }} cm · 限重 {{ suitcase.maxWeight }} kg</p><h2>{{ plan.name }}</h2><ol><li v-for="item in items" :key="item.id">{{ placementOf.get(item.id) ? '□' : '×' }} {{ item.name }} — {{ item.weight }} kg<span v-if="placementOf.get(item.id)"> · {{ formatPlacement(placementOf.get(item.id)!) }}</span></li></ol><h3>风险提示</h3><p v-for="risk in risks" :key="risk.id">{{ risk.title }}：{{ risk.message }}</p></section></template>
