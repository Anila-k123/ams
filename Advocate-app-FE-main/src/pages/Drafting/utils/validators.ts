// Shared validators / sanitizers for inputs that must follow a fixed pattern
// (email, phone). Used to warn the user and block invalid submissions.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** True when `v` looks like a valid email address. */
export const isValidEmail = (v: string): boolean => EMAIL_RE.test((v || '').trim())

/** Emails never contain whitespace — strip it as the user types. */
export const sanitizeEmail = (v: string): string => (v || '').replace(/\s+/g, '')

/** Keep only phone-legal characters as the user types: digits, +, spaces,
 *  hyphens and parentheses. Everything else (letters, symbols) is dropped. */
export const sanitizePhone = (v: string): string => (v || '').replace(/[^\d+\-()\s]/g, '')

/** A valid phone number has 7–15 digits (ITU-T E.164 caps the national number
 *  at 15), with an optional leading '+'. */
export const isValidPhone = (v: string): boolean => {
  const s = (v || '').trim()
  if (!s) return false
  if (!/^\+?[\d\-()\s]+$/.test(s)) return false
  const digits = s.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}
