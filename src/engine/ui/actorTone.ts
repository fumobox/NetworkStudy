import type { Tone } from '@/lib/tone'
import type { ActorKind } from '../types'

/**
 * アクターの種類ごとの色（シーケンス図の見出しとライフライン、状態パネルの印）。
 * 同じ図に並ぶ種類の色が重ならないようにしている（nameServer と router は同じ図に出てこない）
 */
export const ACTOR_TONE: Readonly<Record<ActorKind, Tone>> = {
  client: 'blue',
  server: 'violet',
  resolver: 'teal',
  nameServer: 'amber',
  router: 'green',
}
