# シーケンスエンジンの設計（#26）

シーケンス型のテーマ（TCP、DNS、TLS 1.3、将来の HTTPS 全体像）を共通で扱うエンジンの型と仕様。docs/PLAN.md §4 の型スケッチを、この文書で置き換える。

## 全体像

```
content: Scenario<TOptions>（zod のスキーマ、optionDefs、buildSteps）
   ↓ toScenarioHandle（TOptions を消去）
engine:  ScenarioHandle.resolve(raw) → { options, steps }
   ↓ deriveState(actors, steps, index)
表示:    SequenceDiagram / StepControls / PacketInspector / ActorStatePanel / テーマ固有 UI（renderPanels）
```

## 型（src/engine/types.ts）

```ts
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

/** 表形式の状態（DNS リゾルバのキャッシュ、TLS の証明書チェーン検証結果など）。stateChange では表全体を置き換える */
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
```

### 型パラメータの消去（src/engine/scenario.ts）

`buildSteps: (o: TcpOptions) => …` は引数について反変なので、`Scenario<TcpOptions>` は `Scenario<ScenarioOptions>` に代入できない。registry で異なるテーマを並べるため、クロージャで `TOptions` を消去する（`as` は使わない）。メソッド記法の双変性に頼る方法は健全性の穴になるので採らない。

```ts
export function toScenarioHandle<TOptions extends ScenarioOptions>(
  scenario: Scenario<TOptions>,
): ScenarioHandle {
  return {
    id: scenario.id,
    title: scenario.title,
    actors: scenario.actors,
    optionDefs: scenario.optionDefs,
    resolve: (raw) => {
      const options = scenario.parseOptions(raw)
      return { options, steps: scenario.buildSteps(options) }
    },
  }
}
```

### プレイヤー（src/engine/player.ts）

```ts
export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

export interface PlayerState {
  readonly stepCount: number
  readonly stepIndex: number // 0 始まり。URL の ?step= は 1 始まりで変換する
  readonly isPlaying: boolean
  readonly speed: PlaybackSpeed
  /** null = 現在ステップの最新メッセージを表示する（明示的な選択なし） */
  readonly selectedMessageId: MessageId | null
}

export type PlayerAction =
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  | { readonly type: 'jump'; readonly stepIndex: number }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'tick' } // 自動再生のタイマーから。末尾で isPlaying = false
  | { readonly type: 'reset'; readonly stepCount: number } // オプション変更時（最初に戻す）
  | { readonly type: 'setSpeed'; readonly speed: PlaybackSpeed }
  | { readonly type: 'selectMessage'; readonly messageId: MessageId | null }
```

- next / prev / jump は `[0, stepCount - 1]` に丸める。ステップを移動したら `selectedMessageId` を null に戻す。再生中に next / prev / jump をしたら一時停止する
- 末尾で play したら先頭から再生する。tick が末尾に達したら `isPlaying = false`

## アクターの状態

- 状態はアクターごとの `Record<StateKey, StateValue>`。キーの枠（key / label / initial）は `Actor.stateSlots` で宣言する
  - TCP: `{ key: 'state', label: { en: 'TCP state', ja: 'TCP 状態' }, initial: 'CLOSED' }`
  - DNS リゾルバ: `{ key: 'cache', initial: { columns: ['NAME', 'TYPE', 'RDATA', 'TTL'], rows: [] } }`
  - TLS クライアント: `{ key: 'certChain', initial: { columns: ['Certificate', 'Signature', 'Validity', 'SAN'], rows: [...] } }` と `{ key: 'alert', initial: '-' }`（値は RFC 8446 のアラート名）
- `stateChange` は 1 キーを置き換える。表に行を足すときも、content 側で新しい表全体を作って渡す（行の追加イベントは作らない）
- スカラー値は ProtocolTerm のみ（RFC の用語で書ける。LocalizedText は許さない）
- ActorStatePanel: アクターごとのカード。`stateSlots` の順に表示し、スカラーは `<code>`、表は小さな `<table>`。`changedKeys` のキーは、背景の強調に加えて色以外の手段（記号と `sr-only` のテキスト）でも示す。表は前のステップにない行を強調する。前の値も見せたいときは `deriveState(…, stepIndex - 1)` をもう一度呼ぶ

## 時間

- 時間は `timer` イベントだけで表す。「`actorId` の `name` タイマーが `durationMs` 待って発火した」という意味
  - TCP の SYN ロス: 「RTO 満了、SYN を再送」のステップに `{ kind: 'timer', actorId: 'client', name: 'RTO', durationMs: 1000 }` と再送メッセージ（`retransmitOf: 'syn'`）を並べる。2 回目は 2000（RFC 6298 §5.5 の指数バックオフ）
  - DNS のタイムアウト: `name: 'timeout'` の後に別サーバへのクエリ
- 図の縦軸は時間に比例させない。シナリオに timer が 1 つでもあれば、経過時間を各行の左に「t = 1s」と小さく表示する。メッセージの伝搬遅延はモデル化しない
- 図の中のタイマーは、ライフライン上のアイコンと `RTO (1 s)` のラベルで描く。文言は辞書の関数で組み立て、秒数は `formatNumber` で整形する

## 暗号化区間とテーマ固有 UI

- `Message.encrypted` を ServerHello より後の TLS メッセージに付ける。鍵の種類は PacketField（`{ name: 'Protection', value: 'handshake_traffic_secret' }`）で示す。区間の帯は `Step.section` で付ける
- テーマ固有のデータは、`Step` に型パラメータを持たせず、アクターの状態スロット（`StateTable` など）として steps に載せる。テーマ固有 UI（CertChainPanel）はそれを読み、content 側の静的なデータ（証明書の subject・issuer・notAfter・SAN）と結合して描く
- 合成: `ScenarioPlayer` は `renderPanels?: (ctx: { derived: DerivedState; options: ScenarioOptions }) => ReactNode` と `hiddenStateKeys?: readonly StateKey[]`（汎用パネルで二重に表示しないため）を受け取る。engine は content の型を知らない

## シーケンス図（src/engine/diagram.ts、src/engine/ui/SequenceDiagram.tsx）

- 入力は `actors`・`steps`・`stepIndex`（丸める）・`selectedMessageId`・`onSelectMessage`。`DerivedState` はメッセージとタイマーを別々の配列に持ち、ステップ内の順序が失われるため使わない
- 行の単位は「メッセージかタイマー 1 件」（1 ステップに複数のメッセージがありうるため、ステップではない）。行は `diagramRows(steps, index)` で組み立て、各行に stepIndex とその時点の経過時間を付ける
- 現在のステップ（丸めた stepIndex）の行は強調し、#30 でアニメーションの対象にする
- メッセージは `role="button"` で、`aria-pressed` のトグル（もう一度押すと選択を解除して null を渡す）
- `Step.section` の帯は、TLS のシナリオ（Phase 2）で描く

## deriveState（src/engine/derive.ts）

`deriveState(actors, steps, index): DerivedState`

- `steps[0..index]` を含む。index は `[0, length - 1]` に丸める（負 → 0、超過 → 末尾、小数は切り捨て、NaN → 0）。steps が空なら `stepIndex: -1`、各状態は初期値、throw しない
- 「開始前」の特別な状態は作らない（TCP なら「サーバが LISTEN になる」を最初のステップにする）
- `messages`: 出現順に `{ ...message, stepIndex }`
- `resolveSelectedMessage(derived, id)`: id が見つからない（ステップを戻って消えた）か null なら、現在ステップの最後のメッセージ、それもなければ全体の最後のメッセージを返す
- `actorStates`: 初期値は `stateSlots`、stateChange で上書きする。`changedKeys` は表示ステップの stateChange のうち、値が実際に変わったものだけ（同じ値の再設定は含めない。表は列と行の文字列で比較する）
- 未宣言のキー・存在しないアクターへの stateChange は無視する（`validateScenario` で検出する）
- `timers` に stepIndex を付け、`elapsedMs` は含めた範囲の `durationMs` の合計
- 入力を変更しない純関数

テストケース:
1. 空の steps → `stepIndex: -1`、初期状態、messages / timers が空、elapsedMs 0
2. index の丸め（-5 → 0、99 → 末尾、1.7 → 1、NaN → 0）
3. messages が順に蓄積され、stepIndex が正しい。範囲外のステップのメッセージは含まれない
4. 初期値・上書き・changedKeys（現在ステップの変化のみ、同じ値の再設定は含まない）
5. 表の置き換え（行が増えれば changed、同じ内容なら unchanged）
6. elapsedMs と timers の stepIndex
7. 未宣言のキー・未知のアクターへの stateChange は無視される
8. 入力を凍結しても例外にならず、2 回呼んで結果が等しい

## シナリオの検証（src/engine/validate.ts）

ID の一意性などは型ではなく `validateScenario(handle): readonly ScenarioProblem[]`（純関数）で検査する。content の各テストと registry を走査するテストで `toEqual([])` を要求する。

- optionDefs の toggle と select の choices から、**全オプションの組み合わせ**を列挙して resolve し、それぞれで検査する
- 検査項目
  - actor id の一意性、step id の一意性、message id の一意性（全ステップ横断）
  - `from` / `to` が存在するアクターで、`from !== to`
  - `retransmitOf` が、それより前に出た message id を指す
  - stateChange の actorId が存在し、key が `stateSlots` で宣言されていて、値の種類（スカラーか表か）が initial と一致する。表の各行の長さが columns と一致する
  - steps が 1 つ以上ある
  - `parseOptions({})` の結果が各 def の `defaultValue` と一致し、toggle の `'1'` → true・`'0'` → false、select の各 choice がそのまま通る（zod スキーマと optionDefs のずれの検出）
- `collectLocalizedTexts(handle)` を別関数にし、翻訳の網羅テスト（#39）からも使う
- `ScenarioProblem` は `{ readonly path: string; readonly message: string }`（開発者向けなので英語の文字列でよい）

## What-if オプションと URL

- `TOptions` は content の zod スキーマから `z.infer` で得る。キーごとに `.catch(デフォルト値)` を付け、不正な値はデフォルトに戻す
  - toggle: `z.stringbool().catch(false)`（URL は `'1'` / `'0'`）
  - select: `z.enum([...]).catch('open')`
- URL: `?step=`（1 始まり）と `opt.<key>=<value>`。デフォルト値と同じオプションは URL から省く
- オプションを変えたら、プレイヤーを最初のステップに戻す（`reset`）

## シナリオの記述例（TCP、抜粋）

```ts
// 根拠: RFC 9293 §3.5（Basic 3-Way Handshake）, §3.3.2（状態機械）, RFC 6298 §2.1（初期 RTO = 1 s）
const optionsSchema = z.object({
  synLost: z.stringbool().catch(false),
  serverPort: z.enum(['open', 'closed']).catch('open'),
})
export type TcpOptions = z.infer<typeof optionsSchema>

export const tcpHandshakeScenario: Scenario<TcpOptions> = {
  id: 'tcp-handshake',
  title: { en: 'TCP three-way handshake', ja: 'TCP 3 ウェイハンドシェイク' },
  actors,
  optionDefs: {
    synLost: { kind: 'toggle', label: { en: 'Lose the first SYN', ja: '最初の SYN をロスさせる' }, defaultValue: false },
    serverPort: {
      kind: 'select',
      label: { en: 'Server port', ja: 'サーバーのポート' },
      choices: [
        { value: 'open', label: { en: 'Open (LISTEN)', ja: '開いている（LISTEN）' } },
        { value: 'closed', label: { en: 'Closed', ja: '閉じている' } },
      ],
      defaultValue: 'open',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps, // 分岐は buildSteps の中で素の if で書く。再送は { ...syn, id: 'syn-rtx', retransmitOf: syn.id }
}
```

registry には `toScenarioHandle(tcpHandshakeScenario)` を登録する。

## シナリオの合成（HTTPS 全体像、Phase 3）

- `ScenarioHandle` のレベルで合成する（`composeScenarios({ parts: [{ prefix: 'dns', handle, actorMap }, …] })`）
- step id・message id・`retransmitOf`・オプションのキー・状態のキーにプレフィックスを付け、アクターは `actorMap` で寄せる。`section` に各パートのタイトルを入れる
- すべて文字列の id とキーなので、engine の型の変更は不要。アクター id は全テーマで `client` などを共通に使う
- TCP の seq と TLS／HTTP のバイト数の連続性まではモデル化しない

## PLAN §4 からの主な変更点

| 変更 | 理由 |
|---|---|
| `MessageStatus` から `retransmit` を外し、`Message.retransmitOf` を追加。`ok` → `delivered` | 再送メッセージ自体がロスすることがある。再送は配送結果ではなく、元メッセージへの参照 |
| `stateChange` の値を `ProtocolTerm \| StateTable` にし、`Actor.stateSlots` を追加 | DNS のキャッシュ表を表現する。ラベルを翻訳可能にし、初期値から安定して表示する |
| `note` イベントを削除 | Step.description・stateChange・timer で足りる |
| `timer` を `{ name: ProtocolTerm; durationMs }` に | 「RTO (1 s)」は辞書と Intl で組み立てられる |
| `Message.encrypted`・`Message.description`・`Step.section` を追加 | TLS の暗号化区間、インスペクタ単体での説明、区間の帯 |
| `ActorKind` を 4 種類に（`ca`・`network` を削除） | CA はハンドシェイクの参加者ではない。ロスは矢印上の × で表す |
| `optionDefs` を TOptions のキーのマップに、`defaultOptions` を削除 | キーの過不足・種類の不一致・綴りの誤りを型エラーにする。デフォルトは各 def に一本化 |
| `parseOptions` の引数を `RawOptionValues` に | URL の分解はエンジンの責務 |
| `Scenario<TOptions>` と `ScenarioHandle` に分離 | 反変性のため、異なるテーマを同じ型で並べられない |
| `PlayerStatus` → `isPlaying` + `stepCount` | finished は stepIndex から導出できる |
