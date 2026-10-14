# InputSplit — Architecture

> Status: Phase 1 (proof of concept) + Phase 2–4 foundation. Every claim about game
> compatibility is unverified until it appears in `docs/COMPATIBILITY.md`.
> Background research and the reasoning behind the choices below: `docs/RESEARCH.md`.

## 1. The problem in one paragraph

Windows has one keyboard focus per session. When user A clicks into VS Code, the game that
user B is playing on the TV receives "you lost focus" messages, sees that it is no longer
the foreground window and usually pauses, mutes, stops reading the controller or minimises.
At the same time, a game that *believes* it is focused would happily react to user A's
typing. InputSplit fixes both sides **inside the game process only**: the game is told it
never lost focus, it keeps reading *its* controller, and it is blinded to keyboard and
mouse. Nothing global is intercepted; user A's desktop keeps real focus and real input.

## 2. Processes

```
┌───────────────────────────── InputSplit.exe (Electron) ─────────────────────────────┐
│ Renderer (Vue 3, sandboxed)                                                          │
│   UI only. No Node. Talks to main through a typed, whitelisted preload API.          │
│                    ▲ contextBridge (window.inputsplit)                               │
│                    ▼                                                                 │
│ Main process (TypeScript)                                                            │
│   IPC handlers (Zod-validated, sender-checked) · settings & profiles (JSON files)   │
│   SessionManager (state machine) · support evaluator · logger · tray · icons        │
│   HelperClient: spawns + supervises the helper, NDJSON request/response/events      │
└────────────────────┬─────────────────────────────────────────────────────────────────┘
                     │ stdin/stdout, one JSON object per line
┌────────────────────▼─────────────────────────────────────────────────────────────────┐
│ inputsplit-helper.exe (C++17, Win32, no admin)                                       │
│   window/process enumeration · XInput slots · displays · anti-cheat & safety checks │
│   injector · per-game session (named-pipe server) · emergency hotkey · window moves │
└────────────────────┬─────────────────────────────────────────────────────────────────┘
                     │ \\.\pipe\InputSplit.Hook.<gamePid>  (fixed-size binary messages)
┌────────────────────▼─────────────────────────────────────────────────────────────────┐
│ Game process  +  InputSplitHook64.dll (C++17, MinHook, static CRT)                   │
│   activation shield · focus spoof · XInput bridge · keyboard/mouse block            │
│   cursor guard · API detection · counters                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Also built: `InputSplitProbe.exe` — a tiny test "game" that shows exactly what a game sees
(focus messages, `GetForegroundWindow`, XInput packets, keyboard/mouse events). It is the
measurement instrument for Phase 1 and for regression testing; it is not shipped to users.

### Why a separate helper process (not a Node addon)

- A crash or hang in native code cannot take down the UI, and vice-versa.
- No native Node module → no rebuilds per Electron version.
- The helper is usable from a terminal, which makes Phase 1 experiments and bug reports easy
  (`inputsplit-helper.exe` then type `{"id":1,"method":"listControllers"}`).
- Control traffic is tiny; the real-time controller path never leaves the game process.

## 3. Fail-safe chain (the most important design property)

Low-level hooks must never outlive the thing that controls them.

| Failure | What happens | Time to safe state |
|---------|--------------|--------------------|
| User presses **Ctrl+Alt+Shift+Q** | Helper (not the UI) disables all sessions immediately, then notifies UI. Works even if the UI is frozen. | < 100 ms |
| UI (renderer) hangs or crashes | Main process is unaffected; session continues; user can still stop from tray or hotkey. | n/a |
| Electron main exits / is killed | Helper's stdin closes → helper disables every session and exits. | < 1 s |
| Helper crashes / is killed | The OS closes its pipe handles → hook DLL sees the broken pipe → switches every hook to pass-through and restores window procedures. | < 1 s |
| Helper hangs | Main pings every 5 s; no answer in 5 s → main kills it → previous row. | ≤ 10 s |
| Game exits | Helper's wait on the process handle fires → session ends → UI shows "Game closed". | < 1 s |
| Hook DLL cannot apply a feature | That feature is reported `failed`; UI never shows it as active. | immediate |

"Disabled" means: every detour forwards straight to the original function, window
procedures are restored (when we are still at the top of the subclass chain), the cursor is
untouched. The DLL itself is **never unloaded** — unloading while a game thread is inside a
detour can crash the game (see RESEARCH N5). A stopped session costs the game a few
inactive trampolines and nothing else. Re-starting isolation on the same game re-uses the
loaded DLL.

## 4. Starting isolation — sequence

```
UI            Main                       Helper                         Game (+DLL)
│ start ───▶ │ validate selection        │                              │
│            │ SessionManager: checking  │                              │
│            │ ── checkTarget(pid) ────▶ │ bitness, integrity, AppContainer,
│            │                           │ anti-cheat (modules + game folder)
│            │ ◀── blockers/warnings ─── │                              │
│            │ (blocker → status Error,  │                              │
│            │  human-readable reason)   │                              │
│            │ ── startIsolation ──────▶ │ re-check (authoritative)     │
│            │                           │ create pipe server           │
│            │                           │ CreateRemoteThread(LoadLibraryW) ─▶ DllMain: store handle only
│            │                           │ CreateRemoteThread(InputSplitAttach) ─▶ start worker thread
│            │                           │ ◀───────── HELLO (pid, arch, detected APIs) ─┤
│            │                           │ ── CONFIGURE(features, slot, hwnd) ─────────▶ │ install hooks,
│            │                           │                              │ subclass windows
│            │                           │ ◀───────── STATUS (active/failed bits) ──────┤
│ ◀ status ─ │ ◀── sessionStatus ─────── │ (then STATUS every 1 s with counters)       │
```

- `DllMain` does nothing except remember its module handle (no work under the loader lock;
  fixes RESEARCH N2).
- `InputSplitAttach` is an exported function. The helper finds its address by parsing the
  DLL's export table from disk and adding the RVA to the module base in the game. The same
  path is used to **re-attach** after a helper restart (a second `LoadLibraryW` would not run
  `DllMain` again).

## 5. Hook DLL modules

All hooks are created once (MinHook), stay installed, and check an atomic feature mask on
every call. Pass-through costs one atomic load.

| Feature flag | Module | What it does | Origin |
|--------------|--------|--------------|--------|
| `ACTIVATION_SHIELD` | `activation_shield.cpp` | Subclasses **all** top-level windows of the process (re-scanned every second). Swallows `WM_ACTIVATE(WA_INACTIVE)`, `WM_ACTIVATEAPP(FALSE)`, `WM_KILLFOCUS`, `WM_IME_SETCONTEXT(FALSE)`; lets `WM_NCACTIVATE(FALSE)` reach `DefWindowProc` but not the game. When it turns on while the game is already in the background (the user just clicked *Start* in InputSplit), it posts one `WM_ACTIVATEAPP(TRUE)` / `WM_ACTIVATE` / `WM_SETFOCUS` so an already-paused game resumes — once, not in a loop. | NoFocusLoss, fixed N1/N2 |
| `FOCUS_SPOOF` | `focus_spoof.cpp` | `GetForegroundWindow`, `GetActiveWindow`, `GetFocus` return the game window. | NoFocusLoss + ProtoInput |
| `XINPUT_BACKGROUND` | `xinput_bridge.cpp` | Pre-loads all XInput DLL variants and hooks them (incl. ordinal 100 `XInputGetStateEx`). `XInputEnable(FALSE)` is ignored while active. Counts calls (proof that the game reads the pad). | ProtoInput + ours |
| `XINPUT_SLOT_LOCK` | `xinput_bridge.cpp` | Game user index 0 → chosen physical slot; indexes 1–3 → "not connected". | ProtoInput |
| `BLOCK_KEYBOARD` | `input_block.cpp` | `GetAsyncKeyState`/`GetKeyState`/`GetKeyboardState` report all keys up; `WM_KEY*`/`WM_CHAR`/`WM_SYSKEY*` and keyboard `WM_INPUT` are dropped; keyboard records in `GetRawInputData`/`GetRawInputBuffer` are neutralised. | ProtoInput + ours |
| `BLOCK_MOUSE` | `input_block.cpp` | Mouse messages dropped; `WM_MOUSEACTIVATE` → `MA_NOACTIVATEANDEAT` (a click on the TV does not steal focus); mouse raw input neutralised. | ProtoInput + ours |
| `CURSOR_GUARD` | `cursor_guard.cpp` | `SetCursorPos` and `ClipCursor` become no-ops; `GetCursorPos` returns a frozen point at the centre of the game window. | NoFocusLoss + ProtoInput |

API detection (reported in HELLO/STATUS, refreshed every second): XInput, DirectInput 8,
Windows.Gaming.Input, GameInput, SDL2, SDL3, Unity, Steam API.

### Status reported by the DLL

`requested` mask, `active` mask, `failed` mask, number of subclassed windows, the game
window handle, detected APIs and cumulative counters (XInput reads, blocked keyboard events,
blocked mouse events, swallowed focus events, blocked cursor calls).

## 6. Status model

The main process turns facts from the helper into what the UI shows
(`src/shared/support.ts`, unit-tested):

| UI status | Meaning |
|-----------|---------|
| **Ready** | Game and controller chosen, backend available, nothing running. |
| **Isolating** | Checks, injection or hook installation in progress. |
| **Active** | Every requested feature confirmed active by the DLL, and the game has been seen reading XInput. |
| **Limited Support** | Running, but something requested is `failed`/`unsupported`, or the game never called XInput (e.g. it uses Windows.Gaming.Input/GameInput), or a known limitation applies. Each item is listed with a reason. |
| **Error** | Refused or failed (anti-cheat, elevated game, 32-bit, injection error…) with a human explanation. |
| **Disconnected** | Isolation is running but the selected controller slot is not connected. |

A feature is displayed as *on* only when the DLL's `active` mask says so. The UI never
infers success.

### Two players

`SeatsService` (`src/main/services/seats-service.ts`) runs one `IsolationService` per
seat (player 1, player 2); each seat ignores helper events for the other seat's session id,
so the helper and the hook DLL need nothing new. Two sessions may run only on two different
controller slots with the slot lock on (`src/shared/seats.ts`): without the lock both games
would read every controller. The same rule disables Start in the UI and refuses the start in
main. Play, automatic start and the tray take the first free seat; the controller shortcut
stops the seat locked to the pressing controller.

## 7. Contracts

### 7.1 Renderer ↔ Main (`src/shared/ipc-contract.ts`)

- Responses cross the context bridge as plain `{ ok, data }` / `{ ok: false, error }`
  objects (custom `Error` properties do not survive the bridge); the renderer's `call()`
  turns failures into `ApiError` with the original `code`.
- Values the renderer needs at runtime (defaults, constants) live in `src/shared/defaults.ts`
  so the UI bundle does not include Zod.

- Every channel is declared once with a Zod schema for its input and output.
- `preload` exposes exactly these functions on `window.inputsplit`; there is no generic
  `ipcRenderer` access.
- Main checks that the sender is our own top-level frame (`file://` app origin or the dev
  server URL) and parses the payload with the schema before doing anything.
- Paths chosen by the user go through `dialog.showOpenDialog` in main, never typed in the
  renderer; executables are re-validated (`.exe`, exists, is a file).

### 7.2 Main ↔ Helper (`src/main/native/protocol.ts`, `native/helper/`)

NDJSON over stdio. Requests `{"id":1,"method":"listWindows","params":{}}`, responses
`{"id":1,"result":…}` or `{"id":1,"error":{"code":"…","message":"…"}}`, events
`{"event":"sessionStatus","data":…}`. Main validates every helper message with Zod
(version skew shows up as a clear error, not as `undefined` in the UI).

Methods: `hello`, `listWindows`, `listControllers`, `listDisplays`, `checkTarget`,
`startIsolation`, `stopIsolation`, `moveWindow`, `startControllerTest`,
`stopControllerTest`, `setEmergencyHotkey`, `setGamepadHotkey`, `rumble`, `ping`,
`shutdown`.
Events: `controllersChanged`, `controllerState`, `displaysChanged`, `sessionStatus`,
`sessionEnded`, `emergencyStop`, `gamepadHotkey`, `log`.

The controller shortcut is polled by the helper's controller thread (only connected slots,
every 50 ms while enabled). The helper only reports the held combination; deciding what to
start or stop happens in the main process (`AutomationService`).

### 7.3 Helper ↔ Hook DLL (`native/common/hook_protocol.h`)

Fixed-size, versioned binary structs over a message-mode named pipe (no JSON parser inside
the game). Messages: `HELLO`, `CONFIGURE`, `DISABLE`, `STATUS`, `LOG`. The DLL uses
overlapped I/O on one worker thread: it waits for commands and sends `STATUS` every second.

## 8. Safety rules enforced in native code (not only in the UI)

- Refuse: anti-cheat detected (modules in the process, or anti-cheat files in the game
  folder), 32-bit target (not yet supported), elevated target while we are not elevated,
  AppContainer / protected process, system processes (`%WINDIR%`), InputSplit itself.
- No global hooks (`SetWindowsHookEx`), no input locking, no Explorer manipulation.
- Emergency hotkey uses `RegisterHotKey` (does not see or block any other keys).
- No administrator rights requested. No display configuration changes; moving a game
  window is an explicit user action and the previous position is restored on stop.
- Diagnostics contain process names, window titles and API flags only — no keystrokes, no
  file contents. Logs stay local.

## 9. Performance budget

| Component | Budget | How |
|-----------|--------|-----|
| Helper idle | < 0.5 % CPU, < 10 MB | Controller presence polled at 1 Hz; test stream (60 Hz) only while the Controllers page is open; event-driven otherwise. |
| Hook DLL | < 1 µs per hooked call | One atomic load in pass-through; no allocation on hot paths; status every 1 s. |
| UI | idle near 0 % | No JS polling loops; data arrives as events; Electron background throttling allowed when hidden. |
| Renderer | — | No expensive work: icons are fetched by main (`app.getFileIcon`) and cached. |

Measurements are a Phase 5 task (`docs/TESTING.md`).

## 10. Repository layout

```
native/                 C++ (CMake)
  common/               hook_protocol.h, version.h — shared by helper and DLL
  hook/                 InputSplitHook DLL
  helper/               inputsplit-helper.exe
  probe/                InputSplitProbe.exe (test game)
  cmake/                MinGW toolchain for Linux cross-compilation
src/
  shared/               domain types, IPC contract, status logic (no Electron/Node imports)
  main/                 Electron main process
    native/             helper client, protocol schemas, dev-only simulated backend
    services/           settings, profiles, session manager, logger, icons
    ipc/                handler registration
  preload/              contextBridge API
  renderer/             Vue 3 app (components, views, stores, i18n)
docs/                   research, architecture, roadmap, testing, compatibility
```

## 11. Key decisions (ADR summary)

| # | Decision | Why |
|---|----------|-----|
| 1 | Port ProtoInput/NoFocusLoss mechanisms into our own small DLL instead of shipping ProtoInput | GPL OpenXinput is linked into ProtoInputHooks; heavy in-game GUI; no fail-safe. Mechanisms kept, with attribution. |
| 2 | MinHook | Small, maintained, BSD-2, works with MSVC and MinGW. |
| 3 | Helper process + NDJSON stdio | Crash isolation, no ABI rebuilds, lifetime tied to parent. |
| 4 | Never unload the DLL; pass-through instead | Unloading races with game threads inside detours. |
| 5 | Two-step injection (`LoadLibraryW`, then exported `InputSplitAttach`) | Nothing under the loader lock; supports re-attach. |
| 6 | Pinia for state | Several pages share selection, devices and session state. |
| 7 | Reka UI (headless) + Tailwind | Accessible primitives (dialogs, switches, tooltips, focus management) with our own visual design. |
| 8 | JSON files + Zod for settings/profiles | Human-readable, versioned, validated, no native dependency. |
| 9 | Simulated backend only in dev builds behind `INPUTSPLIT_SIMULATED_BACKEND=1` | Allows UI work on non-Windows machines without faking anything in production. |
