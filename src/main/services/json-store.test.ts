import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JsonFileStore } from './json-store'

const schema = z.object({ count: z.number() })

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'inputsplit-store-'))
  const path = join(dir, 'data.json')
  const warnings: string[] = []
  const store = new JsonFileStore(
    path,
    schema,
    () => ({ count: 0 }),
    (w) => warnings.push(w),
  )
  return { dir, path, store, warnings }
}

describe('JsonFileStore', () => {
  it('returns defaults when the file does not exist', async () => {
    const { store } = makeStore()
    expect(await store.read()).toEqual({ count: 0 })
  })

  it('round-trips data and leaves no temporary files behind', async () => {
    const { dir, store } = makeStore()
    await store.write({ count: 3 })
    await store.write({ count: 4 })
    expect(await store.read()).toEqual({ count: 4 })
    expect(readdirSync(dir)).toEqual(['data.json'])
  })

  it('serialises concurrent writes (last one wins)', async () => {
    const { store } = makeStore()
    await Promise.all([1, 2, 3, 4, 5].map((count) => store.write({ count })))
    expect(await store.read()).toEqual({ count: 5 })
  })

  it('quarantines a corrupt file and falls back to defaults', async () => {
    const { dir, path, store, warnings } = makeStore()
    writeFileSync(path, '{"count": "many"}')
    expect(await store.read()).toEqual({ count: 0 })
    expect(warnings).toHaveLength(1)
    const backup = readdirSync(dir).find((name) => name.includes('corrupt'))
    expect(backup).toBeDefined()
    expect(readFileSync(join(dir, backup as string), 'utf8')).toContain('many')
  })

  it('refuses to write invalid data', () => {
    const { store } = makeStore()
    expect(() => store.write({ count: 'x' } as unknown as { count: number })).toThrow()
  })
})
