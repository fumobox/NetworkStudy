import type { Quiz } from '@/components/features/quiz/types'

/** HTTP のキャッシュの理解度クイズ（根拠: RFC 9111 §4.2、§4.3、§5.2.2.4、§5.2.2.5、RFC 9110 §13.1.2、§15.4.5） */
export const httpCachingQuiz: Quiz = {
  id: 'http-caching',
  questions: [
    {
      id: 'validator',
      prompt: {
        en: 'The stored response has ETag: "v1" and is stale. Which request header does the browser use to ask whether it is still valid?',
        ja: '保存した応答の ETag は "v1" で、古くなっている。まだ使えるかを尋ねるのに、ブラウザーが使う要求のヘッダーは？',
      },
      choices: [
        { id: 'inm', text: { en: 'If-None-Match: "v1"', ja: 'If-None-Match: "v1"' } },
        { id: 'etag', text: { en: 'ETag: "v1"', ja: 'ETag: "v1"' } },
        { id: 'cc', text: { en: 'Cache-Control: max-age=60', ja: 'Cache-Control: max-age=60' } },
      ],
      answerId: 'inm',
      explanation: {
        en: 'ETag is sent by the server. The browser returns the stored value in If-None-Match; if the server’s current ETag matches, it answers 304 Not Modified.',
        ja: 'ETag はサーバーが送るヘッダー。ブラウザーは保存した値を If-None-Match に入れて送り、サーバーの今の ETag と一致すれば 304 Not Modified が返る。',
      },
    },
    {
      id: 'not-modified',
      prompt: {
        en: 'What does the browser do when it receives 304 Not Modified?',
        ja: '304 Not Modified を受け取ったブラウザーは、どうする？',
      },
      choices: [
        {
          id: 'reload',
          text: {
            en: 'It sends the request again without If-None-Match to get the file',
            ja: 'ファイルをもらうため、If-None-Match なしでもう一度要求する',
          },
        },
        {
          id: 'error',
          text: {
            en: 'It shows an error, because the response has no body',
            ja: '応答に本文がないので、エラーを表示する',
          },
        },
        {
          id: 'reuse',
          text: {
            en: 'It uses the stored file and updates the stored response, so it is fresh again',
            ja: '保存したファイルを使い、保存した応答を更新して、また新しい状態にする',
          },
        },
      ],
      answerId: 'reuse',
      explanation: {
        en: 'A 304 has no body: it means “your copy is still right”. The browser uses the stored file and updates the stored response with the 304’s headers, so its age starts from 0 again.',
        ja: '304 には本文がなく、「手元の版のままで正しい」という意味。ブラウザーは保存したファイルを使い、304 のヘッダーで保存した応答を更新するので、経過時間は 0 に戻る。',
      },
    },
    {
      id: 'no-cache',
      prompt: {
        en: 'What is the difference between Cache-Control: no-cache and no-store?',
        ja: 'Cache-Control の no-cache と no-store の違いは？',
      },
      choices: [
        {
          id: 'same',
          text: {
            en: 'None: both mean “do not cache”',
            ja: '違いはない。どちらも「キャッシュしない」',
          },
        },
        {
          id: 'diff',
          text: {
            en: 'no-cache may be stored but must be revalidated before every use; no-store must not be stored at all',
            ja: 'no-cache は保存してよいが毎回使う前に確かめる。no-store はまったく保存しない',
          },
        },
        {
          id: 'reverse',
          text: {
            en: 'no-store may be stored but must be revalidated; no-cache must not be stored',
            ja: 'no-store は保存してよいが確かめる。no-cache は保存しない',
          },
        },
      ],
      answerId: 'diff',
      explanation: {
        en: 'Despite its name, no-cache keeps the response and revalidates it, so a 304 can still save the download. no-store keeps nothing, so every visit downloads the whole file.',
        ja: '名前に反して、no-cache は応答を保存して確かめるので、304 でダウンロードを省ける。no-store は何も残さないので、毎回ファイル全体をダウンロードする。',
      },
    },
    {
      id: 'stale',
      prompt: {
        en: 'max-age=60 has passed since the response. What happens the next time the page needs the file?',
        ja: '応答から max-age=60 が過ぎた。次にページがそのファイルを使うとき、何が起きる？',
      },
      choices: [
        {
          id: 'deleted',
          text: {
            en: 'The stored response has been deleted, so the whole file is downloaded',
            ja: '保存した応答は消えているので、ファイル全体をダウンロードする',
          },
        },
        {
          id: 'revalidate',
          text: {
            en: 'The browser asks the server with a conditional request; if nothing changed, a 304 is enough',
            ja: 'ブラウザーが条件付きの要求でサーバーに確かめ、変わっていなければ 304 で済む',
          },
        },
        {
          id: 'use',
          text: {
            en: 'The browser keeps using the stored file without asking',
            ja: 'ブラウザーは尋ねずに保存したファイルを使い続ける',
          },
        },
      ],
      answerId: 'revalidate',
      explanation: {
        en: 'A stale response is not thrown away. It must be revalidated before use, and a 304 makes it fresh again. Only a changed file (a different ETag) is downloaded again.',
        ja: '古くなった応答は捨てられるわけではない。使う前に確かめる必要があり、304 ならまた新しくなる。ファイルが変わった（ETag が違う）ときだけ、もう一度ダウンロードする。',
      },
    },
  ],
}
