import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StagePipeline from '~/components/trip/negotiate/StagePipeline.vue'
import type { StageInfo } from '~/types/index'

function stages(overrides: Partial<Record<number, StageInfo['status']>> = {}): StageInfo[] {
  const base: StageInfo[] = [
    { id: 'LOGISTICS_PLANNING', label: 'Logistics', status: 'queued' },
    { id: 'FINANCE_ENVELOPE_CHECK', label: 'Finance envelope', status: 'queued' },
    { id: 'PARALLEL_TURISTIC_PLANNING', label: 'Experiences', status: 'queued' },
    { id: 'MERGE_AND_SCORE', label: 'Merge & resolve', status: 'queued' },
    { id: 'FINANCE_VALIDATE', label: 'Finance validate', status: 'queued' },
    { id: 'FINAL_VALIDATION', label: 'Final check', status: 'queued' },
  ]
  Object.entries(overrides).forEach(([i, status]) => { base[Number(i)]!.status = status! })
  return base
}

describe('StagePipeline', () => {
  it('renders one cell per stage with the correct label', () => {
    const wrapper = mount(StagePipeline, { props: { stages: stages() } })
    const cells = wrapper.findAll('[data-testid="stage-cell"]')
    expect(cells).toHaveLength(6)
    expect(wrapper.text()).toContain('Logistics')
    expect(wrapper.text()).toContain('Finance validate')
  })

  it('shows "initialising…" label when no stage has started', () => {
    const wrapper = mount(StagePipeline, { props: { stages: stages() } })
    expect(wrapper.find('[data-testid="stage-label"]').text()).toBe('initialising…')
  })

  it('shows "stage N of 6" for the running stage', () => {
    const wrapper = mount(StagePipeline, { props: { stages: stages({ 0: 'done', 1: 'running' }) } })
    expect(wrapper.find('[data-testid="stage-label"]').text()).toBe('stage 2 of 6 · Finance envelope')
  })

  it('marks the correct cell status via data-status', () => {
    const wrapper = mount(StagePipeline, { props: { stages: stages({ 0: 'done', 1: 'running' }) } })
    const cells = wrapper.findAll('[data-testid="stage-cell"]')
    expect(cells[0]!.attributes('data-status')).toBe('done')
    expect(cells[1]!.attributes('data-status')).toBe('running')
    expect(cells[2]!.attributes('data-status')).toBe('queued')
  })

  it('falls back to the last done stage for the label once everything is done', () => {
    const wrapper = mount(StagePipeline, { props: { stages: stages({ 0: 'done', 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'done' }) } })
    expect(wrapper.find('[data-testid="stage-label"]').text()).toBe('stage 6 of 6 · Final check')
  })
})
