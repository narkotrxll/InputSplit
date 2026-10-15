import { describe, expect, it } from 'vitest'
import type { FrameStats } from './domain'
import { frameReadout } from './frame-stats'

const sample = (patch: Partial<FrameStats> = {}): FrameStats => ({
  enabled: true,
  timeUs: 10_000_000,
  frames: 1000,
  inputLatencySumUs: 0,
  inputLatencySamples: 0,
  worstFrameUs: 0,
  worstInputLatencyUs: 0,
  apis: ['dxgi'],
  ...patch,
})

describe('frameReadout', () => {
  it('computes FPS, frame time and latency from two samples', () => {
    const previous = sample({ inputLatencySumUs: 50_000, inputLatencySamples: 2 })
    const next = sample({
      timeUs: 11_000_000,
      frames: 1060,
      inputLatencySumUs: 50_000 + 3 * 20_000,
      inputLatencySamples: 5,
      worstFrameUs: 25_000,
      worstInputLatencyUs: 31_000,
    })
    const readout = frameReadout(previous, next)
    expect(readout.state).toBe('ok')
    expect(readout.fps).toBeCloseTo(60)
    expect(readout.frameMs).toBeCloseTo(16.67, 1)
    expect(readout.worstFrameMs).toBe(25)
    expect(readout.latencyMs).toBeCloseTo(20)
    expect(readout.worstLatencyMs).toBe(31)
  })

  it('reports no latency when nothing was pressed', () => {
    const readout = frameReadout(sample(), sample({ timeUs: 11_000_000, frames: 1030 }))
    expect(readout.fps).toBeCloseTo(30)
    expect(readout.latencyMs).toBeNull()
  })

  it('waits for a second sample and after the counter was just turned on', () => {
    expect(frameReadout(null, sample()).state).toBe('measuring')
    expect(frameReadout(sample({ enabled: false }), sample({ timeUs: 11_000_000 })).state).toBe(
      'measuring',
    )
    // A restarted DLL (counters back at zero) is not a negative frame rate.
    expect(frameReadout(sample(), sample({ timeUs: 11_000_000, frames: 3 })).state).toBe(
      'measuring',
    )
  })

  it('says so when no renderer could be hooked', () => {
    expect(frameReadout(sample(), sample({ apis: [], timeUs: 11_000_000 })).state).toBe(
      'noRenderer',
    )
  })

  it('shows 0 FPS for a game that stopped presenting', () => {
    const readout = frameReadout(sample(), sample({ timeUs: 11_000_000 }))
    expect(readout.fps).toBe(0)
    expect(readout.frameMs).toBeNull()
  })
})
