-- Stillingsprosent for arbeidserfaring (1–100). Tom betyr ikke oppgitt; extensionen bruker da 100.
-- get_full_profile() bruker to_jsonb(rad), så den nye kolonnen kommer med automatisk.
alter table public.experiences add column if not exists employment_percentage smallint
  check (employment_percentage between 1 and 100);
