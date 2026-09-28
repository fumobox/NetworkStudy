import type { Quiz } from '@/components/features/quiz/types'

/** WebSocket の理解度クイズ（根拠は scenario.ts の RFC 6455・WHATWG WebSockets Standard の参照と同じ） */
export const webSocketQuiz: Quiz = {
  id: 'websocket',
  questions: [
    {
      id: 'accept',
      prompt: {
        en: 'The browser sent Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==. What must the server put in Sec-WebSocket-Accept?',
        ja: 'ブラウザーは Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ== を送った。サーバーは Sec-WebSocket-Accept に何を入れなければならない？',
      },
      choices: [
        {
          id: 'echo',
          text: { en: 'The same key, sent back unchanged', ja: '同じキーを、そのまま返す' },
        },
        {
          id: 'tls',
          text: {
            en: 'A signature made with the server’s TLS certificate',
            ja: 'サーバーの TLS の証明書で作った署名',
          },
        },
        {
          id: 'hash',
          text: {
            en: 'The base64 of the SHA-1 hash of the key followed by the fixed GUID 258EAFA5-…',
            ja: 'キーに決まった GUID（258EAFA5-…）をつなげたものの SHA-1 ハッシュの base64',
          },
        },
      ],
      answerId: 'hash',
      explanation: {
        en: 'The result is s3pPLMBiTxaQ9kYGzzhZRbK+xOo=. The browser computes the same value and must fail the connection if it differs. It only proves that the server understood a WebSocket handshake; it is not authentication.',
        ja: '結果は s3pPLMBiTxaQ9kYGzzhZRbK+xOo=。ブラウザーも同じ値を計算し、違えば接続を失敗にしなければならない。サーバーが WebSocket のハンドシェイクを理解したことを示すだけで、認証ではない。',
      },
    },
    {
      id: 'mask',
      prompt: {
        en: 'Which frames must be masked?',
        ja: 'マスクしなければならないのは、どのフレーム？',
      },
      choices: [
        {
          id: 'client',
          text: {
            en: 'Every frame the browser sends to the server, even over wss://',
            ja: 'ブラウザーがサーバーに送るすべてのフレーム（wss:// でも）',
          },
        },
        {
          id: 'server',
          text: {
            en: 'Every frame the server sends to the browser',
            ja: 'サーバーがブラウザーに送るすべてのフレーム',
          },
        },
        {
          id: 'ws-only',
          text: {
            en: 'Only frames on ws://, because wss:// is already encrypted',
            ja: 'ws:// のフレームだけ（wss:// はもう暗号化されているから）',
          },
        },
      ],
      answerId: 'client',
      explanation: {
        en: 'Clients mask every frame and servers never do. Masking is not encryption (the key is in the frame): it stops a script in the page from choosing the exact bytes on the wire, which could fool proxies along the way.',
        ja: 'クライアントはすべてのフレームをマスクし、サーバーはマスクしない。マスクは暗号化ではない（キーはフレームの中にある）。ページのスクリプトが通信路のバイト列を思いどおりに作り、途中のプロキシをだますのを防ぐため。',
      },
    },
    {
      id: 'close-code',
      prompt: {
        en: 'Which status code must never be sent in a Close frame?',
        ja: 'Close フレームで決して送ってはいけないステータスコードはどれ？',
      },
      choices: [
        { id: '1000', text: { en: '1000 (normal closure)', ja: '1000（正常な終了）' } },
        { id: '1006', text: { en: '1006 (closed abnormally)', ja: '1006（異常な終了）' } },
        { id: '1001', text: { en: '1001 (going away)', ja: '1001（離れる）' } },
      ],
      answerId: '1006',
      explanation: {
        en: '1005, 1006 and 1015 are reserved for reporting what happened locally. An endpoint reports 1006 when the connection closed without a Close frame, and browsers report it for every kind of failure.',
        ja: '1005、1006、1015 は、手元で起きたことを表すための予約された値。Close フレームなしで接続が閉じたときに 1006 を報告し、ブラウザーはどんな失敗でも 1006 を報告する。',
      },
    },
    {
      id: 'origin',
      prompt: {
        en: 'A page on https://evil.example opens wss://chat.example.com, and the browser sends the user’s chat cookie with the handshake. What should stop the page from reading the chat?',
        ja: 'https://evil.example のページが wss://chat.example.com を開き、ブラウザーはハンドシェイクにユーザーのチャットの Cookie を付けて送る。このページがチャットを読むのを止めるべきものは？',
      },
      choices: [
        {
          id: 'sop',
          text: {
            en: 'The same-origin policy: the browser refuses to connect to another origin',
            ja: '同一オリジンポリシー。ブラウザーが別のオリジンへの接続を拒む',
          },
        },
        {
          id: 'cors',
          text: {
            en: 'A CORS preflight that chat.example.com does not answer',
            ja: 'chat.example.com が答えない CORS のプリフライト',
          },
        },
        {
          id: 'server',
          text: {
            en: 'The server: it checks the Origin header and refuses unknown origins (for example with 403)',
            ja: 'サーバー。Origin ヘッダーを確かめ、知らないオリジンを拒む（たとえば 403 で）',
          },
        },
      ],
      answerId: 'server',
      explanation: {
        en: 'WebSocket has no same-origin policy and no CORS: the browser connects to any origin and sends its cookies. If the server does not check Origin, another site can use the user’s session (cross-site WebSocket hijacking). Non-browser clients can send any Origin, so use tokens too.',
        ja: 'WebSocket には同一オリジンポリシーも CORS もない。ブラウザーはどのオリジンにも接続し、Cookie も送る。サーバーが Origin を確かめなければ、別のサイトがユーザーのセッションを使える（クロスサイト WebSocket ハイジャック）。ブラウザー以外のクライアントは好きな Origin を送れるので、トークンも使う。',
      },
    },
  ],
}
