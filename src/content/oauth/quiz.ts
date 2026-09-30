import type { Quiz } from '@/components/features/quiz/types'

/** OAuth 2.0 と OpenID Connect の理解度クイズ（根拠: RFC 6749 §1.3.1・§1.5・§6、RFC 7636 §4.2・§4.6、RFC 9700 §4.5.3.1、RFC 6750 §3.1、OIDC Core §3.1.3.7） */
export const oauthQuiz: Quiz = {
  id: 'oauth',
  questions: [
    {
      id: 'front-channel',
      prompt: {
        en: 'In the authorization code flow with PKCE, which of these passes through Alice’s browser?',
        ja: 'PKCE 付きの認可コードフローで、アリスのブラウザーを通るのはどれ？',
      },
      choices: [
        {
          id: 'verifier',
          text: { en: 'The code_verifier', ja: 'code_verifier' },
        },
        {
          id: 'code',
          text: {
            en: 'The code_challenge and the authorization code',
            ja: 'code_challenge と認可コード',
          },
        },
        {
          id: 'access-token',
          text: { en: 'The access token', ja: 'アクセストークン' },
        },
      ],
      answerId: 'code',
      explanation: {
        en: 'The authorization request and response travel as redirects, so the code_challenge (in the request) and the code (in the response) pass through the browser. The code_verifier is sent only with the token request, and the tokens come back in its response, both directly between the client’s server and the authorization server (RFC 6749 §1.3.1, RFC 7636 §4.5).',
        ja: '認可要求と認可応答はリダイレクトで運ぶので、code_challenge（要求）とコード（応答）はブラウザーを通る。code_verifier はトークン要求でだけ送り、トークンはその応答で戻る。どちらもクライアントのサーバーと認可サーバーの間で直接やり取りする（RFC 6749 §1.3.1、RFC 7636 §4.5）。',
      },
    },
    {
      id: 'injection',
      prompt: {
        en: 'Mallory puts Alice’s leaked authorization code into her own session at the client. state matches, because it is Mallory’s own. With PKCE, why does the token request fail?',
        ja: 'マロリーが、漏れたアリスの認可コードを、クライアントでの自分のセッションに入れる。state は合う。マロリー自身のものだから。PKCE があると、トークン要求はなぜ失敗する？',
      },
      choices: [
        {
          id: 'secret',
          text: {
            en: 'The client secret proves the request is not from Alice',
            ja: 'クライアントの秘密で、要求がアリスのものでないとわかる',
          },
        },
        {
          id: 'state',
          text: {
            en: 'The authorization server checks state again',
            ja: '認可サーバーが state をもう一度確かめる',
          },
        },
        {
          id: 'verifier',
          text: {
            en: 'The client sends the code_verifier of Mallory’s session, which does not match the challenge stored with Alice’s code',
            ja: 'クライアントはマロリーのセッションの code_verifier を送り、それはアリスのコードとともに覚えた code_challenge と合わない',
          },
        },
      ],
      answerId: 'verifier',
      explanation: {
        en: 'The authorization server stored Alice’s code_challenge with her code. The client sends the verifier from the session the code arrived in, which is Mallory’s. Its SHA-256 differs from Alice’s challenge, so the server answers invalid_grant (RFC 7636 §4.6, RFC 9700 §4.5.3.1). The client secret only proves which client is asking, and the authorization server never sees state at the token endpoint.',
        ja: '認可サーバーは、アリスのコードとともにアリスの code_challenge を覚えている。クライアントは、コードが届いたセッション、つまりマロリーのセッションの code_verifier を送る。その SHA-256 はアリスの code_challenge と違うので、サーバーは invalid_grant を返す（RFC 7636 §4.6、RFC 9700 §4.5.3.1）。クライアントの秘密がわかるのは、どのクライアントが頼んでいるかだけ。トークンエンドポイントで、認可サーバーは state を見ない。',
      },
    },
    {
      id: 'aud',
      prompt: {
        en: 'The client receives an ID token with a valid signature and the right iss, but its aud is another client’s client_id. What should it do?',
        ja: 'クライアントが受け取った ID トークンは、署名が正しく iss も合うが、aud は別のクライアントの client_id。どうする？',
      },
      choices: [
        {
          id: 'reject',
          text: {
            en: 'Reject it: the token was issued to someone else',
            ja: '拒む。トークンは別の相手に発行されたもの',
          },
        },
        {
          id: 'accept-signature',
          text: {
            en: 'Accept it: the signature is valid',
            ja: '受け入れる。署名は正しい',
          },
        },
        {
          id: 'accept-exp',
          text: {
            en: 'Accept it if it has not expired',
            ja: '期限が切れていなければ受け入れる',
          },
        },
      ],
      answerId: 'reject',
      explanation: {
        en: 'OpenID Connect requires the client to check that aud contains its own client_id (OIDC Core §3.1.3.7). A valid signature only proves who issued the token, not for whom. Otherwise any site Alice logs in to could replay her ID token at another site.',
        ja: 'OpenID Connect は、aud に自分の client_id が入っていることを確かめるよう求める（OIDC Core §3.1.3.7）。正しい署名でわかるのは、誰がトークンを出したかで、誰のためかではない。確かめなければ、アリスがログインしたどのサイトも、そのアリスの ID トークンを別のサイトで使い回せてしまう。',
      },
    },
    {
      id: 'expired',
      prompt: {
        en: 'The API answers 401 with WWW-Authenticate: Bearer error="invalid_token", error_description="The access token expired". What does the client do?',
        ja: 'API が WWW-Authenticate: Bearer error="invalid_token", error_description="The access token expired" を付けて 401 を返す。クライアントはどうする？',
      },
      choices: [
        {
          id: 'send-refresh-to-api',
          text: {
            en: 'Send the refresh token to the API as the Bearer token',
            ja: 'リフレッシュトークンを Bearer トークンとして API に送る',
          },
        },
        {
          id: 'refresh',
          text: {
            en: 'Send the refresh token to the authorization server’s token endpoint, then retry with the new access token',
            ja: 'リフレッシュトークンを認可サーバーのトークンエンドポイントに送り、新しいアクセストークンでやり直す',
          },
        },
        {
          id: 'login',
          text: {
            en: 'Always send Alice through the login again',
            ja: 'いつもアリスにもう一度ログインさせる',
          },
        },
      ],
      answerId: 'refresh',
      explanation: {
        en: 'invalid_token means the access token is expired or otherwise invalid (RFC 6750 §3.1). The refresh token is for the authorization server only (RFC 6749 §1.5): the client sends it with grant_type=refresh_token and gets a new access token (§6), without bothering Alice. Only if the refresh fails does Alice need to log in again.',
        ja: 'invalid_token は、アクセストークンが切れたか、ほかの理由で無効ということ（RFC 6750 §3.1）。リフレッシュトークンは認可サーバーのためだけのもの（RFC 6749 §1.5）。クライアントはそれを grant_type=refresh_token で送り、新しいアクセストークンを受け取る（§6）。アリスに手間はかけない。リフレッシュに失敗したときだけ、アリスはもう一度ログインする。',
      },
    },
  ],
}
