import { readFileSync } from 'fs'
import { execSync } from 'child_process'

// --- Encoding guard ---------------------------------------------------------
//
// Catches UTF-8 text that was saved as Windows-1252 ("mojibake"), which is
// invisible in a diff review but very visible in the UI: the multiplication
// sign on removable chips renders as two Latin-1 characters, and em dashes
// render as three. This shipped to production once, in
// app/onboarding/OnboardingClient.tsx, where the corruption sat alongside
// correctly-encoded characters in the same file - so "the file looks fine" is
// not evidence.
//
// Deliberately a byte/codepoint check rather than a lint rule: ESLint parses
// source as already-decoded text and has no opinion about which characters are
// plausible, so it cannot see this class of bug at all.
//
// IMPORTANT - why every pattern below uses \u escapes, and why this whole file
// is plain ASCII: this file is itself scanned by this check. Spelling the
// corrupt sequences literally makes the guard fail on its own source, which is
// exactly what happened the first time it ran after being committed. Escapes
// keep the file pure ASCII so it can be checked like every other file, instead
// of needing a self-exemption - and an exemption would blind the guard to real
// corruption landing here later. One sequence also ends in a C1 control
// character, which is worth never pasting literally anywhere.
//
// Run via `npm run check:encoding`. Cheap enough to run before every commit.
// ---------------------------------------------------------------------------

// Each entry is the CP1252 misreading of one UTF-8 character's bytes, written
// as an exact full sequence rather than a loose prefix: an earlier version
// matched a bare two-character prefix and fired on anything containing it.
const MOJIBAKE: Array<{ pattern: RegExp; meaning: string }> = [
  // U+2014 em dash, bytes E2 80 94
  { pattern: /\u00e2\u20ac\u201d/g, meaning: 'em dash saved as CP1252' },
  // U+201C opening curly quote, bytes E2 80 9C
  { pattern: /\u00e2\u20ac\u0153/g, meaning: 'opening curly quote saved as CP1252' },
  // U+201D closing curly quote, bytes E2 80 9D (ends in a C1 control char)
  { pattern: /\u00e2\u20ac\u009d/g, meaning: 'closing curly quote saved as CP1252' },
  // U+2019 curly apostrophe, bytes E2 80 99
  { pattern: /\u00e2\u20ac\u2122/g, meaning: 'curly apostrophe saved as CP1252' },
  // U+2500 box drawing, bytes E2 94 80 (the comment rules used across this repo)
  { pattern: /\u00e2\u201d\u20ac/g, meaning: 'box drawing rule saved as CP1252' },
  // U+00D7 multiplication sign, bytes C3 97 (the chip remove button)
  { pattern: /\u00c3\u2014/g, meaning: 'multiplication sign saved as CP1252' },
  // Accented Latin letters, bytes C3 xx
  { pattern: /\u00c3[\u00a9\u00a8\u00a1\u00ad\u00b3\u00ba]/g, meaning: 'accented letter saved as CP1252' },
  // Stray U+00C2 before a space or symbol - residue of the same misreading
  { pattern: /\u00c2[\u00a0\u00a9\u00ae\u00b0\u00b1\u00b7\u00bb]/g, meaning: 'stray capital-A-circumflex before punctuation (CP1252)' },
]

const files = execSync('git ls-files "*.ts" "*.tsx" "*.md" "*.json" "*.css"', {
  encoding: 'utf-8',
})
  .split('\n')
  .filter(Boolean)

let failures = 0

for (const file of files) {
  const buf = readFileSync(file)

  // A UTF-8 BOM is not corruption on its own, but it is the fingerprint of an
  // editor writing files in a Windows-default encoding - the same editor that
  // produces the mojibake above. Flagging it catches the cause, not just the
  // symptom. It also breaks tooling that expects a file to start with its
  // first real character.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    console.error(`${file}: starts with a UTF-8 BOM`)
    failures++
  }

  const text = buf.toString('utf-8')
  for (const { pattern, meaning } of MOJIBAKE) {
    pattern.lastIndex = 0
    const hits = text.match(pattern)
    if (!hits) continue
    // Report the first offending line so the fix is one jump away.
    const idx = text.search(pattern)
    const line = text.slice(0, idx).split('\n').length
    console.error(
      `${file}:${line}: ${hits.length}x ${meaning} - found ${JSON.stringify(hits[0])}`,
    )
    failures++
  }
}

if (failures > 0) {
  console.error(
    `\nFAIL: ${failures} encoding problem(s). Re-save the file(s) as UTF-8 without a BOM.`,
  )
  process.exit(1)
}

console.log(`OK: encoding clean (${files.length} files checked)`)
