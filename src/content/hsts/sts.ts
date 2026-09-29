/**
 * Strict-Transport-Security の解析（RFC 6797 §6.1）
 *
 * 構文: [ directive ] *( ";" [ directive ] )、directive = directive-name [ "=" directive-value ]、値は token か quoted-string。
 * RFC 2616 の「暗黙の LWS」があるので、; と = の前後の空白は許される。
 * 1. 順不同 2. どのディレクティブも 1 回だけ（2 回あれば全体が不正）3. 名前は大文字小文字を区別しない
 * 4. 構文に合わないヘッダーは全体を無視する 5. 知らないディレクティブは無視し、ほかは処理する
 * §6.1.1: max-age は必須で、値は 1 桁以上の数字（quoted-string でもよい）。§6.1.2: includeSubDomains は値を持たない
 * （値の付いた includeSubDomains は不正とするのは、このページの §6.1.2 の読み方）。preload は RFC 6797 にはないので、知らない
 * ディレクティブとして無視される
 */

export type StsParseResult =
  | {
      readonly ok: true
      readonly maxAge: number
      readonly includeSubDomains: boolean
      /** 知らないディレクティブの名前（小文字） */
      readonly unknown: readonly string[]
    }
  | { readonly ok: false; readonly reason: string }

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** ; で区切る。quoted-string の中の ; では区切らない */
function splitDirectives(value: string): string[] | null {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    const c = value[i] ?? ''
    if (quoted) {
      current += c
      if (c === '\\') {
        current += value[i + 1] ?? ''
        i++
      } else if (c === '"') {
        quoted = false
      }
    } else if (c === '"') {
      quoted = true
      current += c
    } else if (c === ';') {
      parts.push(current)
      current = ''
    } else {
      current += c
    }
  }
  if (quoted) {
    return null
  }
  parts.push(current)
  return parts
}

function unquote(value: string): string | null {
  if (!value.startsWith('"')) {
    return TOKEN.test(value) ? value : null
  }
  if (value.length < 2 || !value.endsWith('"')) {
    return null
  }
  return value.slice(1, -1).replace(/\\(.)/g, '$1')
}

export function parseStrictTransportSecurity(value: string): StsParseResult {
  const parts = splitDirectives(value)
  if (parts === null) {
    return { ok: false, reason: 'unterminated quoted-string' }
  }
  const seen = new Set<string>()
  const unknown: string[] = []
  let maxAge: number | undefined
  let includeSubDomains = false
  for (const raw of parts) {
    const part = raw.trim()
    if (part === '') {
      continue
    }
    const eq = part.indexOf('=')
    const name = (eq === -1 ? part : part.slice(0, eq)).trim()
    const rawValue = eq === -1 ? undefined : part.slice(eq + 1).trim()
    if (!TOKEN.test(name)) {
      return { ok: false, reason: `invalid directive name: ${name}` }
    }
    const key = name.toLowerCase()
    if (seen.has(key)) {
      return { ok: false, reason: `duplicate directive: ${key}` }
    }
    seen.add(key)
    const directiveValue = rawValue === undefined ? undefined : unquote(rawValue)
    if (directiveValue === null) {
      return { ok: false, reason: `invalid value for ${key}` }
    }
    if (key === 'max-age') {
      if (directiveValue === undefined || !/^[0-9]+$/.test(directiveValue)) {
        return { ok: false, reason: 'max-age must be digits' }
      }
      maxAge = Number.parseInt(directiveValue, 10)
    } else if (key === 'includesubdomains') {
      if (directiveValue !== undefined) {
        return { ok: false, reason: 'includeSubDomains takes no value' }
      }
      includeSubDomains = true
    } else {
      unknown.push(key)
    }
  }
  if (maxAge === undefined) {
    return { ok: false, reason: 'max-age is required' }
  }
  return { ok: true, maxAge, includeSubDomains, unknown }
}
