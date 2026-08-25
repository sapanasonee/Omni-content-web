-- Short user-facing label distinguishing one voice from another on the same
-- account (e.g. "Personal brand" vs "Acme Inc."). Needed because each voice is
-- its own workspace + persona pair (see app/api/onboarding/route.ts), and
-- personas.display_name is just the person's name — identical across every
-- voice a single founder onboards, so a workspace switcher UI has nothing to
-- tell them apart by without this column.

alter table personas add column if not exists voice_label text;
