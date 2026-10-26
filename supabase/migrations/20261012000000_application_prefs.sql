-- Faste søknadssvar (arbeidstillatelse, visum, flytting, arbeidsform …) som JSON på profilen.
-- get_full_profile() bruker to_jsonb(rad), så kolonnen kommer med under «personal» automatisk.
alter table public.profiles add column if not exists application_prefs jsonb not null default '{}'::jsonb;
