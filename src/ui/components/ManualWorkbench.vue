<script setup lang="ts">
import { computed, ref } from 'vue';
import type { usePlanner } from '../usePlanner';
import ManualProjection from './ManualProjection.vue';

type Planner = ReturnType<typeof usePlanner>;

const props = defineProps<{ planner: Planner }>();

const selectedId = ref('');
const manual = computed(() => props.planner.state.manual);
const manualPlan = computed(() => props.planner.manualPlan.value);
const draft = computed(() => props.planner.draft.value);
const draftIssues = computed(() => props.planner.draftIssues.value);
const conflicts = computed(() => props.planner.conflicts.value);
const previewRisks = computed(() => props.planner.previewRisks.value);
const canUndo = computed(() => props.planner.canUndo.value);
const lockedCount = computed(() => props.planner.lockedCount.value);
const planName = computed(() => props.planner.currentPlan.value.name);
const draftItem = computed(() => props.planner.state.items.find((item) => item.id === draft.value?.itemId));
const riskPreview = computed(() => (previewRisks.value ?? []).filter((risk) => risk.severity !== 'info'));

function itemName(itemId: string) {
  return props.planner.state.items.find((item) => item.id === itemId)?.name ?? itemId;
}
function onSelect(itemId: string) {
  selectedId.value = itemId;
  props.planner.beginDraft(itemId);
}
function patchFor(axis: 'x' | 'y' | 'z', value: number) {
  return axis === 'x' ? { x: value } : axis === 'y' ? { y: value } : { z: value };
}
function nudge(axis: 'x' | 'y' | 'z', delta: number) {
  const placement = draft.value?.placement;
  if (!placement) return;
  props.planner.updateDraft(patchFor(axis, placement[axis] + delta));
}
function onAxisInput(axis: 'x' | 'y' | 'z', event: Event) {
  props.planner.updateDraft(patchFor(axis, Number((event.target as HTMLInputElement).value)));
}
</script>

<template>
  <section class="panel workbench" data-testid="manual-workbench">
    <div class="section-title">
      <div><span>04 / MANUAL STUDIO</span><h2>手动装箱工作台</h2></div>
      <b v-if="manual">{{ lockedCount }} 件已锁定</b>
    </div>

    <div v-if="!manual" class="wb-empty">
      <p>自动方案的方向和位置不一定符合拿取习惯。载入当前方案后，可在俯视图拖动物品、侧视图调整高度、旋转查看另一视图与风险变化，并锁定满意的位置；重新装箱只安排未锁定的物品。</p>
      <button type="button" data-testid="start-manual" @click="planner.startManual">载入「{{ planName }}」开始手动调整</button>
    </div>

    <template v-else>
      <div v-if="conflicts.length" class="conflict-banner" data-testid="conflict-banner">
        <strong>尺寸修改导致 {{ conflicts.length }} 处锁定位置失效</strong>
        <p>已保留上次有效摆放。请解除锁定，或取消修改恢复原尺寸。</p>
        <ul>
          <li v-for="conflict in conflicts" :key="conflict.itemId">
            <span>{{ conflict.itemName }}：{{ conflict.issues.map((issue) => issue.message).join('、') }}</span>
            <button type="button" :data-testid="`unlock-${conflict.itemId}`" @click="planner.toggleLock(conflict.itemId)">解除锁定</button>
          </li>
        </ul>
        <button type="button" data-testid="cancel-change" @click="planner.cancelConflictingChange">取消修改</button>
      </div>

      <div class="wb-toolbar">
        <button type="button" class="primary" data-testid="repack-unlocked" :disabled="conflicts.length > 0" @click="planner.repackUnlocked">重新装箱（保留 {{ lockedCount }} 件锁定）</button>
        <button type="button" data-testid="undo-manual" :disabled="!canUndo" @click="planner.undoManual">撤销</button>
        <button type="button" data-testid="discard-manual" @click="planner.discardManual">恢复自动方案</button>
      </div>

      <div class="wb-projections">
        <ManualProjection view="top" :suitcase="planner.state.suitcase" :items="planner.state.items" :placements="manual.placements" :draft="draft" :draft-valid="draftIssues.length === 0" :selected-id="selectedId" @select="onSelect" @dragto="(_id, patch) => planner.updateDraft(patch)" />
        <ManualProjection view="side" :suitcase="planner.state.suitcase" :items="planner.state.items" :placements="manual.placements" :draft="draft" :draft-valid="draftIssues.length === 0" :selected-id="selectedId" @select="onSelect" @dragto="(_id, patch) => planner.updateDraft(patch)" />
      </div>
      <p class="canvas-note">移动先显示预览：越界、相交或底面没有完整支撑时不能提交。坐标以箱体左下后角为原点。</p>

      <div v-if="draft && draftItem" class="draft-panel" data-testid="draft-panel">
        <strong>调整中：{{ draftItem.name }}</strong>
        <div class="draft-grid">
          <label>左右 X (cm)<input data-testid="draft-x" type="number" step="0.5" :value="draft.placement.x" @input="onAxisInput('x', $event)" /></label>
          <label>前后 Y (cm)<input data-testid="draft-y" type="number" step="0.5" :value="draft.placement.y" @input="onAxisInput('y', $event)" /></label>
          <label>高度 Z (cm)<input data-testid="draft-z" type="number" step="0.5" :value="draft.placement.z" @input="onAxisInput('z', $event)" /></label>
        </div>
        <div class="draft-nudge">
          <button type="button" data-testid="nudge-x-minus" @click="nudge('x', -1)">← 左移</button>
          <button type="button" data-testid="nudge-x-plus" @click="nudge('x', 1)">右移 →</button>
          <button type="button" data-testid="nudge-y-minus" @click="nudge('y', -1)">↑ 前移</button>
          <button type="button" data-testid="nudge-y-plus" @click="nudge('y', 1)">后移 ↓</button>
          <button type="button" data-testid="nudge-z-plus" @click="nudge('z', 1)">抬高</button>
          <button type="button" data-testid="nudge-z-minus" @click="nudge('z', -1)">降低</button>
          <button type="button" data-testid="rotate-draft" @click="planner.rotateDraft">旋转 90°</button>
        </div>
        <p class="draft-orientation">朝向：长 {{ draft.placement.dimensions.length }} × 宽 {{ draft.placement.dimensions.width }} × 高 {{ draft.placement.dimensions.height }} cm</p>
        <ul v-if="draftIssues.length" class="draft-issues" data-testid="draft-issues">
          <li v-for="issue in draftIssues" :key="issue.kind">{{ issue.message }}</li>
        </ul>
        <p v-else class="draft-ok">位置有效，可以确认</p>
        <div v-if="previewRisks" class="draft-risks" data-testid="draft-risks">
          风险预览：<b v-if="!riskPreview.length">无明显风险</b><span v-for="risk in riskPreview" :key="risk.id">{{ risk.title }}</span>
        </div>
        <div class="draft-actions">
          <button type="button" class="primary" data-testid="commit-draft" :disabled="draftIssues.length > 0" @click="planner.commitDraft">确认位置</button>
          <button type="button" data-testid="cancel-draft" @click="planner.cancelDraft">取消</button>
        </div>
      </div>

      <div class="wb-items">
        <div class="wb-chip-list" data-testid="placed-chips">
          <span v-for="placement in manual.placements" :key="placement.itemId" class="wb-chip" :class="{ locked: placement.locked }">
            <button type="button" class="chip-name" :data-testid="`select-${placement.itemId}`" @click="onSelect(placement.itemId)">{{ itemName(placement.itemId) }}</button>
            <button type="button" class="chip-lock" :data-testid="`lock-${placement.itemId}`" :aria-label="`${placement.locked ? '解锁' : '锁定'} ${itemName(placement.itemId)}`" @click="planner.toggleLock(placement.itemId)">{{ placement.locked ? '🔒' : '🔓' }}</button>
            <button v-if="!placement.locked" type="button" class="chip-remove" :data-testid="`remove-${placement.itemId}`" :aria-label="`取出 ${itemName(placement.itemId)}`" @click="planner.removeFromLayout(placement.itemId)">×</button>
          </span>
        </div>
        <div v-if="manualPlan && manualPlan.unplaced.length" class="wb-unplaced" data-testid="unplaced-list">
          <span>待装：</span>
          <span v-for="entry in manualPlan.unplaced" :key="entry.item.id" class="wb-chip unplaced">
            {{ entry.item.name }}<em>{{ entry.reason }}</em>
            <button type="button" :data-testid="`place-${entry.item.id}`" @click="onSelect(entry.item.id)">放入</button>
          </span>
        </div>
      </div>
    </template>
  </section>
</template>
