import { useText } from '@/lib/i18n'
import type { Actor, ActorId } from '../types'

/** アクター id から、現在のロケールの表示名を引く関数を返す（見つからなければ id をそのまま返す） */
export function useActorName(actors: readonly Actor[]): (actorId: ActorId) => string {
  const t = useText()
  return (actorId) => {
    const actor = actors.find((candidate) => candidate.id === actorId)
    return actor === undefined ? actorId : t(actor.name)
  }
}
