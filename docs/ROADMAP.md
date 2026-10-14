# InputSplit — Roadmap

Legend: ✅ done · 🔧 implemented, needs verification on real Windows · ⏳ planned

## Phase 0 — Research & feasibility ✅

- ✅ Read NoFocusLoss and ProtoInput source, licenses and issues → `docs/RESEARCH.md`
- ✅ Windows API capabilities and limits per input mechanism
- ✅ License check: NoFocusLoss = Unlicense; ProtoInput = MIT, **but its hook DLL statically
  links GPL-3.0 OpenXinput** → we port mechanisms, never ship its binaries
- ✅ Native bridge comparison → helper process with NDJSON over stdio
- ✅ Architecture → `docs/ARCHITECTURE.md`
- ✅ MVP success criteria (below)

## Phase 1 — Technical proof of concept 🔧

Native code compiles in CI (MSVC) and on Linux (MinGW cross-compile). Behaviour must be
measured on Windows — see `docs/TESTING.md` for the exact procedure.

- 🔧 `inputsplit-helper.exe`: windows, processes, XInput slots, displays, anti-cheat checks
- 🔧 `InputSplitHook64.dll`: activation shield, focus spoof, XInput bridge, keyboard/mouse
  block, cursor guard, fail-safe on pipe loss
- 🔧 `InputSplitProbe.exe`: test game that displays what a game sees
- ⏳ Experiments E1–E6 executed on a real PC, results recorded in `docs/COMPATIBILITY.md`

## Phase 2 — Electron foundation 🔧

- ✅ electron-vite + Vue 3 + TypeScript (strict) + Tailwind CSS 4
- ✅ ESLint + Prettier, Vitest
- ✅ Typed IPC contract with Zod validation and sender checks
- ✅ Settings and profiles persistence (atomic JSON writes, schema versioning)
- ✅ Helper supervision (spawn, ping, restart with back-off)
- ✅ electron-builder NSIS configuration
- ✅ Dev-only simulated backend

## Phase 3 — Polished UI 🔧

- ✅ Dashboard, Applications, Controllers (live test), Profiles, Settings, About
- ✅ Onboarding with risk acknowledgement
- ✅ Diagnostics drawer, tray, close-to-tray behaviour
- ✅ Status model: Ready / Isolating / Active / Limited Support / Error / Disconnected
- ⏳ Accessibility audit (keyboard-only pass, screen reader labels review)
- ⏳ README screenshots from a real Windows run

## Phase 4 — Native integration 🔧

- ✅ Session state machine driven only by helper/DLL confirmations
- ✅ Emergency hotkey handled in the helper
- ✅ Window move to target display, restore on stop
- ⏳ Auto-attach a profile when its executable starts (launchers, child processes)
- ⏳ 32-bit games (32-bit DLL + 32-bit injector)
- ⏳ DirectInput gamepads in background (`SetCooperativeLevel` → `DISCL_BACKGROUND`)
- ⏳ HID gamepads via Raw Input (`RIDEV_INPUTSINK`)
- ⏳ GameInput research: intercept `GameInputCreate`, set background focus policy
- ⏳ Launch-mode: start a game from a profile with `SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1`

## Phase 5 — Testing ⏳

- ⏳ Run the Probe test plan (E1–E6) on Windows 10 and Windows 11
- ⏳ At least 5 real games with different input stacks (XInput native, Unity, Unreal, SDL,
  DirectInput) → `docs/COMPATIBILITY.md`
- ⏳ Scenarios: focus loss, Alt+Tab, clicks on another monitor, typing, controller
  reconnect, game exit during isolation, InputSplit exit, helper kill
- ⏳ CPU/RAM/latency measurements

## Phase 6 — Release preparation ⏳

- ✅ README, architecture docs, third-party notices
- ✅ GitHub Actions: lint/typecheck/tests on Linux, native + installer build on Windows
- ⏳ Code signing (strongly recommended: injection tools trigger antivirus heuristics)
- ⏳ Release notes, installation guide with screenshots

## Later

- Multiple simultaneous sessions (two games, two controllers) — the helper and protocol
  already key everything by session id.
- More languages (vue-i18n is in place).
- Per-game compatibility profiles shipped with the app (data-driven feature presets).

---

## MVP success criteria

All measured with `InputSplitProbe.exe` unless stated otherwise. A criterion counts only when
it has been observed on real hardware and recorded in `docs/COMPATIBILITY.md`.

| # | Criterion | Pass condition |
|---|-----------|----------------|
| C1 | Background controller | With isolation active and VS Code focused on monitor 1, the Probe keeps showing changing XInput packets for 60 s of stick movement. |
| C2 | Focus messages | 20× Alt+Tab and 20 clicks on other monitors: Probe records 0 deactivation messages and `GetForegroundWindow == self` throughout. |
| C3 | Keyboard isolation | Typing 500 characters in Notepad: Probe counts 0 keyboard events (messages, raw input, `GetAsyncKeyState` hits). |
| C4 | Mouse isolation | Moving and clicking across the TV: Probe counts 0 mouse events, focus stays on the other app, cursor never confined or moved. |
| C5 | Clean stop | After Stop, Probe sees normal focus messages again and keyboard input when focused; 50 start/stop cycles without a crash. |
| C6 | Fail-safe | Killing the helper (Task Manager) returns the Probe to normal behaviour within 1 s. Killing InputSplit.exe does the same. |
| C7 | Refusal | A process with an anti-cheat module or folder is refused with an explanation; nothing is injected. |
| C8 | Real games | At least 3 real XInput games pass C1–C4 in Borderless Windowed. |
| C9 | Overhead | Helper idle < 0.5 % CPU; no measurable frame-time change in the Probe (hook overhead < 1 µs/call). |
