// Streak + publish-nudge logic. v1 uses approval as the publish proxy
// (per the build plan: approval-as-proxy drives the create behavior; real
// publish tracking needs a "mark as posted" toggle or an integration later).

// Days of silence tolerated before the nudge fires, derived from the cadence
// the user themselves committed to in onboarding — "you said 2x a week"
// lands harder than an arbitrary number.
export const CADENCE_THRESHOLD_DAYS: Record<string, number> = {
  'Daily': 2,
  '3-5x per week': 3,
  '2x per week': 4,
  'Weekly': 8,
  'Bi-weekly': 15,
}

const DEFAULT_THRESHOLD_DAYS = 8
const WEEK_MS = 7 * 24 * 3600_000

// Consecutive 7-day windows (walking back from now) with at least one
// approval. The current in-progress window gets grace: an empty current week
// doesn't break a streak that's alive up to last week.
export function computeStreakWeeks(approvedAt: Date[], now = new Date()): number {
  if (approvedAt.length === 0) return 0
  const times = approvedAt.map(d => d.getTime())

  let streak = 0
  for (let w = 0; ; w++) {
    const end = now.getTime() - w * WEEK_MS
    const start = end - WEEK_MS
    const hasApproval = times.some(t => t >= start && t < end)
    if (hasApproval) {
      streak++
    } else if (w === 0) {
      continue // grace for the current week in progress
    } else {
      break
    }
  }
  return streak
}

export interface NudgeState {
  streakWeeks: number
  daysSinceLastApproval: number | null
  thresholdDays: number
  nudge: boolean
  message: string | null
}

// The nudge re-engages users who've gone *quiet*. Approval is the publish
// proxy, but "quiet" must also account for generation activity: someone
// actively drafting this week clearly hasn't abandoned the product, so nagging
// "your audience hasn't heard from you" at them reads as a bug. `lastActivityAt`
// is the most recent content piece created (any status). If they've created
// anything within their cadence window — and always within at least the last
// week — we treat them as engaged and suppress the nudge.
export function computeNudge(
  approvedAt: Date[],
  cadence: string | undefined,
  lastActivityAt: Date | null = null,
  now = new Date(),
): NudgeState {
  const thresholdDays = CADENCE_THRESHOLD_DAYS[cadence || ''] ?? DEFAULT_THRESHOLD_DAYS
  const streakWeeks = computeStreakWeeks(approvedAt, now)

  const DAY_MS = 24 * 3600_000
  const daysSinceActivity = lastActivityAt
    ? Math.floor((now.getTime() - lastActivityAt.getTime()) / DAY_MS)
    : null
  // Grace is at least a week so recent activity always silences the nudge,
  // widening to the cadence window for less-frequent posters.
  const activityGraceDays = Math.max(thresholdDays, 7)
  const recentlyActive =
    daysSinceActivity !== null && daysSinceActivity <= activityGraceDays

  if (approvedAt.length === 0) {
    // Never approved. Only nudge someone who generated but then went quiet past
    // the grace window — never a brand-new user (no activity at all; the
    // dashboard empty state already guides them) and never an active drafter.
    const nudge = daysSinceActivity !== null && !recentlyActive
    return {
      streakWeeks: 0,
      daysSinceLastApproval: null,
      thresholdDays,
      nudge,
      message: nudge
        ? "You've got drafts but haven't approved one yet — approve a piece to start your streak."
        : null,
    }
  }

  const last = Math.max(...approvedAt.map(d => d.getTime()))
  const daysSince = Math.floor((now.getTime() - last) / DAY_MS)
  const nudge = daysSince > thresholdDays && !recentlyActive

  return {
    streakWeeks,
    daysSinceLastApproval: daysSince,
    thresholdDays,
    nudge,
    message: nudge
      ? `Your audience hasn't heard from you in ${daysSince} days${cadence ? ` — you planned ${cadence.toLowerCase()}` : ''}.`
      : null,
  }
}
