import type { Quiz } from '@/components/features/quiz/types'

/** DNS の名前解決の理解度クイズ（根拠は scenario.ts の RFC 参照と同じ） */
export const dnsResolutionQuiz: Quiz = {
  id: 'dns-resolution',
  questions: [
    {
      id: 'stub-asks',
      prompt: {
        en: 'Where does the stub resolver in your PC send its query?',
        ja: 'PC のスタブリゾルバーは、問い合わせをどこに送る？',
      },
      choices: [
        {
          id: 'resolver',
          text: { en: 'To a full-service resolver', ja: 'フルサービスリゾルバー' },
        },
        { id: 'root', text: { en: 'To a root server', ja: 'ルートサーバー' } },
        { id: 'tld', text: { en: 'To the .com TLD server', ja: '.com の TLD サーバー' } },
        { id: 'auth', text: { en: 'To the authoritative server', ja: '権威サーバー' } },
      ],
      answerId: 'resolver',
      explanation: {
        en: 'The stub resolver sends a recursive query (RD set) to the resolver it is configured to use, and lets that resolver do the rest of the work.',
        ja: 'スタブリゾルバーは、設定されているリゾルバーに再帰問い合わせ（RD あり）を送り、残りの仕事はそのリゾルバーに任せる。',
      },
    },
    {
      id: 'root-reply',
      prompt: {
        en: 'What does a root server return when asked for www.example.com?',
        ja: 'www.example.com を聞かれたルートサーバーは何を返す？',
      },
      choices: [
        {
          id: 'address',
          text: { en: 'The address of www.example.com', ja: 'www.example.com のアドレス' },
        },
        {
          id: 'referral',
          text: { en: 'A referral to the .com servers', ja: '.com のサーバーへの委任' },
        },
        {
          id: 'nxdomain',
          text: { en: 'NXDOMAIN, because it does not know', ja: '知らないので NXDOMAIN' },
        },
        {
          id: 'none',
          text: {
            en: 'Nothing; roots only accept recursion',
            ja: '何も返さない（再帰しか受けない）',
          },
        },
      ],
      answerId: 'referral',
      explanation: {
        en: 'The root does not know the address, but it knows who is responsible for com. It returns NS records for com. (with their addresses in the Additional section), and the resolver asks there next.',
        ja: 'ルートはアドレスを知らないが、com. の担当は知っている。com. の NS レコード（と、Additional セクションにそのアドレス）を返し、リゾルバーは次にそこへ聞く。',
      },
    },
    {
      id: 'why-glue',
      prompt: {
        en: 'The .com referral includes the address of ns1.example.com (glue). Why is it needed?',
        ja: '.com の委任には ns1.example.com のアドレス（glue）が入っている。なぜ必要？',
      },
      choices: [
        {
          id: 'faster',
          text: { en: 'It only makes the lookup faster', ja: '名前解決を速くするためだけ' },
        },
        {
          id: 'encryption',
          text: { en: 'It is required for encryption', ja: '暗号化に必要だから' },
        },
        {
          id: 'circular',
          text: {
            en: 'The server is inside the zone it serves',
            ja: 'そのサーバーが担当するゾーンの中にあるから',
          },
        },
        {
          id: 'ttl',
          text: { en: 'It resets the TTL of the cache', ja: 'キャッシュの TTL をリセットするため' },
        },
      ],
      answerId: 'circular',
      explanation: {
        en: 'To find the address of ns1.example.com you would have to ask the example.com servers, which is the very thing you are trying to reach. The glue in the referral breaks that loop.',
        ja: 'ns1.example.com のアドレスを知るには example.com のサーバーに聞く必要があるが、それこそがたどり着こうとしているサーバー。委任に入っている glue が、この堂々巡りを断ち切る。',
      },
    },
    {
      id: 'aa-flag',
      prompt: {
        en: 'What does the AA flag in a response mean?',
        ja: '応答の AA フラグは何を意味する？',
      },
      choices: [
        { id: 'cache', text: { en: 'It comes from a cache', ja: 'キャッシュからの答え' } },
        { id: 'recursion', text: { en: 'Recursion is available', ja: '再帰が使える' } },
        {
          id: 'encrypted',
          text: { en: 'The response is encrypted', ja: '応答が暗号化されている' },
        },
        {
          id: 'authoritative',
          text: {
            en: 'It comes from the zone’s own server',
            ja: 'ゾーンを担当するサーバーからの答え',
          },
        },
      ],
      answerId: 'authoritative',
      explanation: {
        en: 'AA (authoritative answer) is set by the server responsible for the zone. An answer from a resolver’s cache does not have it, and RA is the flag that means recursion is available.',
        ja: 'AA（authoritative answer）は、ゾーンを担当するサーバーが付ける。リゾルバーのキャッシュからの答えには付かない。再帰が使えることを示すのは RA フラグ。',
      },
    },
    {
      id: 'negative-cache',
      prompt: {
        en: 'After getting NXDOMAIN, why does the resolver not ask again right away?',
        ja: 'NXDOMAIN を受け取ったリゾルバーが、すぐには同じ問い合わせをしないのはなぜ？',
      },
      choices: [
        {
          id: 'blocked',
          text: { en: 'The name is now blocked', ja: 'その名前がブロックされるから' },
        },
        {
          id: 'negative-cache',
          text: { en: 'It caches the negative answer', ja: '否定応答をキャッシュするから' },
        },
        { id: 'root-forbids', text: { en: 'The root forbids it', ja: 'ルートが禁止するから' } },
        {
          id: 'a-ttl',
          text: { en: 'It waits for the A record’s TTL', ja: 'A レコードの TTL を待つから' },
        },
      ],
      answerId: 'negative-cache',
      explanation: {
        en: 'The NXDOMAIN response carries the zone’s SOA record. The resolver remembers the negative answer for min(SOA TTL, SOA MINIMUM) seconds (RFC 2308).',
        ja: 'NXDOMAIN の応答にはゾーンの SOA レコードが入っている。リゾルバーは否定応答を min(SOA の TTL, SOA の MINIMUM) 秒のあいだ覚えておく（RFC 2308）。',
      },
    },
  ],
}
