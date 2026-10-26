"use client";

import { personalSchema, type Personal } from "@soknadsprofil/shared";
import { Check, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { LoadingBlock, PageHeader, SectionTitle } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useProfile } from "@/lib/profile-store";

type Key = Exclude<keyof Personal, "application_prefs">;
interface FieldDef {
  key: Key;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  multiline?: boolean;
}

const GROUPS: { title: string; description: string; fields: FieldDef[] }[] = [
  {
    title: "Om deg",
    description: "Det mest grunnleggende, som alle søknader spør om.",
    fields: [
      { key: "first_name", label: "Fornavn", autoComplete: "given-name" },
      { key: "last_name", label: "Etternavn", autoComplete: "family-name" },
      { key: "birth_date", label: "Fødselsdato", type: "date", autoComplete: "bday" },
      { key: "headline", label: "Profesjonell tittel", placeholder: "F.eks. Frontend-utvikler" },
      {
        key: "summary",
        label: "Kort sammendrag",
        wide: true,
        multiline: true,
        placeholder: "Hvem er du, hva er du god på, og hva ser du etter?",
        hint: "Brukes i felt som «Kort om deg». 3–5 setninger fungerer bra.",
      },
    ],
  },
  {
    title: "Kontakt",
    description: "Hvordan arbeidsgivere kan nå deg.",
    fields: [
      { key: "email", label: "E-post", type: "email", autoComplete: "email" },
      { key: "phone", label: "Telefon", type: "tel", autoComplete: "tel", placeholder: "+47 …" },
      { key: "address", label: "Adresse", autoComplete: "street-address", wide: true },
      { key: "postal_code", label: "Postnummer", autoComplete: "postal-code" },
      { key: "city", label: "Poststed", autoComplete: "address-level2" },
      { key: "country", label: "Land", autoComplete: "country-name", placeholder: "Norge" },
    ],
  },
  {
    title: "Lenker",
    description: "Profiler og nettsider som viser hva du kan.",
    fields: [
      { key: "linkedin_url", label: "LinkedIn", type: "url", placeholder: "https://linkedin.com/in/…" },
      { key: "github_url", label: "GitHub", type: "url", placeholder: "https://github.com/…" },
      { key: "website_url", label: "Nettside / portefølje", type: "url", placeholder: "https://…", wide: true },
    ],
  },
];

type SaveState = "idle" | "saving" | "saved";

export default function PersonaliaPage() {
  const { profile, loading, updatePersonal } = useProfile();
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (loading) return <LoadingBlock />;
  const personal = profile.personal ?? {};

  async function handleBlur(key: Key, value: string) {
    if ((personal[key] ?? "") === value) return;
    const result = personalSchema.shape[key].safeParse(value);
    if (!result.success) {
      setErrors((e) => ({ ...e, [key]: key === "email" ? "Ugyldig e-postadresse" : "Ugyldig verdi" }));
      return;
    }
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSaveState("saving");
    await updatePersonal({ [key]: value });
    setSaveState("saved");
    setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1800);
  }

  return (
    <div>
      <PageHeader title="Personalia" description="Endringer lagres automatisk når du forlater et felt.">
        <AnimatePresence>
          {saveState !== "idle" && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
              role="status"
            >
              {saveState === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-success" />}
              {saveState === "saving" ? "Lagrer …" : "Lagret"}
            </motion.div>
          )}
        </AnimatePresence>
      </PageHeader>

      <div className="space-y-10">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <SectionTitle title={group.title} description={group.description} />
            <Card className="grid gap-5 p-6 sm:grid-cols-2">
              {group.fields.map((f) => {
                const id = `p-${f.key}`;
                const common = {
                  id,
                  name: f.key,
                  defaultValue: personal[f.key] ?? "",
                  placeholder: f.placeholder,
                  autoComplete: f.autoComplete,
                  "aria-invalid": errors[f.key] ? true : undefined,
                };
                return (
                  <Field key={f.key} label={f.label} htmlFor={id} hint={f.hint} error={errors[f.key]} className={f.wide ? "sm:col-span-2" : undefined}>
                    {f.multiline ? (
                      <Textarea {...common} rows={5} onBlur={(e) => handleBlur(f.key, e.target.value)} />
                    ) : (
                      <Input {...common} type={f.type ?? "text"} onBlur={(e) => handleBlur(f.key, e.target.value)} />
                    )}
                  </Field>
                );
              })}
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
