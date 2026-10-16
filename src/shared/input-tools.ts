/**
 * Programs that sit between a controller and games: they add a virtual controller (and so
 * can make a game see one pad twice) or turn buttons into keys. The Controllers page lists
 * the ones that are running, with advice.
 */
export interface InputTool {
  id: string
  /** Product name, shown as is in every language. */
  name: string
  /** Lower-case process names. */
  exes: string[]
}

export const INPUT_TOOLS: readonly InputTool[] = [
  { id: 'steam', name: 'Steam Input', exes: ['steam.exe'] },
  { id: 'ds4windows', name: 'DS4Windows', exes: ['ds4windows.exe'] },
  { id: 'rewasd', name: 'reWASD', exes: ['rewasd.exe', 'rewasdengine.exe'] },
  { id: 'x360ce', name: 'x360ce', exes: ['x360ce.exe', 'x360ce_x64.exe'] },
  { id: 'dsx', name: 'DSX (DualSenseX)', exes: ['dsx.exe', 'dualsensex.exe'] },
  { id: 'betterjoy', name: 'BetterJoy', exes: ['betterjoy.exe', 'betterjoyforcemu.exe'] },
  { id: 'inputmapper', name: 'InputMapper', exes: ['inputmapper.exe'] },
  { id: 'joytokey', name: 'JoyToKey', exes: ['joytokey.exe'] },
  { id: 'antimicrox', name: 'AntiMicroX', exes: ['antimicrox.exe'] },
]

export const INPUT_TOOL_EXES: readonly string[] = INPUT_TOOLS.flatMap((tool) => tool.exes)

/** The tools behind a list of running process names, in INPUT_TOOLS order. */
export function toolsFromProcesses(running: readonly string[]): InputTool[] {
  const names = new Set(running.map((name) => name.toLowerCase()))
  return INPUT_TOOLS.filter((tool) => tool.exes.some((exe) => names.has(exe)))
}
