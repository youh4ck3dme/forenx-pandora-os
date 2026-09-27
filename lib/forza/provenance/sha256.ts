// ─── SHA-256 (NIST FIPS 180-4) ───────────────────────────────────

/**
 * Deterministický výpočet SHA-256 podľa štandardu FIPS 180-4.
 * Funguje 100 % synchrónne v Node.js aj v prehliadači bez externých závislostí.
 */
export function sha256HexBytes(bytes: Uint8Array): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const bitLength = bytes.length * 8;
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] ?? 0) | (bytes[i] << ((3 - (i % 4)) * 8));
  }
  words[bytes.length >> 2] =
    (words[bytes.length >> 2] ?? 0) | (0x80 << ((3 - (bytes.length % 4)) * 8));
  const totalWords = (((bytes.length + 8) >> 6) + 1) * 16;
  while (words.length < totalWords) words.push(0);
  words[totalWords - 2] = Math.floor(bitLength / maxWord);
  words[totalWords - 1] = bitLength >>> 0;

  const k: number[] = [];
  let hash: number[] = [];
  let primeCounter = 0;
  for (let candidate = 2; primeCounter < 64; candidate++) {
    let isComp = false;
    for (let i = 2; i * i <= candidate; i++) {
      if (candidate % i === 0) {
        isComp = true;
        break;
      }
    }
    if (!isComp) {
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);

  for (let j = 0; j < words.length; j += 16) {
    const w = words.slice(j, j + 16);
    const oldHash = [...hash];
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const a = hash[0],
        e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i] | 0
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [
        (temp1 + temp2) | 0,
        hash[0],
        hash[1],
        hash[2],
        (hash[3] + temp1) | 0,
        hash[4],
        hash[5],
        hash[6],
      ];
    }
    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  let result = "";
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = (hash[i] >>> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

/** SHA-256 nad UTF-8 kódovaním reťazca. */
export function sha256Hex(str: string): string {
  return sha256HexBytes(new TextEncoder().encode(str));
}
