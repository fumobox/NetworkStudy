// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { lookupFib, type FibEntry } from './fib'

const FIB: readonly FibEntry[] = [
  { prefix: '192.0.2.0/24', nextHop: 'connected', via: '-' },
  { prefix: '203.0.113.0/24', nextHop: '192.0.2.2', via: 'BGP (Site A)' },
]

describe('lookupFib', () => {
  it('最長一致で引く', () => {
    expect(lookupFib(FIB, '203.0.113.53')?.nextHop).toBe('192.0.2.2')
    expect(lookupFib(FIB, '192.0.2.10')?.nextHop).toBe('connected')
    expect(lookupFib(FIB, '198.51.100.9')).toBeNull()
  })
})
