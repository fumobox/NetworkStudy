import type { Quiz } from '@/components/features/quiz/types'

/** Wi-Fi の理解度クイズ（根拠: IEEE Std 802.11-2024 9.3.2.1、10.3、11.3、12.7.6） */
export const wifiQuiz: Quiz = {
  id: 'wifi',
  questions: [
    {
      id: 'order',
      prompt: {
        en: 'In what order does a laptop join a WPA2-Personal network?',
        ja: 'ノート PC が WPA2-Personal のネットワークに参加するときの順序は？',
      },
      choices: [
        {
          id: 'assoc-first',
          text: {
            en: 'Association, then Open System authentication, then the 4-way handshake',
            ja: 'アソシエーション、Open System 認証、4 ウェイハンドシェイクの順',
          },
        },
        {
          id: 'correct',
          text: {
            en: 'Scanning, Open System authentication, association, then the 4-way handshake',
            ja: 'スキャン、Open System 認証、アソシエーション、4 ウェイハンドシェイクの順',
          },
        },
        {
          id: 'handshake-first',
          text: {
            en: 'The 4-way handshake first, then authentication and association',
            ja: '4 ウェイハンドシェイクが先で、そのあと認証とアソシエーション',
          },
        },
      ],
      answerId: 'correct',
      explanation: {
        en: 'The station finds the network (Beacon or Probe Response), authenticates (State 2) and associates (State 3). Open System authentication accepts everyone, so the real security check is the 4-way handshake that follows. Only after it (State 4) may data flow.',
        ja: 'STA はネットワークを見つけ（Beacon か Probe Response）、認証し（State 2）、アソシエーションする（State 3）。Open System 認証は誰でも受け入れるので、本当のセキュリティの確認はそのあとの 4 ウェイハンドシェイク。それが終わって（State 4）はじめてデータを送れる。',
      },
    },
    {
      id: 'proof',
      prompt: {
        en: 'How do the laptop and the AP show each other that they know the same passphrase?',
        ja: 'ノート PC と AP は、同じパスフレーズを知っていることをどうやって互いに示す？',
      },
      choices: [
        {
          id: 'public-key',
          text: {
            en: 'The laptop sends the PMK, encrypted with the AP’s public key',
            ja: 'ノート PC が PMK を AP の公開鍵で暗号化して送る',
          },
        },
        {
          id: 'passphrase',
          text: {
            en: 'The laptop puts the passphrase in message 2, protected by the Open System authentication',
            ja: 'ノート PC がメッセージ 2 にパスフレーズを入れる。Open System 認証が守る',
          },
        },
        {
          id: 'mic',
          text: {
            en: 'Each derives the PTK from the PMK and both nonces, and proves it with a MIC',
            ja: 'それぞれが PMK と両者のノンスから PTK を導き、MIC で示す',
          },
        },
      ],
      answerId: 'mic',
      explanation: {
        en: 'Neither the passphrase nor the PMK is ever sent. Both sides exchange random nonces and derive the same PTK from them. The MIC in message 2 proves that the laptop knows the PMK, and the MIC in message 3 proves that the AP does. The same check lets an eavesdropper test passphrase guesses offline, which is why WPA3 uses SAE.',
        ja: 'パスフレーズも PMK も送らない。両者は乱数のノンスを交換し、そこから同じ PTK を導く。メッセージ 2 の MIC はノート PC が PMK を知っていることを、メッセージ 3 の MIC は AP が知っていることを示す。同じ確認を使えば、盗み聞きした者がパスフレーズの推測をオフラインで試せる。そのため WPA3 は SAE を使う。',
      },
    },
    {
      id: 'relay',
      prompt: {
        en: 'A laptop and a phone are associated with the same AP. How does a packet from the laptop reach the phone?',
        ja: 'ノート PC とスマートフォンが同じ AP にアソシエーションしている。ノート PC のパケットはどうやってスマートフォンに届く？',
      },
      choices: [
        {
          id: 'two-frames',
          text: {
            en: 'In two frames: laptop to AP with ToDS=1, then AP to phone with FromDS=1',
            ja: '2 つのフレームで。ノート PC から AP へ ToDS=1、AP からスマートフォンへ FromDS=1',
          },
        },
        {
          id: 'direct',
          text: {
            en: 'In one frame sent directly to the phone, with ToDS=0 and FromDS=0',
            ja: 'スマートフォンに直接送る 1 つのフレームで。ToDS=0、FromDS=0',
          },
        },
        {
          id: 'wired',
          text: {
            en: 'It cannot: the AP only forwards packets to the wired LAN',
            ja: '届かない。AP は有線 LAN にしかパケットを転送しない',
          },
        },
      ],
      answerId: 'two-frames',
      explanation: {
        en: 'In infrastructure mode, every frame goes through the AP. On the way up, Address 1 is the BSSID and Address 3 the phone; on the way down, Address 1 is the phone and Address 3 the laptop. The AP decrypts with the laptop’s TK and re-encrypts with the phone’s. Direct frames with ToDS=0 and FromDS=0 are used in an IBSS (ad hoc).',
        ja: 'インフラストラクチャモードでは、フレームはすべて AP を通る。上りでは Address 1 が BSSID で Address 3 がスマートフォン、下りでは Address 1 がスマートフォンで Address 3 がノート PC。AP はノート PC の TK で復号し、スマートフォンの TK で暗号化し直す。ToDS=0、FromDS=0 で直接送るのは IBSS（アドホック）の場合。',
      },
    },
    {
      id: 'ack',
      prompt: {
        en: 'Why does a Wi-Fi sender wait for an Ack instead of detecting collisions as early Ethernet did?',
        ja: 'Wi-Fi の送信者が、初期の Ethernet のように衝突を検出せず、Ack を待つのはなぜ？',
      },
      choices: [
        {
          id: 'never',
          text: {
            en: 'Radio frames never collide, so the Ack is only for lost frames',
            ja: '無線のフレームは衝突しないので、Ack は失われたフレームのためだけにある',
          },
        },
        {
          id: 'scheduled',
          text: {
            en: 'The AP schedules every frame, so collisions cannot happen',
            ja: 'AP がすべてのフレームの順番を決めるので、衝突は起きない',
          },
        },
        {
          id: 'cannot-hear',
          text: {
            en: 'A sender cannot hear a collision at the receiver while it is transmitting',
            ja: '送信者は、送っている最中に受信者のところで起きた衝突を聞き取れない',
          },
        },
      ],
      answerId: 'cannot-hear',
      explanation: {
        en: 'While transmitting, a radio hears mostly its own signal, and the collision happens at the receiver, whose surroundings the sender may not hear at all (the hidden node problem). So 802.11 avoids collisions with carrier sense, DIFS and a random backoff, and learns of success only from the Ack. Without an Ack, the sender doubles CW and retransmits.',
        ja: '送っている最中の無線には、ほとんど自分の信号しか聞こえない。しかも衝突は受信者のところで起き、送信者にはその周りの電波がまったく聞こえないこともある（隠れ端末の問題）。そこで 802.11 は、キャリアセンス、DIFS、ランダムなバックオフで衝突を避け、送れたことは Ack でだけ知る。Ack が来なければ、CW を 2 倍にして再送する。',
      },
    },
  ],
}
