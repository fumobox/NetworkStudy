import type { Quiz } from '@/components/features/quiz/types'

/** Cookie と CSRF の理解度クイズ（根拠: draft-ietf-httpbis-rfc6265bis-22 §5.8.3、§5.6.7.1、RFC 9110 §9.2.1、HTML Standard "Sites"、Fetch Standard "CORS protocol"） */
export const csrfQuiz: Quiz = {
  id: 'csrf',
  questions: [
    {
      id: 'lax-post',
      prompt: {
        en: 'bank.example’s session cookie is SameSite=Lax. A page on evil.example automatically submits a POST form to bank.example/transfer. Is the cookie sent?',
        ja: 'bank.example のセッション Cookie は SameSite=Lax。evil.example のページが、bank.example/transfer への POST のフォームを自動で送信する。Cookie は付く？',
      },
      choices: [
        {
          id: 'always',
          text: {
            en: 'Yes: a cookie is always sent to the site that set it',
            ja: '付く。Cookie は設定したサイトへはいつも送られる',
          },
        },
        {
          id: 'withheld',
          text: {
            en: 'No: the request is cross-site and POST is not a safe method, so Lax withholds it',
            ja: '付かない。サイトをまたぐ要求で、POST は安全なメソッドではないので、Lax は付けない',
          },
        },
        {
          id: 'safelisted',
          text: {
            en: 'Yes: form encodings are CORS-safelisted, so SameSite does not apply',
            ja: '付く。フォームの形式は CORS で許されているので、SameSite は関係しない',
          },
        },
      ],
      answerId: 'withheld',
      explanation: {
        en: 'For a SameSite=Lax cookie, a cross-site request gets it only as a top-level navigation with a safe method such as GET (draft-22 §5.8.3). A form POST from another site is not safe, so the cookie is withheld and the bank sees no session. CORS is unrelated: it controls reading responses, not cookies.',
        ja: 'SameSite=Lax の Cookie は、サイトをまたぐ要求には、GET のような安全なメソッドのトップレベルのナビゲーションのときだけ付く（草案 -22 §5.8.3）。別のサイトからのフォームの POST は安全ではないので、Cookie は付かず、銀行にはセッションが見えない。CORS は関係しない。CORS が決めるのは応答を読めるかで、Cookie ではない。',
      },
    },
    {
      id: 'get-side-effect',
      prompt: {
        en: 'The cookie is SameSite=Lax, but bank.example moves money on GET /transfer?to=…&amount=…, and evil.example sets location to that URL. What fixes it?',
        ja: 'Cookie は SameSite=Lax だが、bank.example は GET /transfer?to=…&amount=… で送金し、evil.example は location をその URL にする。どう直す？',
      },
      choices: [
        {
          id: 'nothing',
          text: {
            en: 'Nothing is needed: Lax already blocks every cross-site request',
            ja: '何もいらない。Lax はサイトをまたぐ要求をすべて止める',
          },
        },
        {
          id: 'cors',
          text: {
            en: 'Leave out Access-Control-Allow-Origin in bank’s responses',
            ja: 'bank の応答に Access-Control-Allow-Origin を付けない',
          },
        },
        {
          id: 'post-token',
          text: {
            en: 'Make the transfer require POST (a GET must not change data) and a CSRF token',
            ja: '送金は POST にし（GET でデータを変えてはならない）、CSRF トークンを求める',
          },
        },
      ],
      answerId: 'post-token',
      explanation: {
        en: 'Lax sends the cookie on a top-level GET navigation from another site, so a GET that moves money is open to CSRF. RFC 9110 §9.2.1 says a safe method must not trigger an unsafe action. With POST, Lax withholds the cookie, and a CSRF token protects even browsers or cookies without Lax. CORS headers do not affect whether the request is sent.',
        ja: 'Lax は、別のサイトからのトップレベルの GET のナビゲーションには Cookie を付けるので、送金する GET は CSRF に弱い。RFC 9110 §9.2.1 は、安全なメソッドで安全でない動作を起こしてはならないとする。POST にすれば Lax は Cookie を付けず、CSRF トークンは Lax でないブラウザーや Cookie でも守る。CORS のヘッダーは、要求が送られるかどうかに関係しない。',
      },
    },
    {
      id: 'same-site',
      prompt: {
        en: 'An attacker controls forum.bank.example. The session cookie belongs to www.bank.example and is SameSite=Strict. The forum page submits a form to www.bank.example. What happens?',
        ja: '攻撃者が forum.bank.example を操っている。セッション Cookie は www.bank.example のもので、SameSite=Strict。フォーラムのページが www.bank.example にフォームを送信する。どうなる？',
      },
      choices: [
        {
          id: 'sent',
          text: {
            en: 'The cookie is sent, because both hosts share the registrable domain bank.example (same site). Check Origin or Sec-Fetch-Site: same-origin',
            ja: 'Cookie は付く。両方のホストの登録可能ドメインが bank.example で、同じサイトだから。Origin か Sec-Fetch-Site: same-origin を確かめる',
          },
        },
        {
          id: 'origin',
          text: {
            en: 'It is withheld, because the two origins differ',
            ja: '付かない。オリジンが違うから',
          },
        },
        {
          id: 'subdomain',
          text: {
            en: 'It is withheld, because Strict blocks every subdomain',
            ja: '付かない。Strict はすべてのサブドメインを止めるから',
          },
        },
      ],
      answerId: 'sent',
      explanation: {
        en: 'SameSite compares sites, not origins. A site is the scheme and the registrable domain, so https://forum.bank.example and https://www.bank.example are the same site, and even Strict cookies are sent. The request’s Origin (https://forum.bank.example) and Sec-Fetch-Site (same-site) still show the difference.',
        ja: 'SameSite が比べるのはオリジンではなくサイト。サイトはスキームと登録可能ドメインの組なので、https://forum.bank.example と https://www.bank.example は同じサイトで、Strict の Cookie も付く。それでも要求の Origin（https://forum.bank.example）と Sec-Fetch-Site（same-site）には違いが表れる。',
      },
    },
    {
      id: 'cors-contrast',
      prompt: {
        en: 'The cookie is SameSite=None; Secure. A script on evil.example calls fetch() with POST, credentials: "include" and Content-Type: text/plain. bank.example sends no CORS headers, and the browser allows third-party cookies. What happens?',
        ja: 'Cookie は SameSite=None; Secure。evil.example のスクリプトが、POST、credentials: "include"、Content-Type: text/plain で fetch() を呼ぶ。bank.example は CORS のヘッダーを付けず、ブラウザーはサードパーティー Cookie を許している。どうなる？',
      },
      choices: [
        {
          id: 'blocked',
          text: {
            en: 'The browser does not send the request at all',
            ja: 'ブラウザーは要求をまったく送らない',
          },
        },
        {
          id: 'stripped',
          text: {
            en: 'bank receives the request without cookies, because CORS removes them',
            ja: 'bank には Cookie のない要求が届く。CORS が Cookie を外すから',
          },
        },
        {
          id: 'sent',
          text: {
            en: 'The request reaches bank with the cookie and may be processed; CORS only stops the page from reading the response',
            ja: '要求は Cookie 付きで bank に届き、処理されうる。CORS が止めるのは、ページが応答を読むことだけ',
          },
        },
      ],
      answerId: 'sent',
      explanation: {
        en: 'POST with text/plain is a CORS-safelisted request, so no preflight is sent, and the request goes out with the cookie. Without CORS headers the browser hides the response from the script, but the bank may already have acted on the request. CORS protects reading, not sending, so it is not a CSRF defense. (Many browsers block or partition third-party cookies, which would keep the cookie off this request, but a server cannot rely on that.)',
        ja: 'text/plain の POST は CORS で許された形の要求なので、プリフライトは送られず、要求は Cookie 付きで出ていく。CORS のヘッダーがなければ、ブラウザーは応答をスクリプトから隠すが、銀行はもう要求を処理したかもしれない。CORS が守るのは読むことで、送ることではない。だから CSRF の対策にはならない（多くのブラウザーはサードパーティー Cookie を止めたり分けたりするので、この要求に Cookie が付かないこともあるが、サーバーはそれに頼れない）。',
      },
    },
  ],
}
