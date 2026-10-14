import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'
import { LOCALES } from '@shared/locales'
import { en } from './en'
import { messages } from './index'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of flatten(value, path)) out.set(k, v)
  }
  return out
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const source = flatten(en as unknown as Tree)

describe('translations', () => {
  it('registers every locale', () => {
    expect(Object.keys(messages).sort()).toEqual([...LOCALES].sort())
  })

  for (const locale of LOCALES) {
    const target = flatten(messages[locale] as unknown as Tree)

    it(`${locale}: has exactly the English keys`, () => {
      expect([...target.keys()].sort()).toEqual([...source.keys()].sort())
    })

    it(`${locale}: keeps every placeholder and compiles`, () => {
      for (const [key, text] of target) {
        expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(source.get(key)!))
        expect(text.trim(), `${locale} ${key} is empty`).not.toBe('')
        const errors: string[] = []
        baseCompile(text, { onError: (error) => errors.push(error.message) })
        expect(errors, `${locale} ${key}`).toEqual([])
      }
    })
  }
})
