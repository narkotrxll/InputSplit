# InputSplit 0.1.0 — early preview

First public preview. **Not yet verified with real games on Windows hardware** — please help by
running the experiments in [docs/TESTING.md](TESTING.md) and reporting results.

## What's included

- Desktop app (Electron + Vue 3): dashboard, application picker, controller test, screen
  picker, profiles, settings, onboarding, diagnostics, tray, dark and light themes.
- Native helper (`inputsplit-helper.exe`): window, controller and display discovery,
  anti-cheat refusal, injection, session management, emergency hotkey (Ctrl+Alt+Shift+Q).
- Hook DLL (`InputSplitHook64.dll`): focus-loss shield, focus spoofing, XInput background +
  slot lock, keyboard/mouse blocking, cursor guard, automatic pass-through when the helper
  disappears.

## Known limitations

- 64-bit games only; no DirectInput gamepads in background yet.
- Windows.Gaming.Input / GameInput games: controller does not work in background (reported as
  *Limited support*).
- Installer is not code-signed; Windows SmartScreen and antivirus software may warn.

## Safety

Anti-cheat protected games are refused. Use with single-player or offline games.
