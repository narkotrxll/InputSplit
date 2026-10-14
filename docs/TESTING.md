# Testing InputSplit on a real Windows PC

The hardest requirement — a game keeps receiving its controller while somebody else uses the
keyboard and mouse — can only be proven on real Windows with a real controller. This file is
the step-by-step procedure. Results go into `docs/COMPATIBILITY.md`.

## What has already been verified (and where)

| Check | Environment | Result |
|-------|-------------|--------|
| Native code compiles (DLL, helper, probe) | MinGW-w64 cross-compile on Linux; MSVC in CI | ✅ |
| Helper protocol (`hello`, `listWindows`, `listControllers`, `listDisplays`, `checkTarget`) | Wine 9 | ✅ |
| Injection: `LoadLibraryW` → `InputSplitAttach`, handshake, all 7 features report *active* | Wine 9, Probe as target | ✅ |
| Status stream every second; XInput reads counted from the Probe | Wine 9 | ✅ |
| Stop → DLL confirms pass-through; restart re-attaches to the already loaded DLL | Wine 9 | ✅ |
| Fail-safe: helper killed with SIGKILL → DLL disables everything; new helper re-attaches | Wine 9 | ✅ |
| Probe paused behind Notepad (`running=0`) → after Start it runs in background (`background=1 running=1`) → after the helper exits it pauses again | Wine 9 | ✅ |
| **Everything involving real focus changes, real controllers, real games** | **Windows 10/11** | ⏳ **needs you** |

Wine proves the plumbing works; it does not prove Windows focus behaviour. Do not treat
any game as supported until it passes the steps below on Windows.

## 0. Preparation

1. Windows 10 (21H2+) or Windows 11, x64, an Xbox controller, ideally two monitors.
2. Get the binaries — either:
   - download the `inputsplit-native` artifact from the latest GitHub Actions run, **or**
   - build them: install *Visual Studio 2022 Build Tools* (C++ workload) and CMake, then in
     a "Developer PowerShell":
     ```powershell
     cmake -S native -B native\build -A x64
     cmake --build native\build --config Release
     ```
     Output: `native\build\bin\` → `inputsplit-helper.exe`, `InputSplitHook64.dll`,
     `InputSplitProbe.exe`.
3. Windows Defender may flag `InputSplitHook64.dll` (it is injected into another process).
   If so, allow it for the build folder only. Report it — this is why code signing is on the
   roadmap.

## Experiments with the Probe

`InputSplitProbe.exe` is a small "game" that shows everything a game would see. Its window
is green while it is running and red when it thinks it lost focus. Counters are logged every
second to `%TEMP%\InputSplitProbe.log`.

### E1 — Does Windows deliver XInput to a background window at all?

No InputSplit involved. This answers the open question from `RESEARCH.md` §4.

1. Run `InputSplitProbe.exe --always-poll`.
2. Click into another window (e.g. Notepad) on another monitor.
3. Move the left stick for ~10 seconds.
4. **Record** `packets seen … while really in background`.
   - grows → XInput works in background on this Windows build (expected).
   - stays 0 → XInput is focus-gated here; InputSplit's focus spoofing becomes essential.

### E2 — Focus loss without InputSplit (baseline)

1. Run `InputSplitProbe.exe` (no flags). Click another window.
2. Expected: red "PAUSED", `WM_ACTIVATEAPP(FALSE)` ≥ 1, packets stop growing.

### E3 — Focus loss with InputSplit

1. Run `InputSplitProbe.exe` and press `R` in it to reset the counters (once isolation is
   active the Probe cannot see the keyboard, so reset *before* starting).
2. In PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\poc\isolate.ps1 -Target InputSplitProbe -Slot 0
   ```
3. Do 20× Alt+Tab, click 20 times on windows on other monitors.
4. **Pass:** Probe stays green "RUNNING"; deactivation counters do not grow; the PowerShell
   status line shows `focusEventsSwallowed` growing.

### E4 — Controller in background (criterion C1)

With isolation active and Notepad focused, move the stick/press buttons for 60 s.
**Pass:** `packets … while really in background` keeps growing; values change on screen.

### E5 — Keyboard isolation (C3)

With isolation active, type ~500 characters in Notepad, including Alt+F4 *inside Notepad's
Save dialog only* (careful) and Windows-key shortcuts.
**Pass:** Probe keyboard counters unchanged; `blockedKb` in PowerShell grows (from
`GetAsyncKeyState` and raw input).

### E6 — Mouse isolation (C4)

1. Move the mouse across the Probe window, click inside it.
2. Restart the Probe with `--fps-cursor` and repeat E3 + this step.
**Pass:** Probe mouse counters unchanged; clicking the Probe does **not** activate it
(focus stays where it was); with `--fps-cursor` the cursor is never trapped or re-centred.

### E7 — Clean stop (C5)

Press Enter in PowerShell. Then Alt+Tab away from the Probe.
**Pass:** Probe turns red again (normal behaviour restored). Repeat start/stop 50 times:
no crash, no stuck state.

### E8 — Fail-safe (C6)

1. Start isolation, then kill `inputsplit-helper.exe` in Task Manager.
2. Within ~1 s, Alt+Tab away from the Probe. **Pass:** Probe turns red (hooks disabled).
3. Same with the emergency hotkey **Ctrl+Alt+Shift+Q**.

### E9 — Refusal (C7)

Create a folder `EasyAntiCheat` next to a copy of `InputSplitProbe.exe`, run that copy and try
to isolate it. **Pass:** refused with "Protected by Easy Anti-Cheat", nothing injected
(Process Explorer shows no `InputSplitHook64.dll` in the Probe).

## Real games (C8)

For each game: set **Borderless Windowed** in its video settings, disable Steam Input for it
(Steam → game → Properties → Controller → "Disable Steam Input"), then run E3–E7 with the game
instead of the Probe (`-Target <exe name without .exe>`). Also note: does audio keep playing?
Does the game minimise? Record everything in `docs/COMPATIBILITY.md`.

Suggested first set (single-player, no anti-cheat, different input stacks):

| Engine / input | Example games |
|----------------|---------------|
| Unity (old Input Manager) | Hollow Knight, Cuphead |
| Unreal Engine 4/5 | Hellblade, Stray |
| Native XInput | Dark Souls III, Sekiro |
| SDL2 | Celeste (FNA/SDL), Factorio |
| DirectInput (expected: Limited) | older titles |

## Performance (C9)

- Task Manager → Details: CPU and memory of `inputsplit-helper.exe` while idle and while a
  session is active (expected < 0.5 % CPU).
- Frame time: run a game with an FPS overlay (e.g. RTSS) with and without isolation.

## Automated tests in this repository

- `npm test` — Vitest unit tests (status model, settings/profile persistence, IPC schemas,
  helper protocol parsing, session state machine).
- `npm run typecheck`, `npm run lint`.
- Native: compile checks in CI (MSVC) and `native/build-mingw` (MinGW). Wine smoke tests are
  documented in `scripts/poc/` and are run manually.
