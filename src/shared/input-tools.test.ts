import { describe, expect, it } from 'vitest'
import { INPUT_TOOL_EXES, toolsFromProcesses } from './input-tools'

describe('toolsFromProcesses', () => {
  it('finds the tools behind running process names, ignoring case', () => {
    const tools = toolsFromProcesses(['DS4Windows.exe', 'steam.exe', 'notepad.exe'])
    expect(tools.map((tool) => tool.id)).toEqual(['steam', 'ds4windows'])
  })

  it('lists every exe in lower case for the helper', () => {
    expect(INPUT_TOOL_EXES.every((exe) => exe === exe.toLowerCase())).toBe(true)
  })
})
