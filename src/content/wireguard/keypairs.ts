/**
 * 鍵の組の入れ替え（ホワイトペーパー §5.4.9、§6.3、Linux の drivers/net/wireguard/noise.c の add_new_keypair と
 * wg_noise_received_with_keypair）。ピアは previous・current・next の 3 つの枠を持つ。
 * - ハンドシェイクを始めた側は、応答を受け取るとすぐ新しい鍵の組を current にし、元の current を previous にする
 * - 応じた側は、新しい鍵の組を next に置く（相手が本当に鍵を持っているかは、まだわからない）。previous は捨てる。
 *   相手からその鍵の組で最初のデータを受け取ると（鍵の確認）、next を current に、元の current を previous にする
 */

export interface KeypairSlots {
  readonly previous: string | null
  readonly current: string | null
  readonly next: string | null
}

export const EMPTY_SLOTS: KeypairSlots = { previous: null, current: null, next: null }

export function initiatorAdds(slots: KeypairSlots, keypair: string): KeypairSlots {
  // 確認を待つ next があれば、それを previous にし、current は捨てる（Linux の add_new_keypair）
  return slots.next !== null
    ? { previous: slots.next, current: keypair, next: null }
    : { previous: slots.current, current: keypair, next: null }
}

export function responderAdds(slots: KeypairSlots, keypair: string): KeypairSlots {
  return { previous: null, current: slots.current, next: keypair }
}

/** その鍵の組でデータを受け取った。next の鍵の組なら確認できたので current にする */
export function receivedWith(slots: KeypairSlots, keypair: string): KeypairSlots {
  return slots.next === keypair ? { previous: slots.current, current: keypair, next: null } : slots
}

/** 受け取ったデータを復号できる鍵の組か */
export function canReceive(slots: KeypairSlots, keypair: string): boolean {
  return slots.previous === keypair || slots.current === keypair || slots.next === keypair
}

export const KEYPAIR_COLUMNS = ['Slot', 'Keypair'] as const

export function slotRows(slots: KeypairSlots): readonly (readonly string[])[] {
  return [
    ['previous', slots.previous ?? '-'],
    ['current', slots.current ?? '-'],
    ['next', slots.next ?? '-'],
  ]
}
