# Compatibility matrix

Only results observed on real Windows hardware are listed here. Procedure: `docs/TESTING.md`.

Legend: ✅ works · ⚠️ partially · ❌ does not work · — not tested

## Owner report (2026-10-14)

The project owner ran the procedure from `docs/TESTING.md` on real Windows with an Xbox
controller. Summary as reported: **everything works, but only in single-player games**, which
matches the documented scope (anti-cheat protected and online multiplayer games are refused or
not supported, see the last section). Per-experiment results, the Windows build and the exact
games tested were not recorded yet; the tables below stay at "—" until they are.

## Windows behaviour (Probe)

| Experiment | Windows 10 | Windows 11 | Notes |
|------------|------------|------------|-------|
| E1 XInput delivered in background without InputSplit | — | — | |
| E3 focus loss hidden | — | — | |
| E4 controller in background | — | — | |
| E5 keyboard isolation | — | — | |
| E6 mouse isolation / no click activation | — | — | |
| E7 clean stop (50 cycles) | — | — | |
| E8 fail-safe (helper killed / hotkey) | — | — | |
| E9 anti-cheat refusal | — | — | |

## Games

| Game | Engine / input | Version / store | Mode | Background controller | No pause | Audio | Keyboard isolated | Mouse isolated | Result | Tester / date |
|------|----------------|-----------------|------|----------------------|----------|-------|-------------------|----------------|--------|---------------|
| — | | | | | | | | | | |

## Known incompatible by design

| Category | Why |
|----------|-----|
| Anti-cheat protected games (EAC, BattlEye, Vanguard, …) | InputSplit refuses to inject. |
| Games reading controllers only via Windows.Gaming.Input | The API delivers input to the focused window only. |
| Games using GameInput without background focus policy | No background input by default. |
| Exclusive fullscreen | Windows leaves exclusive fullscreen on focus loss; use Borderless Windowed. |
| 32-bit games | Not supported yet (roadmap). |
| Games running as administrator | Run InputSplit as administrator too, or start the game normally. |
