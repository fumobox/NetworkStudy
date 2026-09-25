import type { LocalizedText } from '@/lib/i18n/locale'
import { HOST, VALIDATION_DATE } from './scenario'

/** 証明書チェーンのパネル（CertChainPanel）の文言。用語集のテスト（glossary.test.tsx）でも検査する */
export const CERT_CHAIN_TEXT = {
  title: { en: 'Certificate chain', ja: '証明書チェーン' },
  checkedAt: {
    en: `Checked as of ${VALIDATION_DATE}`,
    ja: `${VALIDATION_DATE} 時点で確かめる`,
  },
  notReceived: {
    en: 'The server has not sent its certificates yet.',
    ja: 'サーバーはまだ証明書を送っていない。',
  },
  notSent: { en: 'Not sent by the server', ja: 'サーバーが送ってこなかった' },
  issuedBy: { en: 'Issued (signed) by', ja: '発行（署名）した CA' },
  validUntil: { en: 'Valid until', ja: '有効期限' },
  names: { en: 'Names (SAN)', ja: '名前（SAN）' },
  roles: [
    { en: 'Server certificate', ja: 'サーバー証明書' },
    { en: 'Intermediate CA', ja: '中間 CA' },
    { en: 'Root CA', ja: 'ルート CA' },
  ],
  checks: {
    signature: { en: 'Signature by the issuer', ja: '発行元の署名' },
    validity: { en: 'Within the validity period', ja: '有効期間内' },
    name: { en: `Issued for ${HOST}`, ja: `${HOST} 向け` },
    trust: { en: 'In the client’s trust store', ja: 'クライアントの信頼ストアにある' },
  },
  results: {
    ok: { en: 'OK', ja: '合格' },
    ng: { en: 'Failed', ja: '不合格' },
    unknown: { en: 'Cannot check', ja: '確かめられない' },
    pending: { en: 'Not checked yet', ja: '未確認' },
  },
} satisfies Record<string, LocalizedText | readonly LocalizedText[] | Record<string, LocalizedText>>
