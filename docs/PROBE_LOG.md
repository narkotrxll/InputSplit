# Reading the Probe log

`InputSplitProbe.exe` (`native/probe/main.cpp`) appends one line per second to
`%TEMP%\InputSplitProbe.log` while its window is open. Attach this file to bug reports and use
it to fill in `docs/COMPATIBILITY.md` (procedure: `docs/TESTING.md`).

Quick summary instead of reading by hand:

```powershell
node scripts\probe-log-summary.mjs                 # reads %TEMP%\InputSplitProbe.log
node scripts\probe-log-summary.mjs path\to.log --last   # only the most recent run
```

## Format

```text
--- probe started (pid 4242) ---
17:40:01 background=0 running=1 deactivateApp=0 deactivate=0 killFocus=0 mouseActivate=0 padConnected=1 packets=12 packetsBackground=0 keyMsgs=3 charMsgs=2 asyncPresses=3 rawKb=3 mouseMoves=40 mouseClicks=1 rawMouse=55 cursorChanges=38
```

- The file is only ever appended to. Each start of the Probe writes a `--- probe started ---`
  header, so one file usually holds several runs.
- Time is local `HH:MM:SS`, no date. It wraps at midnight.
- The command-line flags (`--always-poll`, `--fps-cursor`, `--no-xinput-enable`) are **not**
  logged. Write down which ones you used.
- Every value after `running` is a **cumulative counter** since the Probe started or since
  `R` was last pressed. What matters is whether it **grows** between lines, not its value.
  When the counters suddenly drop, `R` was pressed.

## The two state flags

| Field | Meaning |
|-------|---------|
| `background` | The truth: `1` when the Probe window is really not the active window. Measured with `GetGUIThreadInfo`, which InputSplit does not hook, so it cannot be spoofed. |
| `running` | What the game believes: `1` when it has not received a deactivation message **and** `GetForegroundWindow()` returns its own window. `0` means it paused like a real game would. |

Together they give the state of each second:

| `background` / `running` | State | When it is expected |
|---|---|---|
| `0` / `1` | Focused, running | You are using the Probe window normally. |
| `1` / `0` | Paused, focus lost | Another window is active and InputSplit is not running (baseline, E2), or isolation was stopped (E7, E8). |
| `1` / `1` | **Isolated** | Another window is active but the game still thinks it has focus. This is what InputSplit should produce (E3–E6). |
| `0` / `0` | Odd | Really focused but paused. Can show for a second during a switch; if it persists, report it. |

## Signs that focus was lost

- `running` goes from `1` to `0`. This is the decisive one: the game paused.
- `deactivateApp` (`WM_ACTIVATEAPP(FALSE)`), `deactivate` (`WM_ACTIVATE(WA_INACTIVE)`) or
  `killFocus` (`WM_KILLFOCUS`) grows. Without InputSplit each Alt+Tab adds 1 to each.
  **While isolated (`1`/`1`) none of them may grow**; if one does, the activation shield
  missed a message even if `running` stayed `1`.
- `mouseActivate` grows while isolated: a click on the game window reached it
  (`WM_MOUSEACTIVATE`), which could steal focus from the other user's window.

## Signs that controller input was lost

- `padConnected=0`: nothing on XInput slot 0 (controller off, or on another slot).
- `packets` stops growing while you move the stick. Note the Probe only reads the
  controller while `running=1` (or always with `--always-poll`), so a flat `packets` during a
  pause is the game pausing, not lost input.
- `packetsBackground` is the subset of `packets` read while `background=1`.
  - E1 (`--always-poll`, no InputSplit): grows → Windows delivers XInput in background;
    stays 0 while moving the stick → XInput is focus-gated on this Windows build.
  - E4 (isolated): must keep growing while the stick moves. Flat → controller input is lost.
- `padConnected` is only refreshed while polling, so during a pause it shows the last value.
- `diChanges` / `diChangesBackground`: the first DirectInput controller changed state (stick
  moved, button pressed), in total and while `background=1`. `diFound=1` means the Probe found
  one; `diLost` counts reads that failed because Windows took the device away (focus loss).
  Isolated, `diChangesBackground` must grow while the stick moves.
- `rawHid` / `rawHidBackground`: Raw Input records from HID gamepads/joysticks. The Probe
  registers them *without* `RIDEV_INPUTSINK`, like most games, so without InputSplit
  `rawHidBackground` stays 0. Isolated, it must grow while the stick moves. Xbox controllers
  usually report through XInput only; DualShock/DualSense and generic USB pads show up here.

## Signs that keyboard or mouse leaked into the game

While isolated (`1`/`1`) these must stay flat. While really focused (`0`/`1`) growth is
normal.

| Counter | Source |
|---------|--------|
| `keyMsgs`, `charMsgs` | `WM_KEYDOWN`/`WM_SYSKEYDOWN`, `WM_CHAR` messages |
| `asyncPresses` | `GetAsyncKeyState` polling (new key-down edges) |
| `rawKb` | Raw Input keyboard records (registered with `RIDEV_INPUTSINK`, so background too) |
| `mouseMoves`, `mouseClicks` | `WM_MOUSEMOVE`, `WM_L/R/MBUTTONDOWN` messages |
| `rawMouse` | Raw Input mouse records |
| `cursorChanges` | `GetCursorPos` returned a different point than last frame |

Ignore growth in the single second where the state changes (pressing `R`, Alt+Tab, starting
or stopping isolation). For example, `cursorChanges` usually grows by one when isolation
starts because `GetCursorPos` is then frozen at the centre of the game window. The summary
script already skips those transition seconds.

## Example

```text
17:40:05 background=0 running=1 deactivateApp=0 ... packets=40 packetsBackground=0 ... keyMsgs=1 ...
17:40:06 background=1 running=1 deactivateApp=0 ... packets=52 packetsBackground=12 ... keyMsgs=1 ...
17:40:07 background=1 running=1 deactivateApp=0 ... packets=65 packetsBackground=25 ... keyMsgs=1 ...
17:40:08 background=1 running=0 deactivateApp=1 ... packets=65 packetsBackground=25 ... keyMsgs=1 ...
```

Isolation started at 17:40:06: the window went to background but the game kept running and
reading the controller, and the keyboard stayed flat. At 17:40:08 the game received
`WM_ACTIVATEAPP(FALSE)` and paused: either isolation was stopped (expected in E7/E8) or focus
loss leaked through (a bug if isolation was still on).
