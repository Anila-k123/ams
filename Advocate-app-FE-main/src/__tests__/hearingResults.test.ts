import { describe, expect, it } from 'vitest'
import { HEARING_RESULTS, resultLabel, savedHearingMessage } from '../utils/hearingResults'

describe('hearing results', () => {
  it('labels every result the server accepts', () => {
    expect(HEARING_RESULTS.map((r) => r.value)).toEqual(['ADJOURNED', 'PART_HEARD', 'RESERVED', 'DISPOSED', 'NOT_REACHED', 'OTHER'])
    expect(resultLabel('PART_HEARD')).toBe('Part-heard')
    expect(resultLabel('')).toBe('')
  })

  it('says when the next date became a hearing, and when it only moved one', () => {
    expect(savedHearingMessage('Hearing updated.', { nextHearing: { date: '2026-11-20', created: true } }))
      .toBe('Hearing updated. Next hearing scheduled for 20 Nov 2026.')
    expect(savedHearingMessage('Hearing updated.', { nextHearing: { date: '2026-12-04', created: false } }))
      .toBe('Hearing updated. Next hearing set for 4 Dec 2026.')
    expect(savedHearingMessage('Hearing updated.', {})).toBe('Hearing updated.')
  })
})
