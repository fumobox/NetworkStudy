import type { LocalizedText } from '@/lib/i18n/locale'

// ---------- 用語・ID ----------

/**
 * 翻訳しないプロトコル用語・値（SYN, ClientHello, QNAME, SYN_SENT, "1000" …）。
 * 型が LocalizedText なら翻訳する、ProtocolTerm なら翻訳しない。
 * ブランド型にすると `as` か生成関数が必要になるため string の別名にとどめる。
 */
export type ProtocolTerm = string

export type ActorId = string
export type MessageId = string
export type StepId = string
/** アクター状態のキー（'state', 'cache' …）。ラベルは ActorStateSlot が持つ */
export type StateKey = string

// ---------- アクター ----------

/** 図のアイコン・色分けにだけ使う */
export const ACTOR_KINDS = ['client', 'server', 'resolver', 'nameServer'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

/** 表形式の状態（DNS リゾルバーのキャッシュ、TLS の証明書チェーン検証結果など）。stateChange では表全体を置き換える */
export interface StateTable {
  readonly columns: readonly ProtocolTerm[]
  readonly rows: readonly (readonly ProtocolTerm[])[]
}
export type StateValue = ProtocolTerm | StateTable

/** アクターが持つ状態の枠。ActorStatePanel はこの順に表示し、初期値から始める */
export interface ActorStateSlot {
  readonly key: StateKey
  readonly label: LocalizedText
  readonly initial: StateValue
}

export interface Actor {
  readonly id: ActorId
  readonly kind: ActorKind
  readonly name: LocalizedText
  /** 幅が足りないとき（DNS の 5 アクター、モバイル）に使う短い表示名 */
  readonly shortName?: LocalizedText
  /** 状態を持たないアクター（DNS のルート・TLD など）は [] */
  readonly stateSlots: readonly ActorStateSlot[]
}

// ---------- メッセージ ----------

/** delivered: 到達 / lost: 途中で消失（× を途中に描く） / rejected: 到達したが受信側が処理を拒否（矢先に ✗） */
export const MESSAGE_STATUSES = ['delivered', 'lost', 'rejected'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export interface PacketField {
  readonly name: ProtocolTerm
  readonly value: ProtocolTerm
  readonly description?: LocalizedText
  readonly highlight?: boolean
}

export interface Message {
  readonly id: MessageId
  readonly from: ActorId
  readonly to: ActorId
  readonly label: ProtocolTerm
  readonly status: MessageStatus
  readonly fields: readonly PacketField[]
  /** PacketInspector の見出し用 */
  readonly description?: LocalizedText
  /** 再送。元メッセージの id を指す（図では破線 + 再送マーク） */
  readonly retransmitOf?: MessageId
  /** TLS の暗号化されたレコード。図では鍵アイコン、インスペクタに「学習用に中身を表示している」注記 */
  readonly encrypted?: boolean
}

// ---------- ステップ ----------

export interface SendMessageEvent {
  readonly kind: 'message'
  readonly message: Message
}
/** アクター状態の 1 キーを置き換える。表は行の追加ではなく表全体を渡す */
export interface StateChangeEvent {
  readonly kind: 'stateChange'
  readonly actorId: ActorId
  readonly key: StateKey
  readonly value: StateValue
}
/** 名前付きタイマーが durationMs 待って発火した（RTO、DNS のクエリタイムアウトなど） */
export interface TimerEvent {
  readonly kind: 'timer'
  readonly actorId: ActorId
  readonly name: ProtocolTerm
  readonly durationMs: number
}
export type StepEvent = SendMessageEvent | StateChangeEvent | TimerEvent

export interface Step {
  readonly id: StepId
  readonly title: LocalizedText
  readonly description: LocalizedText
  readonly events: readonly StepEvent[]
  /** 連続する同じ section のステップを図の帯としてまとめる（TLS の暗号化区間、HTTPS 合成の区分） */
  readonly section?: LocalizedText
}

// ---------- What-if オプション ----------

export type OptionValue = string | boolean
export type ScenarioOptions = Readonly<Record<string, OptionValue>>
/** URL の `opt.<key>=<value>` から `opt.` を外したもの。値の検証は Scenario.parseOptions が行う */
export type RawOptionValues = Readonly<Record<string, string>>

export interface ToggleOptionDef {
  readonly kind: 'toggle'
  readonly label: LocalizedText
  readonly description?: LocalizedText
  readonly defaultValue: boolean
}
export interface SelectChoice<TValue extends string = string> {
  readonly value: TValue
  readonly label: LocalizedText
}
export interface SelectOptionDef<TValue extends string = string> {
  readonly kind: 'select'
  readonly label: LocalizedText
  readonly description?: LocalizedText
  readonly choices: readonly SelectChoice<TValue>[]
  readonly defaultValue: TValue
}
/** boolean のオプションは toggle、文字列リテラルのユニオンは select（choices / defaultValue もその型に固定） */
export type ScenarioOptionDef<TValue extends OptionValue = OptionValue> = [TValue] extends [boolean]
  ? ToggleOptionDef
  : [TValue] extends [string]
    ? SelectOptionDef<TValue & string>
    : ToggleOptionDef | SelectOptionDef

/** TOptions のキーと 1:1 で対応するフォーム定義（キーの欠落・余剰・種別の不一致が型エラーになる） */
export type ScenarioOptionDefs<TOptions extends ScenarioOptions> = {
  readonly [K in keyof TOptions]: ScenarioOptionDef<TOptions[K]>
}

// ---------- シナリオ ----------

/** content が定義する型。TOptions は zod スキーマから z.infer で得る */
export interface Scenario<TOptions extends ScenarioOptions> {
  readonly id: string
  readonly title: LocalizedText
  readonly actors: readonly Actor[]
  readonly optionDefs: ScenarioOptionDefs<TOptions>
  /** zod で検証。不正・未指定の値はキーごとにデフォルトへ戻す（throw しない） */
  readonly parseOptions: (raw: RawOptionValues) => TOptions
  /** 純関数・ロケール非依存。同じ options なら同じ Step[] */
  readonly buildSteps: (options: TOptions) => readonly Step[]
}

export interface ResolvedScenario {
  readonly options: ScenarioOptions
  readonly steps: readonly Step[]
}
/** TOptions を消去したシナリオ。registry・ThemePage・網羅テストなど、複数シナリオを同じ型で扱う場所で使う */
export interface ScenarioHandle {
  readonly id: string
  readonly title: LocalizedText
  readonly actors: readonly Actor[]
  readonly optionDefs: ScenarioOptionDefs<ScenarioOptions>
  readonly resolve: (raw: RawOptionValues) => ResolvedScenario
}

// ---------- 導出 ----------

export interface DerivedMessage extends Message {
  readonly stepIndex: number
}
export interface DerivedTimer extends TimerEvent {
  readonly stepIndex: number
}
export interface ActorStateSnapshot {
  readonly values: Readonly<Record<StateKey, StateValue>>
  /** 表示中のステップで値が実際に変わったキー */
  readonly changedKeys: readonly StateKey[]
}
export interface DerivedState {
  /** 実際に適用した最後のステップ（丸め後）。steps が空なら -1 */
  readonly stepIndex: number
  readonly messages: readonly DerivedMessage[]
  readonly timers: readonly DerivedTimer[]
  readonly actorStates: Readonly<Record<ActorId, ActorStateSnapshot>>
  /** timer の durationMs の累計 */
  readonly elapsedMs: number
}
