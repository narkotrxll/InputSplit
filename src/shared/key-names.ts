/** Short names of Windows virtual-key codes, for the "Controller as keyboard" table. */
const NAMES: Record<number, string> = {
  0x08: 'Backspace',
  0x09: 'Tab',
  0x0d: 'Enter',
  0x10: 'Shift',
  0x11: 'Ctrl',
  0x12: 'Alt',
  0x13: 'Pause',
  0x14: 'Caps Lock',
  0x1b: 'Esc',
  0x20: 'Space',
  0x21: 'Page Up',
  0x22: 'Page Down',
  0x23: 'End',
  0x24: 'Home',
  0x25: '←',
  0x26: '↑',
  0x27: '→',
  0x28: '↓',
  0x2d: 'Insert',
  0x2e: 'Delete',
  0x6a: 'Num *',
  0x6b: 'Num +',
  0x6d: 'Num -',
  0x6e: 'Num .',
  0x6f: 'Num /',
  0xba: ';',
  0xbb: '=',
  0xbc: ',',
  0xbd: '-',
  0xbe: '.',
  0xbf: '/',
  0xc0: '`',
  0xdb: '[',
  0xdc: '\\',
  0xdd: ']',
  0xde: "'",
}

export function keyName(vk: number): string {
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk)
  if (vk >= 0x60 && vk <= 0x69) return `Num ${vk - 0x60}`
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`
  return NAMES[vk] ?? `0x${vk.toString(16).toUpperCase()}`
}
