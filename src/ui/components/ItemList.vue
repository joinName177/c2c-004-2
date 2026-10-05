<script setup lang="ts">
import type { PackingItem } from '../../core/models';
defineProps<{ items: PackingItem[] }>();
const emit = defineEmits<{ remove: [id: string]; toggle: [id: string, mustHave: boolean]; resize: [id: string, dims: { length: number; width: number; height: number }] }>();
function onResize(item: PackingItem, key: 'length' | 'width' | 'height', event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit('resize', item.id, { length: item.length, width: item.width, height: item.height, [key]: value });
}
</script>

<template>
  <div class="item-list">
    <article v-for="item in items" :key="item.id" class="item-row">
      <div class="item-icon">{{ item.category.slice(0, 1) }}</div>
      <div class="item-copy"><strong>{{ item.name }}</strong><span>{{ item.length }}×{{ item.width }}×{{ item.height }} cm · {{ item.weight }} kg</span></div>
      <div class="dims-editor">
        <input type="number" min="1" :aria-label="`${item.name} 长度`" :value="item.length" @change="onResize(item, 'length', $event)" />
        <input type="number" min="1" :aria-label="`${item.name} 宽度`" :value="item.width" @change="onResize(item, 'width', $event)" />
        <input type="number" min="1" :aria-label="`${item.name} 高度`" :value="item.height" @change="onResize(item, 'height', $event)" />
      </div>
      <button class="must-button" :class="{ checked: item.mustHave }" type="button" @click="emit('toggle', item.id, !item.mustHave)">{{ item.mustHave ? '必带' : '可选' }}</button>
      <b class="priority">P{{ item.priority }}</b>
      <button class="icon-button" type="button" :aria-label="`删除 ${item.name}`" @click="emit('remove', item.id)">×</button>
    </article>
  </div>
</template>
