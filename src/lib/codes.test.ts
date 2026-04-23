import { describe, expect, it } from 'vitest'
import { generateSessionCode, isValidSessionCode, normalizeSessionCode, generateRoundId } from './codes'

describe('session codes', () => {
  it('generates 6-char uppercase codes using a safe alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateSessionCode()
      expect(code).toHaveLength(6)
      expect(isValidSessionCode(code)).toBe(true)
      // The safe alphabet excludes ambiguous chars.
      expect(code).not.toMatch(/[O0I1L]/)
    }
  })

  it('normalizeSessionCode upper-cases, strips punctuation, caps at 6', () => {
    expect(normalizeSessionCode(' abc-123xx ')).toBe('ABC123')
    expect(normalizeSessionCode('foo_bar baz')).toBe('FOOBAR')
  })

  it('rejects invalid codes', () => {
    expect(isValidSessionCode('')).toBe(false)
    expect(isValidSessionCode('ABCDE')).toBe(false) // too short
    expect(isValidSessionCode('ABC12O')).toBe(false) // contains "O"
    expect(isValidSessionCode('abc123')).toBe(false) // lowercase
  })

  it('generates unique round ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 500; i++) ids.add(generateRoundId())
    expect(ids.size).toBe(500)
  })
})
