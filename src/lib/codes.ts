import { customAlphabet } from 'nanoid'

// Avoid ambiguous characters (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = customAlphabet(CODE_ALPHABET, 6)
const newRoundId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 10)

export function generateSessionCode(): string {
  return newCode()
}

export function generateRoundId(): string {
  return newRoundId()
}

export function normalizeSessionCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function isValidSessionCode(code: string): boolean {
  if (code.length !== 6) return false
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false
  return true
}
