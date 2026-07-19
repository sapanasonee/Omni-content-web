// ─── Comment goals ───────────────────────────────────────────────────────────
//
// Why comments exist as a feature: founders see posts in their niche and think
// "my take on this would show my thinking" — commenting is the highest-leverage
// visibility surface on LinkedIn (more people read big posts' comments than
// most people's own posts). The goal the user picks frames WHY they're
// commenting, and the instruction steers the model accordingly.
//
// Centralized (client + route) like lib/rejection-feedback.ts: values are
// validated server-side, labels rendered client-side, instructions are
// prompt-bound — one file keeps all three in lockstep.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommentGoalDef {
  value: string
  label: string
  // What the user sees as a hint under the chip.
  hint: string
  // The instruction injected into the comment prompt.
  instruction: string
}

export const COMMENT_GOALS: readonly CommentGoalDef[] = [
  {
    value: 'insight',
    label: 'Add an insight',
    hint: 'Extend one of their points with your own observation',
    instruction:
      "Pick ONE specific point from the post and extend it with a sharp observation of your own — something the author didn't say but their readers would find genuinely useful. Never restate the post.",
  },
  {
    value: 'experience',
    label: 'Share experience',
    hint: 'A moment from your own work that confirms or complicates it',
    instruction:
      'Respond with a brief, concrete first-person experience that confirms or complicates one specific point in the post. Real texture (what happened, what it taught) — not a vague "this resonates".',
  },
  {
    value: 'question',
    label: 'Ask a sharp question',
    hint: 'Open a real discussion the author will want to answer',
    instruction:
      'Ask ONE pointed, genuinely curious question about a specific claim or gap in the post — the kind the author would want to answer publicly. Optionally one sentence of context first. Never ask something the post already answers.',
  },
  {
    value: 'disagree',
    label: 'Push back',
    hint: 'Respectfully challenge one specific claim',
    instruction:
      'Respectfully push back on ONE specific claim with a concrete reason or counter-example. Confident but generous — challenge the idea, never the person. No hedging walls ("just my two cents").',
  },
  {
    value: 'support',
    label: 'Amplify',
    hint: 'Back it up with a concrete reason why it matters',
    instruction:
      "Amplify the post's core point by adding a concrete reason, consequence, or example of why it matters — give readers something new. NEVER empty praise ('Great post!', 'So true') — the added substance is the whole point.",
  },
] as const

export const COMMENT_GOAL_VALUES: readonly string[] = COMMENT_GOALS.map(g => g.value)
