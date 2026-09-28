// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  addressFields,
  frameControl,
  hex,
  isGroupAddress,
  isLocallyAdministered,
  type FrameFlags,
  type FrameKind,
} from './frame'

describe('Frame Control（IEEE Std 802.11-2024 9.2.4.1）', () => {
  it.each<[FrameKind, FrameFlags, string]>([
    ['beacon', {}, '0x80 0x00'],
    ['probeRequest', {}, '0x40 0x00'],
    ['probeResponse', {}, '0x50 0x00'],
    ['authentication', {}, '0xb0 0x00'],
    ['associationRequest', {}, '0x00 0x00'],
    ['associationResponse', {}, '0x10 0x00'],
    ['deauthentication', {}, '0xc0 0x00'],
    ['rts', {}, '0xb4 0x00'],
    ['cts', {}, '0xc4 0x00'],
    ['ack', {}, '0xd4 0x00'],
    ['data', {}, '0x08 0x00'],
    ['data', { toDs: true }, '0x08 0x01'],
    ['data', { fromDs: true }, '0x08 0x02'],
    ['data', { toDs: true, protected: true }, '0x08 0x41'],
    ['data', { fromDs: true, protected: true }, '0x08 0x42'],
    ['data', { toDs: true, protected: true, retry: true }, '0x08 0x49'],
  ])('%s %o は %s', (kind, flags, expected) => {
    expect(hex(frameControl(kind, flags))).toBe(expected)
  })
})

describe('アドレスの並び（9.3.2.1）', () => {
  const roles = { da: 'DA', sa: 'SA', bssid: 'BSSID' }
  const names = (direction: 'none' | 'toDs' | 'fromDs') =>
    addressFields(direction, roles).map((field) => `${field.name}=${field.value}`)

  it('ToDS=0、FromDS=0 は DA、SA、BSSID', () => {
    expect(names('none')).toEqual([
      'Address 1 (DA)=DA',
      'Address 2 (SA)=SA',
      'Address 3 (BSSID)=BSSID',
    ])
  })

  it('ToDS=1 は BSSID、SA、DA', () => {
    expect(names('toDs')).toEqual([
      'Address 1 (BSSID)=BSSID',
      'Address 2 (SA)=SA',
      'Address 3 (DA)=DA',
    ])
  })

  it('FromDS=1 は DA、BSSID、SA', () => {
    expect(names('fromDs')).toEqual([
      'Address 1 (DA)=DA',
      'Address 2 (BSSID)=BSSID',
      'Address 3 (SA)=SA',
    ])
  })
})

describe('MAC アドレスのビット', () => {
  it('I/G と U/L を読む', () => {
    expect(isGroupAddress('ff:ff:ff:ff:ff:ff')).toBe(true)
    expect(isGroupAddress('00:00:5e:00:53:01')).toBe(false)
    expect(isLocallyAdministered('00:00:5e:00:53:01')).toBe(false)
    expect(isLocallyAdministered('a2:4f:21:9c:0e:3b')).toBe(true)
    expect(isGroupAddress('a2:4f:21:9c:0e:3b')).toBe(false)
  })
})
