/** オブジェクトを再帰的に readonly にする。関数はそのまま残す */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : { readonly [K in keyof T]: DeepReadonly<T[K]> }
