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
  const storage = new MemoryStorage();
  const wrapper = mount(App, { props: {
    repository: new LocalPlannerRepository(storage),
    printPort: { print() {} },
  } });
  return { wrapper, storage };
}

describe('Manual packing workbench', () => {
  it('previews a move, blocks invalid commits and updates positions, risks and print sheet on confirm', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-manual"]').trigger('click');
    expect(wrapper.text()).toContain('手动调整摆放方案');

    await wrapper.get('[data-testid="remove-shoes"]').trigger('click'); // 腾出箱底空间
    await wrapper.get('[data-testid="select-camera"]').trigger('click');
    expect(wrapper.get('[data-testid="draft-panel"]').text()).toContain('微单相机');
    expect(wrapper.findAll('[data-testid="draft-ghost"]')).toHaveLength(2); // 两个视图同时预览

    await wrapper.get('[data-testid="draft-x"]').setValue('999');
    expect(wrapper.get('[data-testid="draft-issues"]').text()).toContain('超出箱体边界');
    expect(wrapper.get('[data-testid="commit-draft"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="draft-x"]').setValue('5');
    await wrapper.get('[data-testid="draft-y"]').setValue('2');
    await wrapper.get('[data-testid="draft-z"]').setValue('0');
    expect(wrapper.find('[data-testid="draft-issues"]').exists()).toBe(false);
    await wrapper.get('[data-testid="commit-draft"]').trigger('click');

    expect(wrapper.find('[data-testid="draft-panel"]').exists()).toBe(false);
    expect(wrapper.get('.print-sheet').text()).toContain('微单相机');
    expect(wrapper.get('.print-sheet').text()).toContain('位置 (5, 2, 0)');
  });

  it('locks placements, keeps them on repack and survives a reload', async () => {
    const { wrapper, storage } = render();
    await wrapper.get('[data-testid="start-manual"]').trigger('click');
    await wrapper.get('[data-testid="lock-jacket"]').trigger('click');
    expect(wrapper.get('[data-testid="placed-chips"]').text()).toContain('🔒');
    expect(wrapper.text()).toContain('1 件已锁定');

    await wrapper.get('[data-testid="repack-unlocked"]').trigger('click');
    expect(wrapper.text()).toContain('1 件锁定保持不动');

    const reopened = mount(App, { props: {
      repository: new LocalPlannerRepository(storage),
      printPort: { print() {} },
    } });
    expect(reopened.text()).toContain('1 件已锁定');
    expect(reopened.get('[data-testid="placed-chips"]').text()).toContain('🔒');
  });

  it('keeps the last valid placement on a conflicting resize and waits for unlock or cancel', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-manual"]').trigger('click');
    await wrapper.get('[data-testid="lock-jacket"]').trigger('click');

    await wrapper.get('[aria-label="行李箱长度"]').setValue('20'); // 外套 30cm 放不进 20cm 的箱子
    const banner = wrapper.get('[data-testid="conflict-banner"]');
    expect(banner.text()).toContain('轻薄外套');
    expect(banner.text()).toContain('超出箱体边界');
    expect(wrapper.text()).toContain('已保留上次有效摆放');

    await wrapper.get('[data-testid="cancel-change"]').trigger('click');
    expect(wrapper.find('[data-testid="conflict-banner"]').exists()).toBe(false);
    expect((wrapper.get('[aria-label="行李箱长度"]').element as HTMLInputElement).value).toBe('52');

    await wrapper.get('[aria-label="行李箱长度"]').setValue('20');
    await wrapper.get('[data-testid="unlock-jacket"]').trigger('click'); // 解除锁定后冲突解除
    expect(wrapper.find('[data-testid="conflict-banner"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="unplaced-list"]').text()).toContain('轻薄外套');
  });

  it('flags locked placements when the item size itself is edited', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-testid="start-manual"]').trigger('click');
    await wrapper.get('[data-testid="lock-jacket"]').trigger('click');

    await wrapper.get('[aria-label="编辑 轻薄外套"]').trigger('click');
    await wrapper.get('[aria-label="编辑长度"]').setValue('60');
    await wrapper.get('[data-testid="save-dims"]').trigger('click');
    expect(wrapper.get('[data-testid="conflict-banner"]').text()).toContain('原朝向失效');

    await wrapper.get('[data-testid="cancel-change"]').trigger('click');
    expect(wrapper.find('[data-testid="conflict-banner"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('30×24×5 cm');
  });
});
