-- Egen dokumenttype for arbeidsattester, så de kan legges ved arbeidserfaring (f.eks. EasyCruit).
alter table public.documents drop constraint if exists documents_type_check;
alter table public.documents add constraint documents_type_check
  check (type in ('cv', 'cover_letter', 'diploma', 'work_certificate', 'other'));
