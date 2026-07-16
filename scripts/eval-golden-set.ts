// ─── Golden-set eval for the linter + LLM critic ─────────────────────────────
//
// The regression net for the product's wedge. Whenever lib/ai-tells.ts patterns
// or the critic prompt get edited, this proves two things BEFORE users do:
//   1. Known AI-sounding samples still get flagged   (eval/golden-set/must-flag.json)
//   2. Genuine human posts still pass untouched      (eval/golden-set/must-pass.json)
// A must-pass regression is the worse failure: flagging a founder's real voice
// destroys trust in the whole "sound like you" promise.
//
// Usage:
//   npm run eval            — linter only (free, instant, deterministic; CI-safe)
//   npm run eval -- --critic — also run the LLM critic cases
//                              (needs live GCP creds; ~$0.0005/case; scored
//                              against a threshold because LLM output varies)
//
// Exit codes: 0 = all green; 1 = failures. Linter checks are strict (any miss
// fails); critic accuracy must reach CRITIC_ACCURACY_THRESHOLD.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs'
import { join } from 'path'
import { runLinter, runLLMCritic } from '../lib/critic'
import { AI_TELLS } from '../lib/ai-tells'
import type { OnboardingData } from '../lib/types'

const GOLDEN_DIR = join(__dirname, '..', 'eval', 'golden-set')
const CRITIC_ACCURACY_THRESHOLD = 0.8

interface FlagSample { id: string; expect: string[]; text: string; note?: string }
interface PassSample { id: string; text: string; note?: string }
interface CriticCase {
  id: string
  should_flag: boolean
  note: string
  user_input: string
  draft: string
}

function loadJSON<T>(file: string): T {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as T
}

// Which tell ids fired — mirrors runLinter's matching so `expect` can verify a
// sample flags for the RIGHT reason (a sample tripping only an unintended
// pattern is a rotten sample). runLinter stays the authoritative pass/fail.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firedIds(text: string): string[] {
  const ids: string[] = []
  for (const tell of AI_TELLS) {
    try {
      const pattern = new RegExp(tell.isRegex ? tell.match : escapeRegex(tell.match), 'i')
      if (pattern.test(text)) ids.push(tell.id)
    } catch {
      // invalid pattern — runLinter logs it; nothing to record here
    }
  }
  if ((text.match(/:/g) || []).length > 3) ids.push('heuristic:colons')
  if (text.length < 50) ids.push('heuristic:too-short')
  return ids
}

// ─── Linter eval ─────────────────────────────────────────────────────────────

function evalLinter(): boolean {
  const mustFlag = loadJSON<{ samples: FlagSample[] }>('must-flag.json').samples
  const mustPass = loadJSON<{ samples: PassSample[] }>('must-pass.json').samples

  let failures = 0

  console.log(`\n── Must-flag (${mustFlag.length} samples) ─────────────────────────────`)
  for (const s of mustFlag) {
    const violations = runLinter(s.text)
    const fired = firedIds(s.text)
    const missing = s.expect.filter(e => !fired.includes(e))

    if (violations.length === 0) {
      failures++
      console.log(`✗ ${s.id} NOT FLAGGED (expected: ${s.expect.join(', ')})`)
      console.log(`    "${s.text.slice(0, 90)}…"`)
    } else if (missing.length > 0) {
      failures++
      console.log(`✗ ${s.id} flagged, but expected tell(s) did not fire: ${missing.join(', ')}`)
      console.log(`    fired instead: ${fired.join(', ') || '(heuristics only)'}`)
    }
  }
  const flagFails = failures

  console.log(`\n── Must-pass (${mustPass.length} samples) ─────────────────────────────`)
  for (const s of mustPass) {
    const violations = runLinter(s.text)
    if (violations.length > 0) {
      failures++
      console.log(`✗ ${s.id} FALSE POSITIVE${s.note ? ` (${s.note})` : ''}`)
      for (const v of violations) console.log(`    ${v}`)
      console.log(`    "${s.text.slice(0, 90)}…"`)
    }
  }
  const passFails = failures - flagFails

  console.log(`\nLinter: ${mustFlag.length - flagFails}/${mustFlag.length} must-flag ok, ${mustPass.length - passFails}/${mustPass.length} must-pass ok`)
  return failures === 0
}

// ─── Critic eval ─────────────────────────────────────────────────────────────

async function evalCritic(): Promise<boolean> {
  if (!process.env.GCP_PROJECT_ID) {
    console.error('\n--critic requires GCP_PROJECT_ID (and application-default credentials).')
    return false
  }

  const { fixture_dna, cases } = loadJSON<{ fixture_dna: OnboardingData; cases: CriticCase[] }>('critic-cases.json')

  console.log(`\n── Critic (${cases.length} cases, live LLM calls) ──────────────────────`)
  let correct = 0
  let errors = 0

  // Sequential on purpose: a handful of cases, and parallel calls make quota
  // blips look like eval failures.
  for (const c of cases) {
    const result = await runLLMCritic(fixture_dna, c.user_input, c.draft)
    if (result === null) {
      errors++
      console.log(`! ${c.id} critic call failed (null) — not scored`)
      continue
    }
    const flagged = !result.passed
    if (flagged === c.should_flag) {
      correct++
    } else {
      const issues = [...result.voice_issues, ...result.ungrounded_claims, ...result.avoid_violations]
      console.log(`✗ ${c.id} expected ${c.should_flag ? 'FLAG' : 'PASS'}, got ${flagged ? 'FLAG' : 'PASS'} — ${c.note}`)
      if (issues.length > 0) console.log(`    critic said: ${issues.slice(0, 3).join(' | ')}`)
    }
  }

  const scored = cases.length - errors
  const accuracy = scored > 0 ? correct / scored : 0
  console.log(`\nCritic: ${correct}/${scored} correct (${(accuracy * 100).toFixed(0)}%), ${errors} call error(s) — threshold ${CRITIC_ACCURACY_THRESHOLD * 100}%`)
  return scored > 0 && accuracy >= CRITIC_ACCURACY_THRESHOLD
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const withCritic = process.argv.includes('--critic')

  const linterOk = evalLinter()
  const criticOk = withCritic ? await evalCritic() : true

  if (!withCritic) {
    console.log('(critic cases skipped — pass --critic to run them against live Gemini)')
  }

  if (linterOk && criticOk) {
    console.log('\n✓ Golden set green')
    process.exit(0)
  } else {
    console.log('\n✗ Golden set FAILED')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Eval crashed:', err)
  process.exit(1)
})
