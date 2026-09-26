import type { Quiz } from '@/components/features/quiz/types'

/** DHCP の理解度クイズ（根拠: RFC 2131 §3.1、§4.1、§4.3.2、§4.4.5） */
export const dhcpQuiz: Quiz = {
  id: 'dhcp',
  questions: [
    {
      id: 'discover-source',
      prompt: {
        en: 'What source IP address does a PC use for DHCPDISCOVER?',
        ja: 'PC が DHCPDISCOVER を送るときの送信元の IP アドレスは？',
      },
      choices: [
        { id: 'zero', text: { en: '0.0.0.0', ja: '0.0.0.0' } },
        { id: 'broadcast', text: { en: '255.255.255.255', ja: '255.255.255.255' } },
        { id: 'last', text: { en: 'The address it used last time', ja: '前に使ったアドレス' } },
        { id: 'gateway', text: { en: '192.168.1.1', ja: '192.168.1.1' } },
      ],
      answerId: 'zero',
      explanation: {
        en: 'The PC has no address yet, so it sends from 0.0.0.0 to the broadcast address 255.255.255.255.',
        ja: 'PC にはまだアドレスがないので、0.0.0.0 からブロードキャストアドレス 255.255.255.255 に送る。',
      },
    },
    {
      id: 'request-broadcast',
      prompt: {
        en: 'Why is the DHCPREQUEST after an offer still broadcast?',
        ja: '提示を受けた後の DHCPREQUEST を、まだブロードキャストで送るのはなぜ？',
      },
      choices: [
        {
          id: 'others',
          text: {
            en: 'So that any other server that made an offer learns it was not chosen',
            ja: 'ほかに提示したサーバーに、選ばれなかったことを知らせるため',
          },
        },
        {
          id: 'faster',
          text: {
            en: 'Broadcast is faster than unicast',
            ja: 'ブロードキャストの方がユニキャストより速いから',
          },
        },
        {
          id: 'dns',
          text: { en: 'To register the PC’s name in DNS', ja: 'PC の名前を DNS に登録するため' },
        },
      ],
      answerId: 'others',
      explanation: {
        en: 'The PC has not configured the address yet, and several servers may have made offers. Broadcasting the request with the chosen server’s ID (option 54) tells all of them which offer was taken.',
        ja: 'PC はまだアドレスを設定しておらず、複数のサーバーが提示しているかもしれない。選んだサーバーの識別子（オプション 54）を付けて要求をブロードキャストすると、どの提示が選ばれたかが全員にわかる。',
      },
    },
    {
      id: 't1',
      prompt: {
        en: 'The lease is 3600 seconds. When does the PC start renewing it (T1)?',
        ja: 'リースが 3600 秒のとき、PC が更新を始める（T1）のはいつ？',
      },
      choices: [
        { id: 'end', text: { en: 'After 3600 seconds', ja: '3600 秒後' } },
        { id: 't2', text: { en: 'After 3150 seconds', ja: '3150 秒後' } },
        { id: 'half', text: { en: 'After 1800 seconds', ja: '1800 秒後' } },
      ],
      answerId: 'half',
      explanation: {
        en: 'By default T1 is half of the lease (1800 s). If renewing fails, the PC tries any server at T2, 7/8 of the lease (3150 s).',
        ja: 'T1 は既定でリースの半分（1800 秒）。更新できなければ、リースの 8 分の 7 の T2（3150 秒）で、どのサーバーにでも頼む。',
      },
    },
    {
      id: 'nak',
      prompt: {
        en: 'What does the PC do after receiving DHCPNAK?',
        ja: 'DHCPNAK を受け取った PC はどうする？',
      },
      choices: [
        {
          id: 'keep',
          text: {
            en: 'Keeps using the address until the lease ends',
            ja: 'リースが終わるまでアドレスを使い続ける',
          },
        },
        {
          id: 'retry',
          text: { en: 'Sends the same DHCPREQUEST again', ja: '同じ DHCPREQUEST をもう一度送る' },
        },
        {
          id: 'restart',
          text: {
            en: 'Stops using the address and starts again from DHCPDISCOVER',
            ja: 'アドレスを使うのをやめ、DHCPDISCOVER からやり直す',
          },
        },
      ],
      answerId: 'restart',
      explanation: {
        en: 'A NAK means the address cannot be used. The client goes back to INIT and starts the whole process again.',
        ja: 'NAK は、そのアドレスは使えないという意味。クライアントは INIT に戻り、最初からやり直す。',
      },
    },
  ],
}
