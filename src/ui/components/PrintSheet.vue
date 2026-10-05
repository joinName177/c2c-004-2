<script setup lang="ts">
import type { PackingItem, PackingPlan, Placement, Risk, Suitcase } from '../../core/models';
const props = withDefaults(defineProps<{ suitcase: Suitcase; items: PackingItem[]; plan: PackingPlan; risks: Risk[]; locks?: Record<string, Placement> }>(), { locks: () => ({}) });
const placementOf = (id: string) => props.plan.placements.find((placement) => placement.itemId === id);
</script>

<template><section class="print-sheet"><h1>行李箱空间规划单</h1><p>{{ suitcase.length }} × {{ suitcase.width }} × {{ suitcase.height }} cm · 限重 {{ suitcase.maxWeight }} kg</p><h2>{{ plan.name }}</h2><ol><li v-for="item in items" :key="item.id">{{ placementOf(item.id) ? '□' : '×' }} {{ item.name }} — {{ item.weight }} kg<span v-if="placementOf(item.id)">（位置 {{ placementOf(item.id)!.x }}, {{ placementOf(item.id)!.y }}, {{ placementOf(item.id)!.z }} · 朝向 {{ placementOf(item.id)!.dimensions.length }}×{{ placementOf(item.id)!.dimensions.width }}×{{ placementOf(item.id)!.dimensions.height }}{{ locks[item.id] ? ' · 已锁定' : '' }}）</span></li></ol><h3>风险提示</h3><p v-for="risk in risks" :key="risk.id">{{ risk.title }}：{{ risk.message }}</p></section></template>
