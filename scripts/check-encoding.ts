import { readFileSync } from 'fs'
import { execSync } from 'child_process'

// ─── Encoding guard ──────────────────────────────────────────────────────────
//
// Catches UTF-8 text that was saved as Windows-1252 ("mojibake"), which is
// invisible in a diff review but very visible in the UI: the × on removable
// chips renders as "Ã—", em dashes render as "â€”". This shipped to production
// once in app/onboarding/OnboardingClient.tsx, where the corruption was mixed
// in with correctly-encoded characters in the same file — so "the file looks
// fine" is not evidence.
//
// Deliberately a byte/codepoint check rather than a lint rule: ESLint parses
// source as already-decoded text and has no opinion about which characters are
// plausible, so it cannot see this class of bug at all.
//
// Run via `npm run check:encoding`. Cheap enough to run on every commit.
// ─────────────────────────────────────────────────────────────────────────────

// Sequences that are the CP1252 misreading of common UTF-8 characters. Each is
// vanishingly unlikely to be intentional in this codebase; if a legitimate use
// ever appears (a language sample containing "Ã", say), narrow the check to the
// specific file rather than deleting the entry.
const MOJIBAKE: Array<{ pattern: RegExp; meaning: string }> = [
  { pattern: /â€"/g, meaning: 'em/en dash (—) saved as CP1252' },
  { pattern: /â€œ|â€/g, meaning: 'curly quotes saved as CP1252' },
  { pattern: /â€™/g, meaning: 'apostrophe (’) saved as CP1252' },
  { pattern: /â”€/g, meaning: 'box drawing (─) saved as CP1252' },
  { pattern: /Ã—/g, meaning: 'multiplication sign (×) saved as CP1252' },
  { pattern: /Ã©|Ã¨|Ã¡|Ã­|Ã³|Ãº/g, meaning: 'accented letter saved as CP1252' },
  { pattern: /Â[\s©®°±·»]/g, meaning: 'stray Â before punctuation (CP1252)' },
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
  // editor writing files in a Windows-default encoding — the same editor that
  // produces the mojibake below. Flagging it catches the cause, not just the
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
    console.error(`${file}:${line}: ${hits.length}x ${meaning} — found ${JSON.stringify(hits[0])}`)
    failures++
  }
}

if (failures > 0) {
  console.error(
    `\n✗ ${failures} encoding problem(s). Re-save the file(s) as UTF-8 without a BOM.`,
  )
  process.exit(1)
}

console.log(`✓ Encoding clean (${files.length} files checked)`)
