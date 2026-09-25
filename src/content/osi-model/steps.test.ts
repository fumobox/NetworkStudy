// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { OSI_LAYERS } from './layers'
import { OSI_STEPS, UNIT_IDS } from './steps'

const sender = OSI_STEPS.filter((step) => step.side === 'sender')
const receiver = OSI_STEPS.filter((step) => step.side === 'receiver')

describe('OSI 参照モデルのステップ', () => {
  it('送信側は第 7 層から第 1 層へ、受信側は第 1 層から第 7 層へ、すべての層を 1 回ずつ通る', () => {
    expect(sender.flatMap((step) => step.layers)).toEqual([7, 6, 5, 4, 3, 2, 1])
    expect(receiver.flatMap((step) => step.layers)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(OSI_STEPS.map((step) => step.side)).toEqual([
      ...sender.map(() => 'sender'),
      ...receiver.map(() => 'receiver'),
    ])
  })

  it('送信側で付けたものを、受信側は逆の順に外す（往路と復路が対称）', () => {
    const added = sender.flatMap((step) => step.changed)
    // 受信側の第 7 層の changed は「アプリケーションに渡った」ことの強調で、外すものではない
    const removed = receiver.flatMap((step) =>
      step.changed.filter((unit) => !step.stack.includes(unit)),
    )
    expect(added).toEqual(['http', 'tcp', 'ip', 'eth', 'fcs'])
    expect(removed).toEqual(['eth', 'fcs', 'ip', 'tcp'])
    // 各層で、送信側がその層を通った後に運んでいるものを、受信側はその層に来たときに受け取る
    for (const layer of OSI_LAYERS) {
      const sent = sender.find((step) => step.layers.includes(layer.number))
      const index = OSI_STEPS.findIndex(
        (step) => step.side === 'receiver' && step.layers.includes(layer.number),
      )
      expect(OSI_STEPS[index - 1]?.stack, `layer ${String(layer.number)}`).toEqual(sent?.stack)
    }
  })

  it('各ステップで運ばれているものは、前のステップに付いた／外れたものの分だけ変わる', () => {
    OSI_STEPS.forEach((step, index) => {
      const before = index === 0 ? [] : (OSI_STEPS[index - 1]?.stack ?? [])
      const expected =
        step.side === 'sender'
          ? UNIT_IDS.filter((unit) => before.includes(unit) || step.changed.includes(unit))
          : before.filter((unit) => !step.changed.includes(unit) || step.id === 'receive-7')
      expect(step.stack, step.id).toEqual(expected)
    })
  })

  it('フレームの中の並びは Ethernet、IP、TCP、データ、FCS', () => {
    expect(OSI_STEPS.find((step) => step.id === 'send-2')?.stack).toEqual([
      'eth',
      'ip',
      'tcp',
      'http',
      'fcs',
    ])
  })

  it('物理層だけが信号として運ばれる', () => {
    expect(OSI_STEPS.filter((step) => step.onWire).flatMap((step) => step.layers)).toEqual([1, 1])
  })

  it('7 層のデータは上から順で、TCP/IP の 4 層に対応する', () => {
    expect(OSI_LAYERS.map((layer) => [layer.number, layer.tcpIp])).toEqual([
      [7, 'application'],
      [6, 'application'],
      [5, 'application'],
      [4, 'transport'],
      [3, 'internet'],
      [2, 'link'],
      [1, 'link'],
    ])
  })
})
