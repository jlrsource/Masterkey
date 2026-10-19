-- Engelske søkeord for fagfelt («Ingeniørvitenskap og IKT» → {Engineering, Information Technology}).
-- Lages av Claude når fagfeltet endres, og brukes av extensionen i engelske søkefelt (bl.a. Workday).
-- field_of_study_en_source husker hvilken tekst som ble oversatt, så vi ikke oversetter på nytt unødig.
alter table public.educations add column if not exists field_of_study_en text[];
alter table public.educations add column if not exists field_of_study_en_source text;
