/** chunked の chunk-size（RFC 9112 §7.1: 本文のオクテット数を 16 進で。最後のチャンクは 0） */
export const chunkSizeHex = (text: string): string =>
  new TextEncoder().encode(text).length.toString(16)
