<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { PackingItem } from '../../core/models';
defineProps<{ items: PackingItem[] }>();
const emit = defineEmits<{ remove: [id: string]; toggle: [id: string, mustHave: boolean]; update: [id: string, patch: Partial<PackingItem>] }>();
const editingId = ref('');
const dims = reactive({ length: 0, width: 0, height: 0 });
function startEdit(item: PackingItem) {
  editingId.value = editingId.value === item.id ? '' : item.id;
  Object.assign(dims, { length: item.length, width: item.width, height: item.height });
}
function saveEdit(id: string) {
  emit('update', id, { length: Number(dims.length), width: Number(dims.width), height: Number(dims.height) });
  editingId.value = '';
}
</script>

<template>
  <div class="item-list">
    <article v-for="item in items" :key="item.id" class="item-row">
      <div class="item-icon">{{ item.category.slice(0, 1) }}</div>
      <div class="item-copy"><strong>{{ item.name }}</strong><span>{{ item.length }}×{{ item.width }}×{{ item.height }} cm · {{ item.weight }} kg</span></div>
      <button class="must-button" :class="{ checked: item.mustHave }" type="button" @click="emit('toggle', item.id, !item.mustHave)">{{ item.mustHave ? '必带' : '可选' }}</button>
      <b class="priority">P{{ item.priority }}</b>
      <button class="icon-button" type="button" :aria-label="`编辑 ${item.name}`" @click="startEdit(item)">✎</button>
      <button class="icon-button" type="button" :aria-label="`删除 ${item.name}`" @click="emit('remove', item.id)">×</button>
      <div v-if="editingId === item.id" class="item-dim-editor">
        <label>长<input aria-label="编辑长度" type="number" min="1" step="0.5" v-model="dims.length" /></label>
        <label>宽<input aria-label="编辑宽度" type="number" min="1" step="0.5" v-model="dims.width" /></label>
        <label>高<input aria-label="编辑高度" type="number" min="1" step="0.5" v-model="dims.height" /></label>
        <button type="button" data-testid="save-dims" @click="saveEdit(item.id)">保存尺寸</button>
      </div>
    </article>
  </div>
</template>
