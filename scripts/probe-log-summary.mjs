// Summarises %TEMP%\InputSplitProbe.log (written by native/probe/main.cpp, one line per second)
// into what happened per run: when the Probe was focused, paused or isolated, and whether
// focus loss, keyboard or mouse input leaked through while it was isolated.
//
//   node scripts/probe-log-summary.mjs [path-to-log] [--last]
//
// Without a path it reads InputSplitProbe.log from the temp folder. --last shows only the most
// recent run. How to read the log by hand: docs/PROBE_LOG.md.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const COUNTERS = [
  'deactivateApp',
  'deactivate',
  'killFocus',
  'mouseActivate',
  'packets',
  'packetsBackground',
  'keyMsgs',
  'charMsgs',
  'asyncPresses',
  'rawKb',
  'mouseMoves',
  'mouseClicks',
  'rawMouse',
  'cursorChanges',
  'diChanges',
  'diChangesBackground',
  'rawHid',
  'rawHidBackground',
]
// Background controller input from any of the Probe's three controller readers.
const CONTROLLER_BACKGROUND = ['packetsBackground', 'diChangesBackground', 'rawHidBackground']
const FOCUS_LOSS = ['deactivateApp', 'deactivate', 'killFocus']
const KEYBOARD = ['keyMsgs', 'charMsgs', 'asyncPresses', 'rawKb']
const MOUSE = ['mouseMoves', 'mouseClicks', 'rawMouse', 'cursorChanges', 'mouseActivate']

const STATES = {
  '0/1': 'FOCUSED   (really focused, running)',
  '1/0': 'PAUSED    (in background, game thinks it lost focus)',
  '1/1': 'ISOLATED  (in background, game still thinks it is focused)',
  '0/0': 'ODD       (really focused but paused)',
}

const HEADER = /^--- probe started \(pid (\d+)\) ---$/
const SAMPLE = /^(\d\d):(\d\d):(\d\d) (.+)$/

function parse(text) {
  const runs = []
  let run = null
  let skipped = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const header = HEADER.exec(line)
    if (header) {
      run = { pid: header[1], samples: [] }
      runs.push(run)
      continue
    }
    const sample = SAMPLE.exec(line)
    if (!sample) {
      skipped++
      continue
    }
    const values = {}
    for (const pair of sample[4].split(' ')) {
      const [key, value] = pair.split('=')
      values[key] = Number(value)
    }
    // Logs from older Probe versions have no DirectInput / Raw Input HID counters.
    for (const key of COUNTERS) values[key] ??= 0
    if (!run) {
      // Lines before the first header (log truncated at the top).
      run = { pid: '?', samples: [] }
      runs.push(run)
    }
    const clock = `${sample[1]}:${sample[2]}:${sample[3]}`
    let seconds = Number(sample[1]) * 3600 + Number(sample[2]) * 60 + Number(sample[3])
    const previous = run.samples.at(-1)
    while (previous && seconds < previous.seconds) seconds += 86400 // past midnight
    run.samples.push({ clock, seconds, values, state: `${values.background}/${values.running}` })
  }
  return { runs, skipped }
}

// Counter growth between two consecutive samples. The counters are cumulative; when any of
// them goes down the user pressed R (reset), so the new values are the growth since the reset.
function step(previous, current) {
  const reset = COUNTERS.some((key) => current.values[key] < previous.values[key])
  const delta = {}
  for (const key of COUNTERS) {
    delta[key] = reset ? current.values[key] : current.values[key] - previous.values[key]
  }
  return { reset, delta }
}

function sum(delta, keys) {
  return keys.reduce((total, key) => total + (delta[key] ?? 0), 0)
}

function describe(delta, keys) {
  return keys
    .filter((key) => delta[key] > 0)
    .map((key) => `${key}+${delta[key]}`)
    .join(' ')
}

function summariseRun(run) {
  const lines = []
  const { samples } = run
  if (samples.length === 0) return ['  no samples']
  const first = samples[0]
  const last = samples.at(-1)
  lines.push(
    `  ${first.clock} → ${last.clock}  (${last.seconds - first.seconds + 1} s, ${samples.length} samples)`,
  )

  // Split into segments of consecutive samples with the same state. A segment's counters only
  // include seconds that started and ended in that state, so the second in which focus changed
  // (Alt+Tab, pressing R, starting isolation) never counts as a leak.
  const segments = []
  const resets = []
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    let segment = segments.at(-1)
    if (!segment || segment.state !== sample.state) {
      segment = { state: sample.state, from: sample, to: sample, delta: {}, padConnected: false }
      // The first sample of a run counts from zero, since the probe started at zero.
      for (const key of COUNTERS) segment.delta[key] = i === 0 ? sample.values[key] : 0
      segments.push(segment)
    } else {
      const { reset, delta } = step(samples[i - 1], sample)
      if (reset) resets.push(sample.clock)
      for (const key of COUNTERS) segment.delta[key] += delta[key]
    }
    segment.to = sample
    if (sample.values.padConnected) segment.padConnected = true
  }

  const problems = []
  for (const segment of segments) {
    const seconds = segment.to.seconds - segment.from.seconds + 1
    const { delta } = segment
    lines.push(
      `  ${segment.from.clock}–${segment.to.clock} ${String(seconds).padStart(5)} s  ${STATES[segment.state] ?? segment.state}`,
    )
    const details = []
    if (delta.packets > 0 || delta.packetsBackground > 0) {
      details.push(
        `controller packets +${delta.packets} (in background +${delta.packetsBackground})`,
      )
    }
    if (delta.diChanges > 0) {
      details.push(
        `DirectInput controller changes +${delta.diChanges} (in background +${delta.diChangesBackground})`,
      )
    }
    if (delta.rawHid > 0) {
      details.push(
        `Raw Input HID controller records +${delta.rawHid} (in background +${delta.rawHidBackground})`,
      )
    }
    const focus = describe(delta, FOCUS_LOSS)
    if (focus) details.push(`focus-loss messages ${focus}`)
    const keyboard = describe(delta, KEYBOARD)
    if (keyboard) details.push(`keyboard ${keyboard}`)
    const mouse = describe(delta, MOUSE)
    if (mouse) details.push(`mouse ${mouse}`)
    for (const detail of details) lines.push(`        ${detail}`)

    const where = `${segment.from.clock}–${segment.to.clock}`
    if (segment.state === '1/1') {
      if (sum(delta, FOCUS_LOSS) > 0)
        problems.push(`${where}: focus loss reached the game (${focus})`)
      if (sum(delta, KEYBOARD) > 0)
        problems.push(`${where}: keyboard reached the game (${keyboard})`)
      if (sum(delta, MOUSE) > 0) problems.push(`${where}: mouse reached the game (${mouse})`)
      const otherController = delta.diChanges > 0 || delta.rawHid > 0
      if (!segment.padConnected && !otherController) {
        problems.push(`${where}: no controller connected on XInput slot 0`)
      } else if (seconds >= 5 && sum(delta, CONTROLLER_BACKGROUND) === 0) {
        problems.push(`${where}: no controller input in background (was the stick moved?)`)
      }
    }
  }

  // Moments the game decided it lost focus (running 1 → 0).
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1].values.running === 1 && samples[i].values.running === 0) {
      const background = samples[i].values.background === 1
      lines.push(
        `  ! ${samples[i].clock} game paused${background ? ' (window went to background)' : ''}`,
      )
    }
  }
  if (resets.length > 0) lines.push(`  counters reset (R) at ${resets.join(', ')}`)

  const isolated = segments.some((segment) => segment.state === '1/1')
  if (!isolated) {
    lines.push('  verdict: never isolated in this run (no background=1 running=1 samples)')
  } else if (problems.length === 0) {
    lines.push('  verdict: OK, no focus loss, keyboard or mouse leaked while isolated')
  } else {
    lines.push('  verdict: PROBLEMS')
    for (const problem of problems) lines.push(`    - ${problem}`)
  }
  return lines
}

const args = process.argv.slice(2)
const lastOnly = args.includes('--last')
const path = args.find((arg) => !arg.startsWith('--')) ?? join(tmpdir(), 'InputSplitProbe.log')

let text
try {
  text = readFileSync(path, 'utf8')
} catch (error) {
  console.error(`Cannot read ${path}: ${error.message}`)
  process.exit(1)
}

const { runs, skipped } = parse(text)
const shown = lastOnly ? runs.slice(-1) : runs
console.log(
  `${path}: ${runs.length} run(s)${skipped ? `, ${skipped} unreadable line(s) skipped` : ''}`,
)
for (const run of shown) {
  console.log(`\nRun pid ${run.pid}`)
  for (const line of summariseRun(run)) console.log(line)
}
