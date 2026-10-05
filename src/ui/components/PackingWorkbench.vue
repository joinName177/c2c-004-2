<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { VIOLATION_LABELS } from '../../core/manual';
import type { Placement } from '../../core/models';
import type { usePlanner } from '../usePlanner';

type Planner = ReturnType<typeof usePlanner>;

const props = defineProps<{ planner: Planner; selectedId: string }>();
const emit = defineEmits<{ select: [id: string] }>();

const colors = ['#df6d45', '#507d68', '#d8a84e', '#5978a7', '#9d6a83', '#6d7d86'];
const itemIndex = computed(() => new Map(props.planner.state.items.map((item, index) => [item.id, index])));
const itemName = (id: string) => props.planner.state.items.find((item) => item.id === id)?.name ?? id;

const selectedItem = computed(() => props.planner.state.items.find((item) => item.id === props.selectedId));
const selectedLocked = computed(() => Boolean(props.planner.state.workbench.locks[props.selectedId]));
const preview = computed(() => props.planner.preview.value);
const conflicts = computed(() => props.planner.conflicts.value.map((conflict) => ({
  itemId: conflict.itemId,
  text: conflict.reasons.map((reason) => VIOLATION_LABELS[reason]).join('、'),
})));

function styleFor(placement: Placement, view: 'top' | 'side') {
  const suitcase = props.planner.state.suitcase;
  const maxY = view === 'top' ? suitcase.width : suitcase.height;
  return {
    left: `${placement.x / suitcase.length * 100}%`,
    top: `${(view === 'top' ? placement.y : placement.z) / maxY * 100}%`,
    width: `${placement.dimensions.length / suitcase.length * 100}%`,
    height: `${(view === 'top' ? placement.dimensions.width : placement.dimensions.height) / maxY * 100}%`,
    background: colors[(itemIndex.value.get(placement.itemId) ?? 0) % colors.length],
  };
}

// --- 拖拽：俯视图移动 x/y，侧视图调整 z；松手后保持预览，等待确认 ---
interface DragState { itemId: string; view: 'top' | 'side'; startX: number; startY: number; origin: Placement; rect: DOMRect }
const drag = ref<DragState | null>(null);
const snap = (value: number) => Math.round(value * 2) / 2;

function onPointerDown(itemId: string, view: 'top' | 'side', event: PointerEvent) {
  emit('select', itemId);
  const origin = props.planner.currentPlan.value.placements.find((placement) => placement.itemId === itemId);
  const container = (event.currentTarget as HTMLElement).closest('.projection');
  if (!origin || !container) return;
  drag.value = { itemId, view, startX: event.clientX, startY: event.clientY, origin: JSON.parse(JSON.stringify(origin)) as Placement, rect: container.getBoundingClientRect() };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(event: PointerEvent) {
  const current = drag.value;
  if (!current || current.rect.width <= 0 || current.rect.height <= 0) return;
  const suitcase = props.planner.state.suitcase;
  const dx = event.clientX - current.startX;
  const dy = event.clientY - current.startY;
  if (current.view === 'top') {
    props.planner.updatePreview(current.itemId, {
      x: snap(current.origin.x + dx * suitcase.length / current.rect.width),
      y: snap(current.origin.y + dy * suitcase.width / current.rect.height),
    });
  } else {
    props.planner.updatePreview(current.itemId, { z: snap(current.origin.z - dy * suitcase.height / current.rect.height) });
  }
}

function onPointerUp() {
  drag.value = null;
  window.removeEventListener('pointermove', onPointerMove);
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    props.planner.undo();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="workbench" data-testid="workbench">
    <div v-if="conflicts.length" class="conflict-banner" data-testid="conflict-banner">
      <strong>⚠ 锁定位置与最新尺寸冲突 — 已保留上次有效摆放</strong>
      <ul>
        <li v-for="conflict in conflicts" :key="conflict.itemId">
          <span>{{ itemName(conflict.itemId) }}：{{ conflict.text }}</span>
          <button type="button" :data-testid="`resolve-unlock-${conflict.itemId}`" @click="planner.resolveConflictByUnlock(conflict.itemId)">解除锁定</button>
        </li>
      </ul>
      <button type="button" class="cancel-change" data-testid="cancel-pending-change" :disabled="!planner.state.workbench.pendingRevert" @click="planner.cancelPendingChange">取消修改，恢复原尺寸</button>
    </div>
    <div class="workbench-toolbar">
      <span class="selection">{{ selectedItem ? `选中：${selectedItem.name}${selectedLocked ? '（已锁定）' : ''}` : '点击物品开始手动调整' }}</span>
      <div class="tool-group">
        <button type="button" data-testid="rotate-button" :disabled="!selectedItem" @click="planner.rotateItem(selectedId)">旋转</button>
        <button type="button" data-testid="lock-toggle" :class="{ active: selectedLocked }" :disabled="!selectedItem" @click="planner.toggleLock(selectedId)">{{ selectedLocked ? '解除锁定' : '锁定位置' }}</button>
        <button type="button" data-testid="undo-button" :disabled="!planner.canUndo.value" @click="planner.undo()">撤销</button>
      </div>
      <div v-if="preview" class="preview-group">
        <span class="violations" :class="{ ok: !planner.previewViolations.value.length }">{{ planner.previewViolations.value.length ? planner.previewLabels.value.join('；') : '位置有效，可提交' }}</span>
        <button type="button" class="commit" data-testid="commit-preview" :disabled="planner.previewViolations.value.length > 0" @click="planner.commitPreview()">确认移动</button>
        <button type="button" data-testid="cancel-preview" @click="planner.cancelPreview()">取消</button>
      </div>
    </div>
    <div class="projections">
      <div v-for="view in (['top', 'side'] as const)" :key="view" class="projection-card">
        <header><span>{{ view === 'top' ? 'TOP VIEW' : 'SIDE VIEW' }}</span><b>{{ view === 'top' ? '俯视图 · 拖动移动' : '侧视图 · 拖动调高' }}</b></header>
        <div class="projection" :class="view">
          <button v-for="(placement, index) in planner.currentPlan.value.placements" :key="placement.itemId" type="button"
            :data-item-id="placement.itemId"
            :class="{
              selected: placement.itemId === selectedId,
              locked: Boolean(planner.state.workbench.locks[placement.itemId]),
              preview: preview?.itemId === placement.itemId,
              invalid: preview?.itemId === placement.itemId && planner.previewViolations.value.length > 0,
            }"
            :style="styleFor(placement, view)"
            @click="emit('select', placement.itemId)"
            @pointerdown="onPointerDown(placement.itemId, view, $event)">
            <span>{{ index + 1 }}</span>
            <i v-if="planner.state.workbench.locks[placement.itemId]" class="lock-badge">🔒</i>
          </button>
        </div>
      </div>
    </div>
    <p class="canvas-note">俯视图拖动调整水平位置，侧视图拖动调整高度；移动先预览，越界、相交或底面无完整支撑时无法提交。锁定后重新装箱不会移动该物品，Ctrl/⌘+Z 可撤销。</p>
  </div>
</template>
