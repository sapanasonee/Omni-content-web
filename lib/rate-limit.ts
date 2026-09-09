// ─── Why this module exists ──────────────────────────────────────────────────
//
// Two routes accept requests with NO authentication at all — /api/waitlist and
// /api/notify-signin — and each one both writes a row to Supabase and sends an
// email through Resend. Unthrottled, either is a free amplifier pointed at the
// founder's inbox: a trivial loop floods it, burns the Resend send quota, harms
// the sending domain's reputation, and fills `waitlist` / `login_events` with
// fabricated rows — which quietly destroys the New-vs-Returning engagement
// numbers those tables exist to produce.
//
// Deliberate scope and its limits, stated plainly so nobody mistakes this for
// more than it is:
//   - State is IN-MEMORY and therefore PER CLOUD RUN INSTANCE. Under
//     horizontal scale, the effective ceiling is (instances x max). This is a
//     blast-radius reducer, not a distributed guarantee. A real global limit
//     needs shared state (a Postgres counter or Redis) — worth adding if these
//     endpoints ever get seriously targeted.
//   - Client IP comes from X-Forwarded-For, which a caller can prepend to.
//     That is why every rule also carries a GLOBAL cap: rotating or spoofing
//     the IP moves an attacker from the per-key bucket into the global one
//     instead of escaping limits entirely.
//   - The tracking map is itself bounded (MAX_TRACKED_KEYS) and pruned on
//     every call, so the limiter can't be turned into a memory-exhaustion
//     vector by cycling through unique keys.
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitRule {
  windowMs: number
  // Max requests per key (usually one client IP) inside the window.
  max: number
  // Max requests across ALL keys inside the window, on this instance. Catches
  // the IP-rotation case the per-key limit can't see.
  globalMax: number
}

export interface RateLimitResult {
  allowed: boolean
  // Seconds until the caller may retry — suitable for a Retry-After header.
  retryAfter: number
}

// Timestamps (ms) of recent hits, newest last. Trimmed to the window on read.
const buckets = new Map<string, number[]>()
let globalHits: number[] = []

// Bounds memory. Well above the number of distinct IPs a legitimate early
// access product sees in one window; when exceeded, the least-recently-active
// keys are dropped (they are the ones closest to expiring anyway).
const MAX_TRACKED_KEYS = 10_000

function trim(hits: number[], cutoff: number): number[] {
  // Hits are appended in time order, so the surviving entries are a suffix.
  let i = 0
  while (i < hits.length && hits[i] <= cutoff) i++
  return i === 0 ? hits : hits.slice(i)
}

function prune(cutoff: number): void {
  // forEach / Array.from rather than for..of over the Map: this project's
  // tsconfig target predates downlevel iteration of Map iterators.
  const expired: string[] = []
  buckets.forEach((hits, key) => {
    const kept = trim(hits, cutoff)
    if (kept.length === 0) expired.push(key)
    else if (kept.length !== hits.length) buckets.set(key, kept)
  })
  expired.forEach(key => buckets.delete(key))

  if (buckets.size <= MAX_TRACKED_KEYS) return
  // Over the cap: drop the keys whose most recent hit is oldest.
  const byStaleness = Array.from(buckets.entries())
    .sort((a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0))
  byStaleness
    .slice(0, buckets.size - MAX_TRACKED_KEYS)
    .forEach(([key]) => buckets.delete(key))
}

// Records a hit and reports whether it is allowed. Call ONCE per request, and
// only after cheap validation — a request rejected as malformed shouldn't
// consume a legitimate user's allowance.
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now()
  const cutoff = now - rule.windowMs

  prune(cutoff)
  globalHits = trim(globalHits, cutoff)

  const hits = trim(buckets.get(key) ?? [], cutoff)

  const overKey = hits.length >= rule.max
  const overGlobal = globalHits.length >= rule.globalMax
  if (overKey || overGlobal) {
    // Retry-After is derived from whichever window actually blocked, so a
    // caller throttled by the global cap isn't told to wait on their own.
    const blocking = overKey ? hits : globalHits
    const oldest = blocking[0] ?? now
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    }
  }

  hits.push(now)
  buckets.set(key, hits)
  globalHits.push(now)
  return { allowed: true, retryAfter: 0 }
}

// Best-effort client identity for rate-limit keying. On Cloud Run the platform
// appends the real peer address to X-Forwarded-For, but a caller may also send
// their own value, so this is a bucketing hint and NOT an authentication
// signal — never gate access on it. Requests with no usable header share one
// bucket, which is the conservative behavior (they throttle each other).
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  return request.headers.get('x-real-ip')?.slice(0, 64) || 'unknown'
}
