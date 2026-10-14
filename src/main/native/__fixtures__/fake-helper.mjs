// A stand-in for inputsplit-helper.exe used by helper-client.test.ts.
// FAKE_MODE: "normal" | "crash" (exit right after answering hello) | "badHello"
import { createInterface } from 'node:readline'

const mode = process.env.FAKE_MODE ?? 'normal'
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

send({ event: 'ready', data: { helperVersion: 'fake', pid: process.pid } })

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line)
  switch (method) {
    case 'hello':
      if (mode === 'badHello') return send({ id, result: { protocolVersion: 'one' } })
      send({
        id,
        result: {
          helperVersion: 'fake',
          protocolVersion: 1,
          hookProtocolVersion: 1,
          architecture: 'x64',
          windowsBuild: 26100,
          isElevated: false,
          pid: process.pid,
          hookDllFound: true,
          emergencyHotkey: 'Ctrl+Alt+Shift+Q',
        },
      })
      if (mode === 'crash') setTimeout(() => process.exit(3), 20)
      return
    case 'ping':
      return send({ id, result: { uptimeMs: 1 } })
    case 'checkTarget':
      return send({ id, error: { code: 'antiCheat', message: 'Protected by BattlEye.' } })
    case 'listControllers':
      send({ event: 'log', data: { level: 'info', source: 'helper', message: 'listing' } })
      return send({ id, result: { controllers: 'not-an-array' } })
    case 'shutdown':
      send({ id, result: {} })
      return process.exit(0)
    default:
      return send({ id, error: { code: 'unknownMethod', message: method } })
  }
})
