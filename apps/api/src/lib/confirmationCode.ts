import { randomBytes } from "node:crypto";

// Crockford base32, no ambiguous glyphs (I, L, O, U excluded), matching
// packages/types' confirmationCodeSchema regex exactly. 32 symbols, so
// byte % 32 has no modulo bias over a 256-value byte.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateConfirmationCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
