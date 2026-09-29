import type { Quiz } from '@/components/features/quiz/types'

/** Server-Sent Events の理解度クイズ（根拠: HTML Standard「Server-sent events」の EventSource・Processing model・Interpreting an event stream・Authoring notes、RFC 9112 §9.4、RFC 9113 §6.5.2） */
export const sseQuiz: Quiz = {
  id: 'server-sent-events',
  questions: [
    {
      id: 'reconnect',
      prompt: {
        en: 'The browser received events up to id: 2, then the connection dropped. What happens next?',
        ja: 'ブラウザーは id: 2 までのイベントを受け取ったあと、接続が切れた。次に何が起きる？',
      },
      choices: [
        {
          id: 'nothing',
          text: {
            en: 'Nothing, until the page creates a new EventSource',
            ja: 'ページが新しい EventSource を作るまで、何も起きない',
          },
        },
        {
          id: 'everything',
          text: {
            en: 'The browser reconnects at once, and the server must resend everything from the start',
            ja: 'ブラウザーはすぐに接続し直し、サーバーは最初からすべてを送り直さなければならない',
          },
        },
        {
          id: 'last-event-id',
          text: {
            en: 'After the reconnection time, it sends the GET again with Last-Event-ID: 2, and the server can send what came after 2',
            ja: '再接続の待ち時間のあと、Last-Event-ID: 2 を付けて GET を送り直し、サーバーは 2 より後を送れる',
          },
        },
      ],
      answerId: 'last-event-id',
      explanation: {
        en: 'readyState becomes CONNECTING and error fires. The browser waits the reconnection time (from retry:, or a default of a few seconds) and reconnects on its own, adding Last-Event-ID with the last event ID. The HTML Standard only says the browser sends the header; replaying the missed events is the server’s job.',
        ja: 'readyState は CONNECTING になり、error が発火する。ブラウザーは再接続の待ち時間（retry: で決まる。なければ数秒の既定の値）を待ち、自分で接続し直す。そのとき最後のイベント ID の Last-Event-ID を付ける。HTML Standard が決めているのはブラウザーがこのヘッダーを送ることだけで、取りこぼしたイベントを送り直すのはサーバーの仕事。',
      },
    },
    {
      id: 'stop',
      prompt: {
        en: 'How can the server make the browser stop reconnecting for good?',
        ja: 'サーバーがブラウザーに、二度と接続し直させないようにするには？',
      },
      choices: [
        {
          id: '204',
          text: {
            en: 'Answer the next reconnection with 204 No Content',
            ja: '次の再接続に 204 No Content で答える',
          },
        },
        {
          id: 'last-chunk',
          text: {
            en: 'End the response with the last chunk (0)',
            ja: '最後のチャンク（0）で応答を終える',
          },
        },
        {
          id: 'retry-0',
          text: { en: 'Send retry: 0', ja: 'retry: 0 を送る' },
        },
      ],
      answerId: '204',
      explanation: {
        en: 'Any status other than 200 fails the connection: readyState becomes CLOSED and the browser does not try again; 204 is the way the HTML Standard gives. Ending the response normally only makes the browser reconnect, and retry: 0 just makes it reconnect without waiting.',
        ja: '200 以外の状態コードでは接続は失敗になる。readyState は CLOSED になり、ブラウザーは試し直さない。HTML Standard が挙げる方法が 204。応答を普通に終えても、ブラウザーは接続し直すだけ。retry: 0 は、待たずに接続し直させるだけ。',
      },
    },
    {
      id: 'parse',
      prompt: {
        en: 'Which data does the page get from these three lines: “data:” followed by two spaces and “hello”, then “data:world”, then a blank line?',
        ja: '「data:」の後に空白 2 つと「hello」、「data:world」、空行の 3 行から、ページが受け取る data は？',
      },
      choices: [
        { id: 'joined', text: { en: '"hello world"', ja: '"hello world"' } },
        { id: 'space-kept', text: { en: '" hello\\nworld"', ja: '" hello\\nworld"' } },
        { id: 'trailing', text: { en: '"hello\\nworld\\n"', ja: '"hello\\nworld\\n"' } },
      ],
      answerId: 'space-kept',
      explanation: {
        en: 'Only one space after the colon is removed, so the first value is " hello" with one space left. data lines are joined with a line feed, and the final line feed is removed.',
        ja: 'コロンの後の空白は 1 つだけ除くので、1 つ目の値は空白が 1 つ残った " hello"。data の行は改行でつなぎ、最後の改行を除く。',
      },
    },
    {
      id: 'limit',
      prompt: {
        en: 'Six tabs of the same site each keep an EventSource open over HTTP/1.1. What happens when one of them fetches /api/cart?',
        ja: '同じサイトの 6 つのタブが、それぞれ HTTP/1.1 で EventSource を開いている。1 つのタブが /api/cart を取りにいくと？',
      },
      choices: [
        {
          id: '429',
          text: { en: 'The server rejects it with 429', ja: 'サーバーが 429 で断る' },
        },
        {
          id: 'shared',
          text: {
            en: 'HTTP/1.1 sends it inside one of the event streams',
            ja: 'HTTP/1.1 は、それをイベントストリームの 1 つの中で送る',
          },
        },
        {
          id: 'waits',
          text: {
            en: 'It usually waits until a connection frees up; with HTTP/2 they would all share one connection as streams',
            ja: 'ふつうは接続が空くまで待たされる。HTTP/2 なら、すべてが 1 本の接続のストリームになる',
          },
        },
      ],
      answerId: 'waits',
      explanation: {
        en: 'Browsers typically allow about six HTTP/1.1 connections at a time to one server, shared by all tabs. That is browser behaviour; RFC 9112 §9.4 sets no number. The HTML Standard warns about exactly this. HTTP/2 carries many streams on one connection (RFC 9113 recommends allowing at least 100).',
        ja: 'ブラウザーはふつう、1 つのサーバーへの HTTP/1.1 の接続を同時に約 6 本までにし、すべてのタブで分け合う。これはブラウザーの動きで、RFC 9112 §9.4 は数を決めていない。HTML Standard もまさにこのことを注意している。HTTP/2 は 1 本の接続で多くのストリームを運ぶ（RFC 9113 は 100 本以上を許すよう勧める）。',
      },
    },
  ],
}
