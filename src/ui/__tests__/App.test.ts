import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import { LocalPlannerRepository } from '../../adapters/local-planner.repository';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function render() {
  let printCount = 0;
  const wrapper = mount(App, { props: {
    repository: new LocalPlannerRepository(new MemoryStorage()),
    printPort: { print: () => { printCount += 1; } },
  } });
  return { wrapper, getPrintCount: () => printCount };
}

describe('Luggage planner App', () => {
  it('renders sample luggage and catches invalid dimensions', async () => {
    const { wrapper } = render();
    expect(wrapper.text()).toContain('行李箱空间规划师');
    expect(wrapper.text()).toContain('轻薄外套');
    await wrapper.get('[aria-label="行李箱长度"]').setValue('0');
    expect(wrapper.text()).toContain('行李箱长度必须大于 0');
  });

  it('adds and deletes an item', async () => {
    const { wrapper } = render();
    await wrapper.get('[aria-label="物品名称"]').setValue('新物品');
    await wrapper.get('[data-testid="item-editor"]').trigger('submit');
    expect(wrapper.text()).toContain('新物品');
    await wrapper.get('[aria-label="删除 新物品"]').trigger('click');
    expect(wrapper.text()).not.toContain('新物品');
  });

  it('selects a plan and highlights the same item in both projections', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-plan="shopping"]').trigger('click');
    expect(wrapper.get('[data-plan="shopping"]').classes()).toContain('active');
    const jacket = wrapper.findAll('[data-item-id="jacket"]');
    expect(jacket.length).toBe(2);
    await jacket[0].trigger('click');
    expect(wrapper.findAll('[data-item-id="jacket"].selected')).toHaveLength(2);
  });

  it('delegates printing through the print port', async () => {
    const { wrapper, getPrintCount } = render();
    await wrapper.get('[data-testid="print-button"]').trigger('click');
    expect(getPrintCount()).toBe(1);
  });

  it('previews a rotation, commits it and undoes it', async () => {
    const { wrapper } = render();
    await wrapper.findAll('[data-item-id="shoes"]')[0].trigger('click');
    await wrapper.get('[data-testid="rotate-button"]').trigger('click');
    expect(wrapper.text()).toContain('与其他物品相交');
    expect(wrapper.get('[data-testid="commit-preview"]').attributes('disabled')).toBeDefined();
    // 继续旋转，遍历其余不可行方向后回到可行方向
    for (let i = 0; i < 5; i += 1) await wrapper.get('[data-testid="rotate-button"]').trigger('click');
    expect(wrapper.text()).toContain('位置有效，可提交');
    await wrapper.get('[data-testid="commit-preview"]').trigger('click');
    expect(wrapper.text()).toContain('已确认移动');
    await wrapper.get('[data-testid="undo-button"]').trigger('click');
    expect(wrapper.text()).toContain('已撤销，完整回到调整前');
  });

  it('locks an item and keeps the lock after regenerating', async () => {
    const { wrapper } = render();
    await wrapper.findAll('[data-item-id="shoes"]')[0].trigger('click');
    await wrapper.get('[data-testid="lock-toggle"]').trigger('click');
    expect(wrapper.findAll('[data-item-id="shoes"].locked')).toHaveLength(2);
    await wrapper.get('[data-testid="regenerate-button"]').trigger('click');
    expect(wrapper.findAll('[data-item-id="shoes"].locked')).toHaveLength(2);
    expect(wrapper.text()).toContain('锁定物品保持原位');
  });

  it('lists lock conflicts when the suitcase shrinks and resolves them by unlocking', async () => {
    const { wrapper } = render();
    await wrapper.findAll('[data-item-id="shoes"]')[0].trigger('click');
    await wrapper.get('[data-testid="lock-toggle"]').trigger('click');
    await wrapper.get('[aria-label="行李箱长度"]').setValue('20');
    expect(wrapper.get('[data-testid="conflict-banner"]').text()).toContain('运动鞋');
    expect(wrapper.get('[data-testid="regenerate-button"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="resolve-unlock-shoes"]').trigger('click');
    expect(wrapper.find('[data-testid="conflict-banner"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('冲突已解除');
  });

  it('cancels a dimension change that broke locked placements', async () => {
    const { wrapper } = render();
    await wrapper.findAll('[data-item-id="shoes"]')[0].trigger('click');
    await wrapper.get('[data-testid="lock-toggle"]').trigger('click');
    await wrapper.get('[aria-label="行李箱长度"]').setValue('20');
    expect(wrapper.get('[data-testid="conflict-banner"]').text()).toContain('超出箱体边界');
    await wrapper.get('[data-testid="cancel-pending-change"]').trigger('click');
    expect(wrapper.find('[data-testid="conflict-banner"]').exists()).toBe(false);
    expect((wrapper.get('[aria-label="行李箱长度"]').element as HTMLInputElement).value).toBe('52');
  });
});
