/**
 * Thai Kedmanee keyboard back to US QWERTY. Client-safe and pure.
 *
 * A barcode scanner types like a keyboard: it presses the keys that spell the code on a US layout. If the computer is
 * set to Thai, those same key presses produce Thai letters, so "LW252" arrives as Thai characters. Mapping each Thai
 * character back to the key that made it recovers the code.
 *
 * Three rules keep this safe:
 *   - Text with no Thai character is returned unchanged. A real hyphen or slash in an English scan is never altered.
 *   - Once a string contains Thai, every character is treated as typed on the Thai layout. That includes the ASCII
 *     symbols the Thai layout itself produces, so "/" is the 2 key and "-" is the 3 key, since the real slash and hyphen
 *     keys give Thai letters on that layout.
 *   - ASCII letters and digits are never in the table, so they stay as they are.
 */

// The two rows of keys, in the same order: unshifted first, then shifted.
const US_UNSHIFTED = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
const THAI_UNSHIFTED = "_ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฃฟหกดเ้่าสวงผปแอิืทมใฝ";
const US_SHIFTED = '~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
const THAI_SHIFTED = '%+๑๒๓๔ู฿๕๖๗๘๙๐"ฎฑธํ๊ณฯญฐ,ฅฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ';

/** Thai-layout output character to the US character on the same key. */
const THAI_TO_US: Record<string, string> = {};
for (let index = 0; index < US_UNSHIFTED.length; index += 1) {
  THAI_TO_US[THAI_UNSHIFTED.charAt(index)] = US_UNSHIFTED.charAt(index);
}
for (let index = 0; index < US_SHIFTED.length; index += 1) {
  THAI_TO_US[THAI_SHIFTED.charAt(index)] = US_SHIFTED.charAt(index);
}

const THAI_RANGE = /[\u0E00-\u0E7F]/;

/** True when the text holds at least one Thai character. */
export function containsThai(text: string): boolean {
  return THAI_RANGE.test(text);
}

/**
 * Converts text typed on the Thai Kedmanee layout back to the US keys that were pressed. Text without any Thai
 * character is returned as it came.
 */
export function thaiToEnglish(text: string): string {
  if (!containsThai(text)) return text;
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    out += Object.prototype.hasOwnProperty.call(THAI_TO_US, char) ? THAI_TO_US[char] : char;
  }
  return out;
}
