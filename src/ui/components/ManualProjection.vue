<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ManualPlacement, PackingItem, Placement, Suitcase } from '../../core/models';

const props = defineProps<{
  view: 'top' | 'side';
  suitcase: Suitcase;
  items: PackingItem[];
  placements: ManualPlacement[];
  draft: { itemId: string; placement: Placement } | null;
  draftValid: boolean;
  selectedId: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  dragto: [id: string, patch: { x?: number; y?: number; z?: number }];
  dragend: [];
}>();

const colors = ['#df6d45', '#507d68', '#d8a84e', '#5978a7', '#9d6a83', '#6d7d86'];
const SNAP = 0.5;
const itemIndex = computed(() => new Map(props.items.map((item, index) => [item.id, index])));
const visiblePlacements = computed(() => props.placements.filter((placement) => placement.itemId !== props.draft?.itemId));

const snap = (value: number) => Math.round(value / SNAP) * SNAP;

function rectFor(placement: Placement) {
  const d = placement.dimensions;
  const left = `${(placement.x / props.suitcase.length) * 100}%`;
  const width = `${(d.length / props.suitcase.length) * 100}%`;
  if (props.view === 'top') {
    return { left, width, top: `${(placement.y / props.suitcase.width) * 100}%`, height: `${(d.width / props.suitcase.width) * 100}%` };
  }
  return { left, width, top: `${(1 - (placement.z + d.height) / props.suitcase.height) * 100}%`, height: `${(d.height / props.suitcase.height) * 100}%` };
}
function styleFor(placement: Placement) {
  return { ...rectFor(placement), background: colors[(itemIndex.value.get(placement.itemId) ?? 0) % colors.length] };
}
function labelOf(itemId: string) {
  return (itemIndex.value.get(itemId) ?? 0) + 1;
}

const container = ref<HTMLElement | null>(null);
let dragState: { id: string; startX: number; startY: number; origin: Placement } | null = null;

function onPointerDown(event: PointerEvent, placement: ManualPlacement) {
  emit('select', placement.itemId);
  if (placement.locked) return;
  dragState = { id: placement.itemId, startX: event.clientX, startY: event.clientY, origin: { ...placement, dimensions: { ...placement.dimensions } } };
  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
}
function onPointerMove(event: PointerEvent) {
  if (!dragState || !container.value) return;
  const rect = container.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dx = ((event.clientX - dragState.startX) / rect.width) * props.suitcase.length;
  const dyPx = event.clientY - dragState.startY;
  const patch: { x?: number; y?: number; z?: number } = { x: snap(dragState.origin.x + dx) };
  if (props.view === 'top') patch.y = snap(dragState.origin.y + (dyPx / rect.height) * props.suitcase.width);
  else patch.z = snap(dragState.origin.z - (dyPx / rect.height) * props.suitcase.height);
  emit('dragto', dragState.id, patch);
}
function onPointerUp() {
  if (!dragState) return;
  dragState = null;
  emit('dragend');
}
</script>

<template>
  <div class="projection-card">
    <header><span>{{ view === 'top' ? 'TOP VIEW · 拖动移动' : 'SIDE VIEW · 拖动调高' }}</span><b>{{ view === 'top' ? '俯视图' : '侧视图' }}</b></header>
    <div ref="container" class="projection manual" :class="view" :data-view="view" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
      <button
        v-for="placement in visiblePlacements"
        :key="placement.itemId"
        type="button"
        class="mp-item"
        :class="{ locked: placement.locked, selected: placement.itemId === selectedId }"
        :data-item-id="placement.itemId"
        :style="styleFor(placement)"
        @pointerdown="onPointerDown($event, placement)"
      ><span>{{ labelOf(placement.itemId) }}{{ placement.locked ? ' 🔒' : '' }}</span></button>
      <div v-if="draft" class="mp-ghost" :class="{ invalid: !draftValid }" data-testid="draft-ghost" :style="styleFor(draft.placement)"></div>
    </div>
  </div>
</template>
