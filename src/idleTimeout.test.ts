import { describe, expect, it } from 'vitest'
import {
  getIdleTimeoutPresetLabel,
  idleTimeoutPresets,
  isIdleTimeoutPreset,
} from './idleTimeout'

describe('idle timeout presets', () => {
  it('offers the supported timeout choices in ascending order', () => {
    expect(idleTimeoutPresets).toEqual([
      { seconds: 10, label: '10s' },
      { seconds: 30, label: '30s' },
      { seconds: 60, label: '1m' },
      { seconds: 120, label: '2m' },
      { seconds: 180, label: '3m' },
    ])
  })

  it.each([10, 30, 60, 120, 180])('accepts %s seconds', (seconds) => {
    expect(isIdleTimeoutPreset(seconds)).toBe(true)
  })

  it.each([0, 45, 181, -10])('rejects %s seconds', (seconds) => {
    expect(isIdleTimeoutPreset(seconds)).toBe(false)
  })

  it('returns labels only for supported presets', () => {
    expect(getIdleTimeoutPresetLabel(120)).toBe('2m')
    expect(getIdleTimeoutPresetLabel(45)).toBeNull()
  })
})
