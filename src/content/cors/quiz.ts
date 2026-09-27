import type { Quiz } from '@/components/features/quiz/types'

/**
 * CORS の理解度クイズ（根拠: Fetch Standard（WHATWG）の "CORS protocol"、"CORS protocol and credentials"、
 * "CORS-safelisted request-header"、"CORS-preflight fetch"、"CORS check"。RFC 6454 §4）
 */
export const corsQuiz: Quiz = {
  id: 'cors',
  questions: [
    {
      id: 'preflight',
      prompt: {
        en: 'A page at https://app.example.com calls fetch() for https://api.example.com. Which request makes the browser send a preflight first?',
        ja: 'https://app.example.com のページが、https://api.example.com に fetch() する。ブラウザーが先にプリフライトを送るのはどれ？',
      },
      choices: [
        {
          id: 'get',
          text: { en: 'A GET with no extra headers', ja: '追加のヘッダーのない GET' },
        },
        {
          id: 'json',
          text: {
            en: 'A POST with Content-Type: application/json',
            ja: 'Content-Type: application/json の POST',
          },
        },
        {
          id: 'form',
          text: {
            en: 'A POST with Content-Type: application/x-www-form-urlencoded',
            ja: 'Content-Type: application/x-www-form-urlencoded の POST',
          },
        },
      ],
      answerId: 'json',
      explanation: {
        en: 'GET, HEAD and POST need no preflight as long as the headers are safelisted, and Content-Type is safelisted only for form encodings and text/plain. application/json is not, so the browser asks with OPTIONS first.',
        ja: 'GET・HEAD・POST は、ヘッダーが決まったものだけならプリフライトは要らない。Content-Type はフォームの形式と text/plain だけが対象で、application/json は違うので、ブラウザーは先に OPTIONS で尋ねる。',
      },
    },
    {
      id: 'enforcer',
      prompt: {
        en: 'Who blocks the page from reading a response that fails the CORS check?',
        ja: 'CORS のチェックに通らない応答を、ページに読ませないのは誰？',
      },
      choices: [
        { id: 'server', text: { en: 'The API server', ja: 'API サーバー' } },
        { id: 'browser', text: { en: 'The browser', ja: 'ブラウザー' } },
        { id: 'firewall', text: { en: 'A firewall on the way', ja: '途中のファイアウォール' } },
      ],
      answerId: 'browser',
      explanation: {
        en: 'The server only adds Access-Control-* headers to say what it allows. The browser checks them and, if they do not allow the page’s origin, gives the script a TypeError instead of the response.',
        ja: 'サーバーは、何を許すかを Access-Control-* ヘッダーで伝えるだけ。ブラウザーがそれを確かめ、ページのオリジンが許されていなければ、応答の代わりに TypeError をスクリプトに返す。',
      },
    },
    {
      id: 'side-effect',
      prompt: {
        en: 'A plain GET is sent cross-origin, and the response has no Access-Control-Allow-Origin. Did the server handle the request?',
        ja: 'オリジンをまたいでふつうの GET を送ったが、応答に Access-Control-Allow-Origin がない。サーバーは要求を処理した？',
      },
      choices: [
        {
          id: 'yes',
          text: {
            en: 'Yes. The request reached the server; only reading the response is blocked',
            ja: '処理した。要求はサーバーに届いていて、止められたのは応答を読むことだけ',
          },
        },
        {
          id: 'no',
          text: {
            en: 'No. The browser stopped the request before it was sent',
            ja: '処理していない。ブラウザーが送る前に止めた',
          },
        },
        {
          id: 'preflight',
          text: {
            en: 'No. The server rejected it in the preflight',
            ja: '処理していない。サーバーがプリフライトで断った',
          },
        },
      ],
      answerId: 'yes',
      explanation: {
        en: 'A request that needs no preflight is sent right away. CORS then only decides whether the page may read the response, so it does not protect the server from the request itself.',
        ja: 'プリフライトの要らない要求はすぐに送られる。そのあと CORS が決めるのは、ページが応答を読んでよいかだけ。要求そのものからサーバーを守るしくみではない。',
      },
    },
    {
      id: 'credentials',
      prompt: {
        en: 'The page sends cookies with credentials: include. The server answers Access-Control-Allow-Origin: *. What happens?',
        ja: 'ページが credentials: include で Cookie を送る。サーバーは Access-Control-Allow-Origin: * を返す。どうなる？',
      },
      choices: [
        {
          id: 'ok',
          text: {
            en: 'It works, because * allows every origin',
            ja: '* はすべてのオリジンを許すので、読める',
          },
        },
        {
          id: 'blocked',
          text: {
            en: 'It is blocked: the server must name the origin and send Access-Control-Allow-Credentials: true',
            ja: '読めない。サーバーはオリジンを名指しし、Access-Control-Allow-Credentials: true を付ける必要がある',
          },
        },
        {
          id: 'nocookie',
          text: {
            en: 'It works, but the browser removes the cookies',
            ja: '読めるが、ブラウザーが Cookie を外して送る',
          },
        },
      ],
      answerId: 'blocked',
      explanation: {
        en: 'With credentials, * is not accepted, because it would let any site read responses made with the user’s cookies. The server must answer with the exact origin and Access-Control-Allow-Credentials: true.',
        ja: '資格情報付きの要求では * は認められない。認めると、どのサイトでも利用者の Cookie で得た応答を読めてしまうから。サーバーは正確なオリジンと Access-Control-Allow-Credentials: true を返す必要がある。',
      },
    },
  ],
}
