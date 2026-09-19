/**
 * test/name-check.mjs - inspect exactly what the name sanitizer does.
 *
 *   npm run check:name -- "José María"
 *   npm run check:name -- "emoji 🎮 ok"
 *
 * Isolates the SERVER-SIDE layer of name handling. If a name survives
 * here but looks wrong in the browser, the problem is in the page (input
 * attribute, CSS, or a stale cached build), not in the sanitizer.
 */
import { sanitizeName, MAX_NAME_LENGTH } from '../src/network/protocol.js';

const input = process.argv[2];
if (input === undefined) {
  console.log('usage: npm run check:name -- "the name to test"');
  process.exit(1);
}

const { name, note } = sanitizeName(input);

console.log('input    :', JSON.stringify(input));
console.log('output   :', JSON.stringify(name));
console.log('identical:', name === input ? 'yes' : 'NO - see below');
if (note) console.log('reason   :', note);
if (name !== input) {
  // Show which characters were affected, so a change is never mysterious.
  const removed = [...input].filter((ch) => !name.includes(ch));
  if (removed.length) {
    console.log(
      'dropped  :',
      [...new Set(removed)]
        .map((ch) => `${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`)
        .join(', ')
    );
  }
  if (input.trim().length > MAX_NAME_LENGTH) {
    console.log(`length   : ${input.length} chars, limit is ${MAX_NAME_LENGTH}`);
  }
}
