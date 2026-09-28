import type { Quiz } from '@/components/features/quiz/types'

/** DNSSEC の理解度クイズ（根拠は scenario.ts の RFC 4033・RFC 4034・RFC 4035・RFC 6840 の参照と同じ） */
export const dnssecQuiz: Quiz = {
  id: 'dnssec',
  questions: [
    {
      id: 'ds',
      prompt: {
        en: 'Where does the DS record for example.com live, and what does it contain?',
        ja: 'example.com の DS レコードはどこにあり、何が入っている？',
      },
      choices: [
        {
          id: 'child-zsk',
          text: {
            en: 'In the example.com zone: its zone-signing key',
            ja: 'example.com のゾーンに。そのゾーン署名鍵',
          },
        },
        {
          id: 'parent-hash',
          text: {
            en: 'In the parent zone com.: a hash of example.com’s key-signing key',
            ja: '親のゾーン com. に。example.com の鍵署名鍵のハッシュ',
          },
        },
        {
          id: 'root-sig',
          text: {
            en: 'In the root zone: the signature of the A record',
            ja: 'ルートゾーンに。A レコードの署名',
          },
        },
      ],
      answerId: 'parent-hash',
      explanation: {
        en: 'The DS is published by the parent and signed with the parent’s key. It holds a digest of the child’s key (by convention the KSK), so the parent vouches for the child’s key: that is one link of the chain of trust.',
        ja: 'DS は親が公開し、親の鍵で署名する。子の鍵（慣習として KSK）のダイジェストを持つので、親が子の鍵を保証する。これが信頼の連鎖の 1 つのつながり。',
      },
    },
    {
      id: 'ad',
      prompt: {
        en: 'The resolver validated the answer. How does your PC know?',
        ja: 'リゾルバーが答えを検証した。PC はどうやってそれを知る？',
      },
      choices: [
        {
          id: 'rcode',
          text: { en: 'The RCODE is NOERROR', ja: 'RCODE が NOERROR になっている' },
        },
        {
          id: 'encrypted',
          text: { en: 'The response is encrypted', ja: '応答が暗号化されている' },
        },
        {
          id: 'ad',
          text: {
            en: 'The AD bit is set in the response (when the PC asked with AD or DO)',
            ja: '応答に AD ビットが立っている（PC が AD か DO を立てて問い合わせたとき）',
          },
        },
      ],
      answerId: 'ad',
      explanation: {
        en: 'AD (authentic data) means every RRset in the answer was validated. A validating resolver sets it only when the query had AD or DO. NOERROR is also returned for unsigned zones, and DNSSEC encrypts nothing.',
        ja: 'AD（認証されたデータ）は、答えのすべての RRset を検証できたという意味。検証するリゾルバーは、問い合わせに AD か DO があったときだけ立てる。NOERROR は署名のないゾーンでも返り、DNSSEC は何も暗号化しない。',
      },
    },
    {
      id: 'bogus',
      prompt: {
        en: 'The RRSIG on the A record does not match the data, and the PC did not set CD. What does the resolver return?',
        ja: 'A レコードの RRSIG がデータと合わず、PC は CD を立てていない。リゾルバーは何を返す？',
      },
      choices: [
        {
          id: 'no-ad',
          text: { en: 'The record, without AD', ja: 'レコードを、AD なしで' },
        },
        { id: 'nxdomain', text: { en: 'NXDOMAIN', ja: 'NXDOMAIN' } },
        { id: 'servfail', text: { en: 'SERVFAIL', ja: 'SERVFAIL' } },
        {
          id: 'retry',
          text: {
            en: 'It asks the root again and returns whatever comes back',
            ja: 'ルートにもう一度聞き、返ってきたものを返す',
          },
        },
      ],
      answerId: 'servfail',
      explanation: {
        en: 'The answer is Bogus, so the resolver must not hand it out: it returns SERVFAIL. Only if the PC set CD (checking disabled) would it return the data, without AD, for the PC to check itself. NXDOMAIN would falsely say the name does not exist.',
        ja: '答えは Bogus（偽物）なので、リゾルバーは渡してはいけない。SERVFAIL を返す。PC が CD（検証しない）を立てていたときだけ、PC が自分で確かめられるよう、データを AD なしで返す。NXDOMAIN では、名前が存在しないという誤った答えになる。',
      },
    },
    {
      id: 'not-provided',
      prompt: {
        en: 'Which of these does DNSSEC not do?',
        ja: 'DNSSEC がしないのはどれ？',
      },
      choices: [
        {
          id: 'integrity',
          text: {
            en: 'Prove that an answer was not altered',
            ja: '答えが書き換えられていないことを証明する',
          },
        },
        {
          id: 'confidentiality',
          text: {
            en: 'Hide the question and the answer from someone on the path',
            ja: '経路の途中の人から、問い合わせと答えを隠す',
          },
        },
        {
          id: 'denial',
          text: {
            en: 'Prove that a name or a record does not exist',
            ja: '名前やレコードが存在しないことを証明する',
          },
        },
      ],
      answerId: 'confidentiality',
      explanation: {
        en: 'DNSSEC signs data; it does not encrypt anything. Integrity and origin, and the non-existence of names (with NSEC or NSEC3), are proven. To hide DNS traffic between your PC and the resolver, use DNS over TLS or HTTPS.',
        ja: 'DNSSEC はデータに署名するが、何も暗号化しない。完全性と出どころ、名前が存在しないこと（NSEC や NSEC3 で）は証明する。PC とリゾルバーの間の DNS の通信を隠すには、DNS over TLS や HTTPS を使う。',
      },
    },
  ],
}
