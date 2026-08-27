import { describe, expect, it } from 'vitest'
import { isScrimbaUrl, scrimbaUrlPatterns } from './scrimbaUrl'

describe('Scrimba URL validation', () => {
  it('exports only the supported manifest URL patterns', () => {
    expect(scrimbaUrlPatterns).toEqual([
      'https://scrimba.com/*',
      'https://v2.scrimba.com/*',
    ])
  })

  it.each([
    'https://scrimba.com/',
    'https://scrimba.com/learn/typescript',
    'https://scrimba.com/dashboard?tab=recent',
    'https://v2.scrimba.com/learn/frontend',
  ])('accepts supported URLs: %s', (url) => {
    expect(isScrimbaUrl(url)).toBe(true)
  })

  it.each([
    'http://scrimba.com/learn/typescript',
    'https://www.scrimba.com/',
    'https://evil.scrimba.com/',
    'https://scrimba.com.example.com/',
    'https://scrimba.com@evil.example/',
    'https://example.com/scrimba.com',
    'not a URL',
    '',
  ])('rejects unsupported or deceptive URLs: %s', (url) => {
    expect(isScrimbaUrl(url)).toBe(false)
  })
})
