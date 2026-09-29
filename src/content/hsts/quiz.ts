import type { Quiz } from '@/components/features/quiz/types'

/** HSTS の理解度クイズ（根拠: RFC 6797 §8.1、§8.2、§8.3、§8.4、§12.1、§12.3、§14.6） */
export const hstsQuiz: Quiz = {
  id: 'hsts',
  questions: [
    {
      id: 'first-visit',
      prompt: {
        en: 'You have never visited example.com, which sends Strict-Transport-Security: max-age=31536000; includeSubDomains. On café Wi-Fi, an attacker strips your connection. Why doesn’t the header protect you?',
        ja: 'example.com は Strict-Transport-Security: max-age=31536000; includeSubDomains を送るが、あなたはまだ訪れたことがない。カフェの Wi-Fi で、攻撃者があなたの接続を剥ぎ取る。ヘッダーが守ってくれないのはなぜ？',
      },
      choices: [
        {
          id: 'short',
          text: { en: 'A year is too short for max-age', ja: 'max-age の 1 年が短すぎる' },
        },
        {
          id: 'http-only',
          text: {
            en: 'The browser only ever gets http from the attacker, and a header received over http is ignored; the attacker removes it anyway',
            ja: 'ブラウザーは攻撃者から http しか受け取らず、http で受けたヘッダーは無視される。そもそも攻撃者が外してしまう',
          },
        },
        {
          id: 'http2',
          text: { en: 'HSTS only works over HTTP/2', ja: 'HSTS は HTTP/2 でしか働かない' },
        },
      ],
      answerId: 'http-only',
      explanation: {
        en: 'A browser notes a Known HSTS Host only from a header received over a secure connection without errors (§8.1). On a first visit it has no record, so it starts with http, and the attacker never lets an https response reach it (§14.6). The preload list exists for exactly this case.',
        ja: 'ブラウザーが既知の HSTS ホストを記録するのは、誤りのない安全な接続で受けたヘッダーからだけ（§8.1）。初めての訪問では記録がないので http で始め、攻撃者は https の応答をブラウザーに届けさせない（§14.6）。プリロードリストはまさにこのためにある。',
      },
    },
    {
      id: 'bad-cert',
      prompt: {
        en: 'example.com is a Known HSTS Host in your browser. An attacker on the path answers the TLS connection with its own self-signed certificate. What happens?',
        ja: 'example.com はブラウザーの既知の HSTS ホスト。経路の途中の攻撃者が、自分で署名した証明書で TLS の接続に答える。どうなる？',
      },
      choices: [
        {
          id: 'warning',
          text: {
            en: 'A warning with a “proceed anyway” button',
            ja: '「それでも進む」ボタンの付いた警告が出る',
          },
        },
        {
          id: 'fallback',
          text: {
            en: 'The browser retries the site over http',
            ja: 'ブラウザーが http で試し直す',
          },
        },
        {
          id: 'hard-fail',
          text: {
            en: 'The connection is terminated, with no way to proceed',
            ja: '接続が打ち切られ、先へ進む手段はない',
          },
        },
      ],
      answerId: 'hard-fail',
      explanation: {
        en: 'For a Known HSTS Host, any error or warning while establishing the secure connection must end it (§8.4), and the browser should not offer a way to proceed (§12.1). It never falls back to http, because every http URL for the host is rewritten to https first (§8.3).',
        ja: '既知の HSTS ホストでは、安全な接続を確立するときの誤りや警告はどれも、接続を打ち切らなければならず（§8.4）、ブラウザーは先へ進む手段を出すべきでない（§12.1）。http に戻ることもない。このホストへの http の URL は、先にすべて https に書き換えられるから（§8.3）。',
      },
    },
    {
      id: 'subdomain',
      prompt: {
        en: 'example.com sent Strict-Transport-Security: max-age=31536000, without includeSubDomains. You now open http://www.example.com/ for the first time. What happens?',
        ja: 'example.com は includeSubDomains なしで Strict-Transport-Security: max-age=31536000 を送った。あなたは初めて http://www.example.com/ を開く。どうなる？',
      },
      choices: [
        {
          id: 'plain',
          text: {
            en: 'It goes out over plain http, because www.example.com is not a Known HSTS Host',
            ja: '平文の http で出ていく。www.example.com は既知の HSTS ホストではないから',
          },
        },
        {
          id: 'subdomain',
          text: {
            en: 'It is upgraded to https, because www is a subdomain of example.com',
            ja: 'https に書き換えられる。www は example.com のサブドメインだから',
          },
        },
        {
          id: 'address',
          text: {
            en: 'It is upgraded to https, because both names have the same IP address',
            ja: 'https に書き換えられる。どちらの名前も同じ IP アドレスだから',
          },
        },
      ],
      answerId: 'plain',
      explanation: {
        en: 'Records are kept per host and matched label by label (§8.2). A parent record covers subdomains only with includeSubDomains (§8.3), and IP addresses play no part. So the request to www goes out over http and can be stripped.',
        ja: '記録はホストごとに持ち、ラベルごとに照合する（§8.2）。上位の記録がサブドメインを含むのは includeSubDomains があるときだけで（§8.3）、IP アドレスは関係しない。そのため www への要求は http で出ていき、剥ぎ取られうる。',
      },
    },
    {
      id: 'preload',
      prompt: {
        en: 'What does the HSTS preload list do?',
        ja: 'HSTS のプリロードリストは何をする？',
      },
      choices: [
        {
          id: 'ignore',
          text: {
            en: 'It makes browsers accept Strict-Transport-Security, which they would ignore without preload',
            ja: 'preload のない Strict-Transport-Security は無視されるので、ブラウザーに受け入れさせる',
          },
        },
        {
          id: 'certificate',
          text: {
            en: 'It lets a site use https without a certificate',
            ja: 'サイトが証明書なしで https を使えるようにする',
          },
        },
        {
          id: 'first-visit',
          text: {
            en: 'It protects the very first visit, before the browser could have received any header',
            ja: 'ブラウザーがまだヘッダーを受け取れない、初めての訪問を守る',
          },
        },
      ],
      answerId: 'first-visit',
      explanation: {
        en: 'HSTS starts working only after one secure visit (§14.6). A host on the list built into the browser is a Known HSTS Host from the start (§12.3). The list is a browser programme, not part of RFC 6797, which does not define preload; browsers ignore that token.',
        ja: 'HSTS が働くのは、安全な訪問を一度してから（§14.6）。ブラウザーに組み込まれたリストに載るホストは、最初から既知の HSTS ホストになる（§12.3）。リストはブラウザーの取り組みで、RFC 6797 の一部ではない。RFC 6797 は preload を定めておらず、ブラウザーはこの印を無視する。',
      },
    },
  ],
}
