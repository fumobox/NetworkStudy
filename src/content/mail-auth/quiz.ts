import type { Quiz } from '@/components/features/quiz/types'

/** メールの送信ドメイン認証の理解度クイズ（根拠は scenario.ts の RFC 7208・RFC 6376・RFC 9989 などの参照と同じ） */
export const mailAuthQuiz: Quiz = {
  id: 'mail-auth',
  questions: [
    {
      id: 'spf-identity',
      prompt: {
        en: 'Which domain does SPF check?',
        ja: 'SPF が確かめるのは、どのドメイン？',
      },
      choices: [
        {
          id: 'from',
          text: {
            en: 'The domain in the From: line the reader sees',
            ja: '読む人が見る From: の行のドメイン',
          },
        },
        {
          id: 'mail-from',
          text: {
            en: 'The domain of the envelope sender (MAIL FROM), against the connecting IP address',
            ja: 'エンベロープの送信者（MAIL FROM）のドメインを、接続元の IP アドレスに照らして',
          },
        },
        {
          id: 'reply-to',
          text: { en: 'The domain in Reply-To:', ja: 'Reply-To: のドメイン' },
        },
      ],
      answerId: 'mail-from',
      explanation: {
        en: 'SPF looks up the SPF record of the MAIL FROM domain (and can also check the HELO name) and asks whether the connecting address is listed. It never looks at From:, which is why DMARC adds the alignment check.',
        ja: 'SPF は MAIL FROM のドメインの SPF のレコードを引き（HELO の名前も確かめられる）、接続元のアドレスが載っているかを問う。From: は見ない。だから DMARC がアライメントの確認を加える。',
      },
    },
    {
      id: 'dkim-key',
      prompt: {
        en: 'A message is signed with d=example.com; s=s1. Where does the receiver find the public key?',
        ja: 'メッセージは d=example.com; s=s1 で署名されている。受信サーバーは公開鍵をどこで見つける？',
      },
      choices: [
        {
          id: 'domainkey',
          text: {
            en: 'In the TXT record at s1._domainkey.example.com',
            ja: 's1._domainkey.example.com の TXT レコード',
          },
        },
        {
          id: 'dmarc',
          text: {
            en: 'In the TXT record at _dmarc.example.com',
            ja: '_dmarc.example.com の TXT レコード',
          },
        },
        {
          id: 'mx',
          text: { en: 'In the MX record of example.com', ja: 'example.com の MX レコード' },
        },
      ],
      answerId: 'domainkey',
      explanation: {
        en: 'The key’s name is the selector, then _domainkey, then the signing domain from d=. Selectors let a domain publish several keys and rotate them.',
        ja: '鍵の名前は、セレクター、_domainkey、d= の署名したドメインの順につなげたもの。セレクターがあるので、ドメインは複数の鍵を公開し、入れ替えられる。',
      },
    },
    {
      id: 'forwarding',
      prompt: {
        en: 'A server forwards a message without changing it or its envelope sender. The sender’s SPF record ends in -all. What happens at the final receiver?',
        ja: 'サーバーが、メッセージもエンベロープの送信者も変えずに転送した。送信元の SPF のレコードは -all で終わる。最終的な受信サーバーではどうなる？',
      },
      choices: [
        {
          id: 'dkim-fails',
          text: { en: 'DKIM fails, SPF passes', ja: 'DKIM は fail、SPF は pass' },
        },
        { id: 'both-fail', text: { en: 'Both fail', ja: 'どちらも fail' } },
        {
          id: 'spf-fails',
          text: {
            en: 'SPF fails, because the forwarder is not in the sender’s record; DKIM still passes',
            ja: '転送サーバーが送信元のレコードに載っていないので SPF は fail。DKIM は pass のまま',
          },
        },
      ],
      answerId: 'spf-fails',
      explanation: {
        en: 'SPF is about the connecting server, and that is now the forwarder. DKIM is about the message itself, which did not change. With an aligned DKIM pass, DMARC still passes.',
        ja: 'SPF は接続してきたサーバーについての確認で、それは今や転送サーバー。DKIM はメッセージそのものについての確認で、メッセージは変わっていない。アラインした DKIM の pass があるので、DMARC も pass する。',
      },
    },
    {
      id: 'alignment',
      prompt: {
        en: 'SPF passed for list-bounces@example.org, the From: is alice@example.com, and DKIM failed. What is the DMARC result for example.com?',
        ja: 'SPF は list-bounces@example.org で pass、From: は alice@example.com、DKIM は fail。example.com の DMARC の結果は？',
      },
      choices: [
        {
          id: 'pass',
          text: { en: 'pass, because SPF passed', ja: 'SPF が pass したので pass' },
        },
        {
          id: 'fail',
          text: {
            en: 'fail: the passing identifier is not aligned with the From domain',
            ja: 'fail。pass した識別子が From のドメインとアラインしていない',
          },
        },
        {
          id: 'none',
          text: {
            en: 'pass if the policy is p=none',
            ja: 'ポリシーが p=none なら pass',
          },
        },
      ],
      answerId: 'fail',
      explanation: {
        en: 'DMARC needs an SPF or DKIM pass for a domain aligned with the From domain. example.org has nothing to do with example.com, so its SPF pass counts for nothing. The policy (p=) only says what to do after the result is fail; it does not change the result.',
        ja: 'DMARC には、From のドメインとアラインしたドメインでの SPF か DKIM の pass が要る。example.org は example.com と関係がないので、その SPF の pass は何の役にも立たない。ポリシー（p=）は、結果が fail になった後どうするかを決めるだけで、結果は変えない。',
      },
    },
  ],
}
