# Phase 0 — Research & Feasibility

This document records what we learned before writing InputSplit's low-level code:
what NoFocusLoss and ProtoInput actually do (read from their source), what Windows
allows, what we reuse, and what is still unverified.

Statements are marked as:

- **[code]** — verified by reading the source code of the project in question.
- **[docs]** — taken from official Microsoft / library documentation.
- **[reported]** — reported by third parties (issues, forums); plausible, not verified by us.
- **[to verify]** — must be measured on real Windows hardware (see `docs/TESTING.md`).

Research snapshot: NoFocusLoss `master` @ `4d30610`, ProtoInput `master` @ `dd29bf8`
(last commit September 2021).

---

## 1. NoFocusLoss

<https://github.com/araghon007/NoFocusLoss>

### 1.1 What it is

A small DLL (`NoFocusLoss/NoFocusLoss.cpp`, ~170 lines) plus a WPF GUI
(`NoFocusLossGUI`) that injects it into a chosen process. Purpose: stop games from
pausing / muting when they lose focus.

### 1.2 License

**The Unlicense** (public domain dedication) **[code]** (`LICENSE.txt`). We may reuse ideas
and code freely. We still credit it in `THIRD_PARTY_NOTICES.md` as a courtesy.

Submodules: MinHook (BSD-2-Clause) and SharpestInjector (the author's C# injector).

### 1.3 Mechanism **[code]**

On `DLL_PROCESS_ATTACH` (directly inside `DllMain`):

1. Finds "the main window": enumerates all threads of the process with Toolhelp, then
   all windows of those threads, and picks **the window with the largest area**
   (visible or not).
2. Installs two MinHook detours:
   - `GetForegroundWindow` → always returns the main window. Comment in code: some games
     mute audio if they do not see themselves as foreground.
   - `SetCursorPos` → becomes a no-op while the window is "unfocused" (stops games from
     stealing the cursor).
3. Subclasses the main window (`SetWindowLongPtr(GWLP_WNDPROC)`) and swallows:
   - `WM_NCACTIVATE` with `wParam == FALSE` (returns 0 — per Win32 docs, returning
     FALSE here *prevents* the deactivation of the non-client area),
   - `WM_ACTIVATE` with `WA_INACTIVE`,
   - `WM_ACTIVATEAPP` with `wParam == FALSE`,
   - `WM_KILLFOCUS`,
   - `WM_IME_SETCONTEXT` with `wParam == FALSE`.

On `DLL_PROCESS_DETACH` it restores the window procedure and disables the hooks.

### 1.4 XInput

NoFocusLoss does **not** touch XInput at all **[code]**. Its README states that background
controller input works "as long as they're using xinput and not Windows.Gaming.Input".
I.e. it relies on `XInputGetState` itself being focus-independent and only removes the
game's *own* focus checks. This matches our understanding of the APIs (section 4).

### 1.5 Injection

Done by the GUI through SharpestInjector (C#). The GUI ships a 32-bit and a 64-bit DLL and
picks one by target bitness. "Unload" calls the injector's unload routine (`FreeLibrary`
in the target).

### 1.6 Limitations and risks found in the code

| # | Problem | Impact for InputSplit |
|---|---------|-----------------------|
| N1 | Only the single "largest" window is subclassed; it can be an invisible helper window. | Must subclass all top-level windows of the process and track new ones. |
| N2 | Heavy work inside `DllMain` (MinHook init, `SetWindowLongPtr`) under the loader lock. | Must move initialisation to a worker thread. |
| N3 | **No keyboard/mouse isolation.** Once `GetForegroundWindow` lies, a game that polls `GetAsyncKeyState` or raw input believes it is focused and reacts to the *other user's* typing. | Must add keyboard/mouse neutralisation (from ProtoInput, see §2). |
| N4 | `ClipCursor` is not handled — a game can still confine the real cursor to the TV. | Must neutralise `ClipCursor`. |
| N5 | `FreeLibrary` while another game thread is inside a detour can crash the game. | We never unload; we switch hooks to pass-through (§ARCHITECTURE). |
| N6 | No control channel and no fail-safe: if the GUI dies, the DLL stays active forever. | Need a dead-man switch. |
| N7 | No anti-cheat detection. | Must refuse protected games. |
| N8 | Clicking the game window still activates it and sends clicks into the game. | Must handle `WM_MOUSEACTIVATE` and mouse messages. |

### 1.7 Verdict

The **mechanism** (subclass + swallow deactivation messages + spoof `GetForegroundWindow`
+ block `SetCursorPos`) is the right core for "game keeps running without focus". The
**binary** is not reusable as a module: no configuration, no IPC, unsafe init/unload.
We re-implement the same mechanism inside our hook DLL, fixing N1–N8, with credit.

---

## 2. ProtoInput

<https://github.com/Ilyaki/ProtoInput>

### 2.1 What it is

A toolkit for **split-screen** gaming: several copies of a game run side by side, each
receiving input from its own keyboard/mouse/controller. It is used by Nucleus Co-op.
Unmaintained since September 2021 **[code]** (last commit).

### 2.2 Components **[code]**

| Component | Role |
|-----------|------|
| `ProtoInputLoader` | C API (`protoloader.h`) used by host programs: inject, install/uninstall hooks, configure. Injection via EasyHook (runtime/startup/stealth) or BlackBone remote `LoadLibraryW`. |
| `ProtoInputHooks` | The DLL injected into the game. ~19 hooks, 8 message filters, Dear ImGui + OpenGL in-game control panel (Right Ctrl + Right Alt + N), fake cursor rendering, raw-input redirection, named-pipe server for commands from the loader. |
| `ProtoInputHost` | Stand-alone ImGui GUI using the loader API. |
| `ProtoInputUtil` | "Input locking": blocks the real mouse/keyboard system-wide and even suspends `explorer.exe`. |

### 2.3 License and dependencies

| Item | License | Notes |
|------|---------|-------|
| ProtoInput itself | **MIT**, © 2021 Ilyaki | Reuse allowed with copyright notice. |
| EasyHook | MIT | Last release 2.7 (2017-era), unmaintained. Requires separate `EasyHook64.dll`. |
| BlackBone | MIT | Large memory-hacking library (includes a kernel driver project). |
| Dear ImGui, GLEW, cereal | MIT / MIT-like / BSD-3 | In-game GUI and serialisation. |
| **OpenXinput** | **GPL-3.0-or-later** | **Statically linked into `ProtoInputHooks`** (`OpenXinput$(PlatformArchitecture).lib` in `ProtoInputHooks.vcxproj`; `OpenXinputDllMain` called from `dllmain.cpp`). |

**Consequence:** the distributed `ProtoInputHooks*.dll` is a combined work containing GPL
code. Shipping it inside an MIT-licensed InputSplit would require complying with GPLv3 for
that binary (and arguably the whole bundle). We therefore **do not ship ProtoInput binaries**
and **do not copy any OpenXinput code**. The MIT parts of ProtoInput may be adapted with its
copyright notice retained.

### 2.4 Mechanisms relevant to us **[code]**

**Focus spoofing** (`FocusHook.cpp`): hooks `GetForegroundWindow`, `WindowFromPoint`,
`GetActiveWindow`, `IsWindowEnabled`, `GetFocus`, `GetCapture`, `SetCapture`,
`ReleaseCapture`, `SetActiveWindow`, `SetFocus`, `SetForegroundWindow`. Each getter returns
the selected game window; each setter becomes a no-op.

**Focus message loop** (`FocusMessageLoop.cpp`): a thread that *posts*
`WM_ACTIVATE`, `WM_ACTIVATEAPP`, `WM_NCACTIVATE`, `WM_SETFOCUS`, `WM_MOUSEACTIVATE` to the
game every 5 ms. → We **do not** adopt this: it is a busy loop (CPU cost), and it is a form
of "forcing focus", which the project brief explicitly rejects.

**Message filters** (`MessageFilterHook.cpp`): hooks `GetMessageA/W` and `PeekMessageA/W`;
when a filter rejects a message, the `MSG` is zeroed (turned into `WM_NULL`) and success is
returned — "massive performance benefits compared to causing an error". Limitation: this
only sees **posted** messages. Activation messages (`WM_ACTIVATE`, `WM_ACTIVATEAPP`,
`WM_NCACTIVATE`, `WM_KILLFOCUS`) are **sent**, not posted, so these filters never see the
real ones. NoFocusLoss's window-procedure subclassing (§1.3) catches sent messages. We use
both techniques: subclassing for sent messages, Get/PeekMessage filtering for posted input.

**Keyboard state hooks** (`GetAsyncKeyStateHook.cpp`, `GetKeyStateHook.cpp`,
`GetKeyboardStateHook.cpp`): return the state of ProtoInput's *fake* keyboard. With no
keyboard assigned, every key reads as "up". This is exactly what we need to stop a game
that believes it is focused from reacting to another user's typing.

**Cursor hooks**: `GetCursorPos` returns the fake cursor; `SetCursorPos` moves only the fake
cursor; `ClipCursor` stores a fake clip rectangle and never clips the real cursor.

**Raw input** (`RegisterRawInputHook.cpp`, `RawInput.cpp`): the game's
`RegisterRawInputDevices` call is intercepted and the game's window is remembered;
ProtoInput registers its own hidden window with `RIDEV_INPUTSINK`, reads all devices and
re-sends only the selected devices' input to the game. `BlockRawInputHook` makes
`GetRawInputDeviceList` / `GetRegisteredRawInputDevices` report zero devices.

**XInput** (`XinputHook.cpp`): the most valuable piece for us.

- Pre-loads every XInput DLL variant (`xinput1_3`, `xinput1_4`, `xinput1_2`, `xinput1_1`,
  `xinput9_1_0`) *before* hooking, because games may load them later (comment mentions
  Terraria). Later `LoadLibrary` calls by the game get the already-hooked module.
- Hooks `XInputGetState`, `XInputSetState`, `XInputGetCapabilities` in all variants, plus
  the undocumented **`XInputGetStateEx` (ordinal 100)** in `xinput1_3`/`xinput1_4`, which
  some games use to read the Guide button (comment mentions Enter the Gungeon, Divinity:
  Original Sin 2).
- Remaps the game's user index 0..3 to a chosen physical slot; unassigned indexes return
  `ERROR_DEVICE_NOT_CONNECTED`. This is how one game is bound to one controller.
- Optional DirectInput→XInput translation (more than 4 pads) and OpenXinput (GPL — not
  used by us).
- `XInputEnable` is **not** hooked.

**DirectInput** (`DinputOrderHook.cpp`): reorders/filters `IDirectInput8::EnumDevices` so the
game sees only the selected device GUID.

### 2.5 Lifecycle and robustness **[code]**

- The hook DLL starts a console (`AllocConsole`), an ImGui/OpenGL GUI thread and a pipe
  thread inside the game. Heavy for our use-case.
- Hooks can be uninstalled through the pipe, but the DLL is never unloaded, and there is
  **no fail-safe**: if the host process dies, all hooks stay active.
- `ProtoInputUtil` input locking is global (suspends Explorer) — the opposite of what
  InputSplit needs (user A must keep the desktop).

### 2.6 Relevant issues **[reported]**

- #3 "Program stops responding when I inject Hooks" — open; one report links it to
  Sandboxie.
- #13 "Blocked by Google Chrome, Virus detected" — open. Injection tools commonly trigger
  antivirus heuristics. Mitigations for us: no packers, no obfuscation, small DLL,
  reproducible CI builds, code signing before public release.
- #12 Minecraft input only works on one instance; #8 extra mouse buttons; #6 invisible
  fake cursor — split-screen-specific, not relevant to us.

### 2.7 Verdict

ProtoInput is built for the **opposite** scenario: *every* participant uses fake input
inside a game, and the real desktop is locked. InputSplit needs the desktop to keep real
input and the game to receive **only** its controller.

Options considered:

| Option | Verdict |
|--------|---------|
| A. Use ProtoInput binaries via `protoloader.h` | **Rejected.** GPL contamination via OpenXinput; EasyHook + BlackBone (heavy, AV-flagged, unmaintained); injects console + OpenGL GUI into every game; no fail-safe; MSVC-v142-only solution without CI. |
| B. Fork and strip ProtoInput | Rejected. We would delete >80 % of the code; what remains is a handful of 5–30-line hook functions tied to EasyHook. |
| C. **Port the specific hook logic into a small purpose-built DLL on MinHook, with attribution** | **Chosen.** Keeps the proven *mechanisms* (which functions to hook, XInput DLL pre-loading, ordinal-100 `XInputGetStateEx`, user-index remapping, WM_NULL filtering, keyboard-state neutralisation) without the infrastructure we cannot ship. |

This is a port, not a reinvention: each ported function references its origin in a code
comment, and ProtoInput's MIT notice is kept in `THIRD_PARTY_NOTICES.md`.

---

## 3. Other references

- **Special K** (GPL-3.0): "Continue Rendering" and "Mouse input: disabled in background"
  options are reported to keep games running unfocused **[reported]** (NoFocusLoss issue
  #2). Behavioural reference only; no code reuse (license).
- **DisplayFusion** (proprietary): "Prevent Window Deactivation" **[reported]**. Reference only.

---

## 4. Windows input APIs and background behaviour

| Mechanism | Default behaviour without focus | What InputSplit does | Status |
|-----------|---------------------------------|----------------------|--------|
| Activation messages (`WM_ACTIVATE`, `WM_ACTIVATEAPP`, `WM_NCACTIVATE`, `WM_KILLFOCUS`) | Sent to the game on focus loss → many games pause/mute. | Swallow via window subclassing (NoFocusLoss technique) on all top-level windows. | Implemented, **[to verify]** per game |
| Focus queries (`GetForegroundWindow`, `GetActiveWindow`, `GetFocus`) | Return the other user's window → engines (e.g. Unreal's foreground check, Unity "run in background" logic) stop processing input. | Hook and return the game's own window. | Implemented, **[to verify]** |
| **XInput** `XInputGetState` | Win32 docs mark `XInputEnable` deprecated on Windows 10+ "as game controller input is automatically enabled/disabled by the system based on the application window focus" **[docs]**. Multiple projects report that `XInputGetState` nevertheless returns live data in background **[reported]**; NoFocusLoss relies on this. | Probe experiment E1 measures it without any hooks. Hook `XInputEnable` so the game cannot disable itself; remap user index to the chosen slot. | **[to verify]** — the single most important measurement |
| Raw Input (`WM_INPUT`) | Delivered to the foreground app only, unless the game registered with `RIDEV_INPUTSINK` / `RIDEV_EXINPUTSINK`. | Drop keyboard/mouse `WM_INPUT` in the subclass; neutralise keyboard/mouse records in `GetRawInputData` / `GetRawInputBuffer`. HID gamepads via raw input: planned (force `RIDEV_INPUTSINK`). | Kb/mouse implemented; HID gamepad planned |
| `GetAsyncKeyState` / `GetKeyState` / `GetKeyboardState` | `GetAsyncKeyState` reflects the global physical key state → leaks the other user's typing to a game that thinks it is focused. | Hook; report all keys up (ProtoInput technique). | Implemented |
| Window input messages (`WM_KEY*`, `WM_CHAR`, `WM_MOUSE*`) | Keyboard goes to the focused window only; mouse messages go to the window under the cursor (so moving the mouse across the TV feeds the game). | Filter in subclass and in `Get/PeekMessage`; answer `WM_MOUSEACTIVATE` with `MA_NOACTIVATEANDEAT`. | Implemented |
| Cursor APIs (`SetCursorPos`, `ClipCursor`, `GetCursorPos`) | A "focused" game re-centres or confines the *shared* cursor. | `SetCursorPos`/`ClipCursor` → no-op; `GetCursorPos` → frozen position inside the game window. | Implemented |
| DirectInput 8 | `DISCL_FOREGROUND` devices are unacquired when the window is not foreground → keyboard/mouse naturally isolated, **but DirectInput gamepads also stop**. | Planned: COM vtable hook of `SetCooperativeLevel` forcing `DISCL_BACKGROUND` for game controllers only. | Planned (post-MVP) — game reported as *Limited Support* |
| Windows.Gaming.Input | "A Windows application must have focus to receive input from a controller" (quoted from the namespace remarks in a Unity issue tracker entry) **[docs/reported]**. | Detect module, report *Limited Support*. | Not supported |
| GameInput | Default focus policy delivers no background input; a game may opt in with `GameInputEnableBackgroundInput` **[docs]**. | Detect module, report *Limited Support*. Research item: intercept `GameInputCreate` and set the focus policy. | Not supported yet |
| SDL2/SDL3 | Drops joystick events when no SDL window has keyboard focus unless `SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS` **[docs]**. SDL learns focus from `WM_SETFOCUS`/`WM_KILLFOCUS`. | Subclass swallows `WM_KILLFOCUS`; when InputSplit launches a game itself we can also set the env var `SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1`. | Partially, **[to verify]** |
| Exclusive fullscreen (DXGI) | Leaves fullscreen / minimises when focus is lost. | Cannot be fixed without breaking the other user. Require *Borderless Windowed*; explain in UI. | Documented limitation |
| Steam Input | When the game is not foreground, Steam applies the *Desktop Configuration* → the gamepad may move the shared mouse **[reported]**. | Detect running Steam, show guidance: disable Steam Input for that game / disable the Desktop layout. | Guidance only |
| Xbox Game Bar (Guide button) | Opens Game Bar on the *foreground* (other user's) screen. | Guidance: disable "Open Game Bar using this button on a controller". | Guidance only |

---

## 5. Hard Windows limits

1. **One input desktop, one keyboard focus.** Windows has exactly one foreground window
   per interactive session. InputSplit cannot give two people "real" focus; it makes the
   game *not care* about focus.
2. **Injection requires same-or-higher integrity.** A non-elevated InputSplit cannot inject
   into a game running as administrator (UIPI / integrity levels). We report this; we do not
   self-elevate silently.
3. **Bitness.** A 64-bit process loads only 64-bit DLLs. MVP supports 64-bit games;
   32-bit support needs a 32-bit DLL + 32-bit injector (roadmap).
4. **Protected processes / AppContainer.** Protected (PPL) processes cannot be opened;
   AppContainer (some Store apps) cannot load DLLs from arbitrary folders. We detect and refuse.
5. **Anti-cheat.** EasyAntiCheat, BattlEye, Vanguard, FACEIT, nProtect, XIGNCODE, ACE, etc.
   treat injection as cheating. We refuse to inject when we detect them (process modules,
   files in the game folder, running services). We never try to hide from them.
6. **Antivirus heuristics.** `CreateRemoteThread` + `LoadLibraryW` is a classic pattern;
   expect false positives until binaries are code-signed.
7. **Physical controller identity.** XInput exposes only logical slots 0–3, no serial
   numbers. A slot can change after reconnect. We show "Slot N" and never promise physical
   identity.

---

## 6. Native bridge options

| Option | Crash isolation | Build complexity | Latency | Verdict |
|--------|-----------------|------------------|---------|---------|
| Node-API addon (`.node`) | None — a crash kills Electron main | node-gyp / cmake-js per Electron ABI | Lowest | Rejected |
| FFI (koffi) to a DLL | None | Low | Low | Rejected |
| **Separate helper process, NDJSON over stdio** | Full; lifetime bound to the parent's pipe | Plain CMake executable, testable from a terminal | ~sub-millisecond, irrelevant for control traffic | **Chosen** |
| Windows service | Full | Requires admin install | Low | Rejected (admin) |

The real-time path (controller → game) never crosses this bridge: the game reads XInput
directly inside its own process. The bridge carries only commands, status and diagnostics.

## 7. Hooking library

| Library | License | Maintained | MinGW | Notes |
|---------|---------|------------|-------|-------|
| EasyHook | MIT | No | No | Used by ProtoInput |
| Microsoft Detours | MIT | Yes | Limited | MSVC-oriented |
| **MinHook** | BSD-2-Clause | Yes (v1.3.4) | Yes | Used by NoFocusLoss; tiny; static lib |

MinHook chosen: small, static, builds with both MSVC (CI release builds) and MinGW
(cross-compile checks on Linux).

## 8. Electron + TypeScript compatibility

- The native layer is two executables and a DLL, not a Node module → **no ABI rebuilds**
  when Electron updates; packaging copies them via `extraResources` (outside `asar`,
  because `CreateProcess` and `LoadLibrary` need real files).
- The helper's protocol is mirrored as TypeScript types + Zod schemas, so the main process
  validates everything coming from native code.
- Non-Windows development: the app runs, but the backend reports "unavailable". A
  simulated backend exists **only** in development builds behind an explicit env flag and
  shows a visible banner.
