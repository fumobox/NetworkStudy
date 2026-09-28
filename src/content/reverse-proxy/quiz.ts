import type { Quiz } from '@/components/features/quiz/types'

/** リバースプロキシとロードバランサーの理解度クイズ（根拠: RFC 7239 §8.1、RFC 9110 §9.2.2、§15.6.3〜§15.6.5、RFC 9209 §2.3） */
export const reverseProxyQuiz: Quiz = {
  id: 'reverse-proxy',
  questions: [
    {
      id: 'client-ip',
      prompt: {
        en: 'A backend sits behind one reverse proxy that appends the client’s address to X-Forwarded-For. Which value should the backend use as the client’s IP address?',
        ja: 'バックエンドは、クライアントのアドレスを X-Forwarded-For に足すリバースプロキシ 1 台の後ろにある。バックエンドはどの値をクライアントの IP アドレスとして使うべき？',
      },
      choices: [
        {
          id: 'tcp-peer',
          text: {
            en: 'The source address of its TCP connection',
            ja: 'TCP の接続の送信元アドレス',
          },
        },
        {
          id: 'rightmost',
          text: {
            en: 'The rightmost X-Forwarded-For entry, which its own proxy appended',
            ja: 'X-Forwarded-For のいちばん右の値。自分のプロキシが足したもの',
          },
        },
        {
          id: 'leftmost',
          text: {
            en: 'The leftmost X-Forwarded-For entry, because it is the original client',
            ja: 'X-Forwarded-For のいちばん左の値。元のクライアントだから',
          },
        },
      ],
      answerId: 'rightmost',
      explanation: {
        en: 'The TCP peer is the proxy itself. Everything to the left of what your own proxy added was written by someone else, and a client can put any address there. Trust only the entries your own proxies added (RFC 7239 §8.1 makes the same point for Forwarded).',
        ja: 'TCP の相手はプロキシ自身。自分のプロキシが足した値より左は誰かほかの者が書いたもので、クライアントはそこにどんなアドレスでも入れられる。信じてよいのは自分のプロキシが足した値だけ（RFC 7239 §8.1 も Forwarded について同じことを述べる）。',
      },
    },
    {
      id: 'timeout',
      prompt: {
        en: 'The proxy forwarded a request to backend B, waited 30 seconds without a response, and gave up. What does the browser get?',
        ja: 'プロキシは要求をバックエンド B に転送し、30 秒待っても応答がないのであきらめた。ブラウザーは何を受け取る？',
      },
      choices: [
        { id: '502', text: { en: '502 Bad Gateway', ja: '502 Bad Gateway' } },
        {
          id: '503',
          text: {
            en: '503 Service Unavailable with Retry-After',
            ja: 'Retry-After 付きの 503 Service Unavailable',
          },
        },
        { id: '504', text: { en: '504 Gateway Timeout', ja: '504 Gateway Timeout' } },
      ],
      answerId: '504',
      explanation: {
        en: '504 means the gateway did not receive a timely response (RFC 9110 §15.6.5); RFC 9209 recommends it for http_response_timeout. 502 is for a missing or invalid response, such as a connection closed early, and 503 for no available backend or overload.',
        ja: '504 は、ゲートウェイが時間内に応答を受け取れなかったという意味（RFC 9110 §15.6.5）。RFC 9209 も http_response_timeout にはこれを推奨する。502 は、途中で接続が閉じられたなど応答がない・正しくない場合、503 は使えるバックエンドがない場合や混み合っている場合。',
      },
    },
    {
      id: 'retry',
      prompt: {
        en: 'Backend B closed the connection before answering POST /api/orders. Why doesn’t the proxy simply resend the request to backend A?',
        ja: 'バックエンド B は、POST /api/orders に答える前に接続を閉じた。プロキシがこの要求をバックエンド A に送り直さないのはなぜ？',
      },
      choices: [
        {
          id: 'idempotent',
          text: {
            en: 'POST is not idempotent: B may already have created the order',
            ja: 'POST はべき等でない。B がもう注文を作ったかもしれない',
          },
        },
        {
          id: 'one-connection',
          text: {
            en: 'HTTP/1.1 does not allow a proxy to open a second connection',
            ja: 'HTTP/1.1 では、プロキシは 2 本目の接続を開けない',
          },
        },
        {
          id: 'via',
          text: {
            en: 'A would reject it because the Via field already names B',
            ja: 'Via のフィールドに B の名前が入っているので、A が拒否する',
          },
        },
      ],
      answerId: 'idempotent',
      explanation: {
        en: 'The proxy cannot know how far B got. Repeating a GET is harmless, but repeating a POST could create a second order, so a proxy must not retry a non-idempotent request automatically (RFC 9110 §9.2.2). The proxy answers 502 instead.',
        ja: 'B がどこまで処理したか、プロキシにはわからない。GET を繰り返しても害はないが、POST を繰り返すと注文が 2 つできかねない。そのため、プロキシはべき等でない要求を自動で再試行してはならない（RFC 9110 §9.2.2）。代わりにプロキシは 502 を返す。',
      },
    },
    {
      id: 'l4',
      prompt: {
        en: 'With a layer-4 load balancer that passes TLS through, why do both requests the browser sends on one connection reach backend A?',
        ja: 'TLS をそのまま通す L4 のロードバランサーで、ブラウザーが 1 本の接続で送った 2 つの要求がどちらもバックエンド A に届くのはなぜ？',
      },
      choices: [
        {
          id: 'cookie',
          text: {
            en: 'It reads the Cookie header and keeps the session on A',
            ja: 'Cookie ヘッダーを読んで、セッションを A に固定する',
          },
        },
        {
          id: 'per-connection',
          text: {
            en: 'It picks a backend once per TCP connection and cannot see the requests inside the encrypted stream',
            ja: 'TCP の接続ごとに 1 回だけバックエンドを選び、暗号化された中の要求は見えない',
          },
        },
        {
          id: 'rule',
          text: {
            en: 'Round robin always sends the first two requests to the same backend',
            ja: 'ラウンドロビンは、最初の 2 つの要求を必ず同じバックエンドに送る',
          },
        },
      ],
      answerId: 'per-connection',
      explanation: {
        en: 'A layer-4 load balancer forwards TCP connections. It chooses a backend when the connection opens and copies the encrypted bytes after that, so it can read neither paths nor cookies. Only a new connection could go to B.',
        ja: 'L4 のロードバランサーは TCP の接続を転送する。接続が開いたときにバックエンドを選び、あとは暗号化されたバイト列を写すだけなので、パスも Cookie も読めない。B に行けるのは新しい接続だけ。',
      },
    },
  ],
}
