/**
 * Turns two consecutive frame-counter samples from the hook DLL into what the FPS overlay
 * shows. The DLL only counts; every rate and average is computed here.
 */
import type { FrameStats } from './domain'

export interface FrameReadout {
  /** `measuring`: not enough samples yet; `noRenderer`: no Present call could be hooked. */
  state: 'measuring' | 'noRenderer' | 'ok'
  fps: number | null
  /** Average time per frame in this interval. */
  frameMs: number | null
  /** Longest frame in this interval. */
  worstFrameMs: number | null
  /** Average "game read new controller input -> next frame" time; null when nothing was pressed. */
  latencyMs: number | null
  worstLatencyMs: number | null
}

const EMPTY: Omit<FrameReadout, 'state'> = {
  fps: null,
  frameMs: null,
  worstFrameMs: null,
  latencyMs: null,
  worstLatencyMs: null,
}

export function frameReadout(previous: FrameStats | null, next: FrameStats): FrameReadout {
  if (next.apis.length === 0) return { state: 'noRenderer', ...EMPTY }
  if (
    previous === null ||
    !previous.enabled ||
    next.timeUs <= previous.timeUs ||
    next.frames < previous.frames ||
    next.inputLatencySamples < previous.inputLatencySamples
  ) {
    return { state: 'measuring', ...EMPTY }
  }
  const elapsedUs = next.timeUs - previous.timeUs
  const frames = next.frames - previous.frames
  const samples = next.inputLatencySamples - previous.inputLatencySamples
  const latencyUs = next.inputLatencySumUs - previous.inputLatencySumUs
  return {
    state: 'ok',
    fps: (frames * 1_000_000) / elapsedUs,
    frameMs: frames > 0 ? elapsedUs / frames / 1000 : null,
    worstFrameMs: frames > 0 && next.worstFrameUs > 0 ? next.worstFrameUs / 1000 : null,
    latencyMs: samples > 0 ? latencyUs / samples / 1000 : null,
    worstLatencyMs:
      samples > 0 && next.worstInputLatencyUs > 0 ? next.worstInputLatencyUs / 1000 : null,
  }
}
