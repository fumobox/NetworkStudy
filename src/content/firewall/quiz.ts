import type { Quiz } from '@/components/features/quiz/types'

/** ステートフルファイアウォールの理解度クイズ（根拠は scenario.ts の RFC 6092・RFC 4787・RFC 9293 などの参照と同じ） */
export const firewallQuiz: Quiz = {
  id: 'firewall',
  questions: [
    {
      id: 'reply',
      prompt: {
        en: 'The only inbound rule drops new connections. Why is the server’s SYN, ACK let in?',
        ja: '内向きのルールは、新しい接続を捨てるものだけ。サーバーの SYN, ACK が通るのはなぜ？',
      },
      choices: [
        {
          id: 'port',
          text: { en: 'Port 443 is always open', ja: '443 番はいつも開いているから' },
        },
        {
          id: 'entry',
          text: {
            en: 'It matches the entry that the PC’s SYN created, so it is ESTABLISHED, not NEW',
            ja: 'PC の SYN が作ったエントリーに当てはまるので、NEW ではなく ESTABLISHED だから',
          },
        },
        {
          id: 'allow',
          text: {
            en: 'The server is on an allow list',
            ja: 'サーバーが許可リストに載っているから',
          },
        },
      ],
      answerId: 'entry',
      explanation: {
        en: 'The firewall looks up every packet in its state table before the rules. The SYN, ACK has the SYN’s addresses and ports swapped, so it belongs to that entry and rule 1 (ESTABLISHED, RELATED → accept) lets it in. No rule opens the PC’s port.',
        ja: 'ファイアウォールは、ルールの前にどのパケットも状態表で引く。SYN, ACK は SYN のアドレスとポートを入れ替えたものなので、そのエントリーに属し、ルール 1（ESTABLISHED, RELATED → accept）が通す。PC のポートを開けるルールはない。',
      },
    },
    {
      id: 'udp',
      prompt: {
        en: 'UDP has no handshake. How does the DNS answer get in?',
        ja: 'UDP にはハンドシェイクがない。DNS の応答はどうやって通る？',
      },
      choices: [
        {
          id: 'entry',
          text: {
            en: 'The query created an entry from its addresses and ports; a matching reply is accepted until the entry times out',
            ja: '問い合わせがアドレスとポートからエントリーを作り、エントリーがタイムアウトするまでは、当てはまる返事を通す',
          },
        },
        {
          id: 'always',
          text: {
            en: 'UDP is always allowed in',
            ja: 'UDP はいつも内向きに通す',
          },
        },
        {
          id: 'syn',
          text: {
            en: 'The firewall waits for the resolver to send a SYN',
            ja: 'ファイアウォールは、リゾルバーが SYN を送るのを待つ',
          },
        },
      ],
      answerId: 'entry',
      explanation: {
        en: 'For UDP the firewall keeps a pseudo-connection: an entry made from the first outgoing packet and kept alive only by an idle timer. After it expires, the same answer would be NEW and blocked.',
        ja: 'UDP では、ファイアウォールは擬似的な接続を持つ。最初の外向きのパケットから作り、アイドルタイマーだけで保つエントリー。消えた後は、同じ応答でも NEW になり止められる。',
      },
    },
    {
      id: 'drop',
      prompt: {
        en: 'With rule 3 set to drop, what does the sender of an unsolicited SYN see?',
        ja: 'ルール 3 が drop のとき、頼んでいない SYN を送った側には何が見える？',
      },
      choices: [
        { id: 'rst', text: { en: 'An RST', ja: 'RST' } },
        { id: 'icmp', text: { en: 'An ICMP error', ja: 'ICMP のエラー' } },
        {
          id: 'nothing',
          text: {
            en: 'Nothing: it retransmits the SYN and eventually gives up',
            ja: '何も見えない。SYN を再送し、いずれあきらめる',
          },
        },
      ],
      answerId: 'nothing',
      explanation: {
        en: 'drop discards the packet silently, so the sender waits and retransmits; a port scanner reports the port as “filtered”. With reject, the firewall answers instead: RST for TCP (“closed”, connection refused) or an ICMP error for UDP.',
        ja: 'drop はパケットを黙って捨てるので、送り手は待って再送する。ポートスキャナーはそのポートを「filtered」と報告する。reject なら、ファイアウォールが代わりに答える。TCP には RST（「closed」、接続の拒否）、UDP には ICMP のエラー。',
      },
    },
    {
      id: 'icmp',
      prompt: {
        en: 'Why should a firewall let in ICMP errors that are RELATED to a tracked connection?',
        ja: '追跡している接続に RELATED な ICMP のエラーを、ファイアウォールが通すべきなのはなぜ？',
      },
      choices: [
        {
          id: 'new',
          text: {
            en: 'They open new connections',
            ja: '新しい接続を開くから',
          },
        },
        {
          id: 'cannot',
          text: {
            en: 'ICMP cannot be filtered',
            ja: 'ICMP はフィルターできないから',
          },
        },
        {
          id: 'errors',
          text: {
            en: 'They report real problems such as port unreachable or fragmentation needed; blocking them hides errors and breaks path MTU discovery',
            ja: 'port unreachable や fragmentation needed のような本当の問題を知らせるから。止めるとエラーが見えなくなり、パス MTU 探索も壊れる',
          },
        },
      ],
      answerId: 'errors',
      explanation: {
        en: 'An ICMP error carries the start of the packet that caused it, including the ports, so the firewall can tell which connection it is about. Letting those through is safe and needed; RFC 6092 requires it for UDP and TCP flows.',
        ja: 'ICMP のエラーには、原因になったパケットの先頭（ポートも含む）が入っているので、ファイアウォールはどの接続についてのものかわかる。それを通すのは安全で、必要でもある。RFC 6092 は UDP と TCP の流れについて、それを求めている。',
      },
    },
  ],
}
