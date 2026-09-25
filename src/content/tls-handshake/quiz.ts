import type { Quiz } from '@/components/features/quiz/types'

/** TLS 1.3 のハンドシェイクと証明書の理解度クイズ（根拠は scenario.ts の RFC 参照と同じ） */
export const tlsHandshakeQuiz: Quiz = {
  id: 'tls-handshake',
  questions: [
    {
      id: 'one-round-trip',
      prompt: {
        en: 'Why does the TLS 1.3 handshake need only one round trip?',
        ja: 'TLS 1.3 のハンドシェイクが 1 往復で済むのはなぜ？',
      },
      choices: [
        {
          id: 'skip-cert',
          text: { en: 'The server skips the certificate', ja: 'サーバーが証明書を省くから' },
        },
        {
          id: 'key-share',
          text: {
            en: 'The client sends its key share in ClientHello',
            ja: 'ClientHello で鍵交換の値を送るから',
          },
        },
        {
          id: 'udp',
          text: { en: 'It runs over UDP instead of TCP', ja: 'TCP ではなく UDP を使うから' },
        },
        {
          id: 'no-encryption',
          text: { en: 'Nothing is encrypted until the end', ja: '最後まで暗号化しないから' },
        },
      ],
      answerId: 'key-share',
      explanation: {
        en: 'The client guesses the key exchange group and sends its public key right away. With the server’s key share in ServerHello, both sides can derive the keys after one round trip.',
        ja: 'クライアントは鍵交換のグループを見込んで、公開鍵を最初から送る。ServerHello の鍵交換の値と合わせれば、1 往復で両者が鍵を導ける。',
      },
    },
    {
      id: 'what-is-encrypted',
      prompt: {
        en: 'Which handshake messages are encrypted?',
        ja: 'ハンドシェイクのメッセージのうち、暗号化されるのはどれ？',
      },
      choices: [
        {
          id: 'only-data',
          text: { en: 'Only the application data', ja: 'アプリケーションのデータだけ' },
        },
        {
          id: 'all',
          text: { en: 'All of them, even ClientHello', ja: 'ClientHello も含めてすべて' },
        },
        {
          id: 'after-server-hello',
          text: { en: 'Everything after ServerHello', ja: 'ServerHello より後のすべて' },
        },
        { id: 'only-finished', text: { en: 'Only the Finished messages', ja: 'Finished だけ' } },
      ],
      answerId: 'after-server-hello',
      explanation: {
        en: 'ClientHello and ServerHello carry the key shares, so they cannot be encrypted. Once ServerHello is exchanged, both sides have the handshake keys, and even the certificate is encrypted.',
        ja: 'ClientHello と ServerHello は鍵交換の値を運ぶので、暗号化できない。ServerHello を交わした時点で両者はハンドシェイク用の鍵を持つので、証明書も暗号化される。',
      },
    },
    {
      id: 'certificate-verify',
      prompt: {
        en: 'What does CertificateVerify prove?',
        ja: 'CertificateVerify は何を示す？',
      },
      choices: [
        {
          id: 'not-expired',
          text: { en: 'The certificate has not expired', ja: '証明書の期限が切れていない' },
        },
        {
          id: 'trusted-ca',
          text: { en: 'The CA is trusted by the client', ja: 'CA がクライアントに信頼されている' },
        },
        { id: 'client-identity', text: { en: 'Who the client is', ja: 'クライアントがだれか' } },
        {
          id: 'private-key',
          text: {
            en: 'The server holds the certificate’s private key',
            ja: 'サーバーが証明書の秘密鍵を持っている',
          },
        },
      ],
      answerId: 'private-key',
      explanation: {
        en: 'A certificate is public, so anyone could send a copy. Only the real owner can sign the handshake with the matching private key, and the client checks that signature with the public key in the certificate.',
        ja: '証明書は公開情報なので、だれでもコピーを送れる。対応する秘密鍵でハンドシェイクに署名できるのは本当の持ち主だけで、クライアントはその署名を証明書の公開鍵で確かめる。',
      },
    },
    {
      id: 'name-mismatch',
      prompt: {
        en: 'You connect to www.example.com, but the certificate is issued for other.example.net. What happens?',
        ja: 'www.example.com に接続したのに、証明書が other.example.net 向けだった。どうなる？',
      },
      choices: [
        {
          id: 'abort',
          text: {
            en: 'The client aborts the handshake',
            ja: 'クライアントがハンドシェイクを中断する',
          },
        },
        {
          id: 'accept',
          text: {
            en: 'It is accepted if the signature is valid',
            ja: '署名が正しければ受け入れる',
          },
        },
        {
          id: 'ask-again',
          text: { en: 'The client asks for another certificate', ja: '別の証明書を求め直す' },
        },
        {
          id: 'downgrade',
          text: { en: 'The connection falls back to TLS 1.2', ja: 'TLS 1.2 に切り替えて続ける' },
        },
      ],
      answerId: 'abort',
      explanation: {
        en: 'A valid certificate for another name does not prove that this is www.example.com. The client sends an alert and closes the connection, and the browser shows a certificate error.',
        ja: '別の名前の正しい証明書では、相手が www.example.com であることの証明にならない。クライアントはアラートを送って接続を閉じ、ブラウザは証明書のエラーを表示する。',
      },
    },
    {
      id: 'root-not-sent',
      prompt: {
        en: 'Why does the server usually not send the root CA certificate?',
        ja: 'サーバーがふつうルート CA の証明書を送らないのはなぜ？',
      },
      choices: [
        { id: 'too-large', text: { en: 'It is too large to send', ja: '大きすぎて送れないから' } },
        {
          id: 'trust-store',
          text: {
            en: 'The client must already have it to trust it',
            ja: 'クライアントが最初から持っていないと信頼できないから',
          },
        },
        {
          id: 'secret',
          text: { en: 'Root certificates are secret', ja: 'ルート証明書は秘密だから' },
        },
        { id: 'forbidden', text: { en: 'TLS forbids sending it', ja: 'TLS で禁止されているから' } },
      ],
      answerId: 'trust-store',
      explanation: {
        en: 'Anyone can make a root certificate. A root is trusted only because it is already in the client’s trust store, so a copy sent by the server adds nothing (TLS allows it to be omitted).',
        ja: 'ルート証明書はだれでも作れる。ルートが信頼されるのは、クライアントの信頼ストアに最初から入っているからで、サーバーが送ったコピーには意味がない（TLS では省いてよいことになっている）。',
      },
    },
  ],
}
