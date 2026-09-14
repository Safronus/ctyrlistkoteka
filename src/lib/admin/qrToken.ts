import { randomBytes } from "node:crypto";

/**
 * Tokens for the /go/<token> redirect.
 *
 * Unambiguous alphabet (no 0/O/1/l/I): tokens occasionally get read by a
 * human off a printed URL, and a typo must never land on someone else's
 * code. Page codes use eight characters, CaSQB codes six — one QR
 * version smaller, which matters on a business card.
 */
const TOKEN_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function genQrToken(length: number): string {
  const bytes = randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i++) {
    s += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return s;
}
