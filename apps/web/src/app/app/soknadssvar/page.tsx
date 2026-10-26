"use client";

import {
  EMPLOYMENT_TYPES,
  GENDERS,
  HEARD_ABOUT_SOURCES,
  PRONOUNS,
  WORK_MODES,
  WORK_REGIONS,
  YES_NO,
  type ApplicationPrefs,
} from "@soknadsprofil/shared";
import { Check, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { LoadingBlock, PageHeader, SectionTitle } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useProfile } from "@/lib/profile-store";
import { cn } from "@/lib/utils";

type ChoiceKey = "needs_sponsorship" | "relocate" | "work_mode" | "employment_type" | "drivers_license" | "restrictive_agreement" | "pronouns" | "gender";
type TextKey = "notice_period" | "earliest_start";

const LABELS: Record<string, string> = {
  yes: "Ja",
  no: "Nei",
  onsite: "På kontoret",
  hybrid: "Hybrid",
  remote: "Hjemmekontor",
  fulltime: "Heltid",
  parttime: "Deltid",
  he: "Han/ham",
  she: "Hun/henne",
  they: "Hen",
  man: "Mann",
  woman: "Kvinne",
  nonbinary: "Ikke-binær",
  undisclosed: "Ønsker ikke å oppgi",
};

const REGION_LABELS: Record<(typeof WORK_REGIONS)[number], string> = {
  norway: "Norge",
  eu_eea: "EU/EØS",
  uk: "Storbritannia",
  us: "USA",
};

const CHOICES: { key: ChoiceKey; label: string; options: readonly string[]; hint?: string }[] = [
  { key: "needs_sponsorship", label: "Trenger du visum eller sponsor for å jobbe?", options: YES_NO },
  { key: "relocate", label: "Er du villig til å flytte for jobben?", options: YES_NO },
  { key: "work_mode", label: "Hvilken arbeidsform foretrekker du?", options: WORK_MODES },
  { key: "employment_type", label: "Heltid eller deltid?", options: EMPLOYMENT_TYPES },
  { key: "drivers_license", label: "Har du førerkort (klasse B)?", options: YES_NO },
  {
    key: "restrictive_agreement",
    label: "Har du en konkurranseklausul eller lignende avtale som kan begrense deg i en ny jobb?",
    options: YES_NO,
    hint: "Konkurranse-, kunde- eller taushetsklausul fra en nåværende eller tidligere arbeidsgiver («non-compete»).",
  },
];

const PERSONAL_CHOICES: typeof CHOICES = [
  { key: "pronouns", label: "Pronomen", options: PRONOUNS },
  { key: "gender", label: "Kjønn", options: GENDERS, hint: "Brukes bare i skjemaer som spør om det. Står det tomt, lar extensionen spørsmålet være." },
];

const TEXTS: { key: TextKey; label: string; placeholder: string }[] = [
  { key: "notice_period", label: "Oppsigelsestid", placeholder: "F.eks. 3 måneder" },
  { key: "earliest_start", label: "Tidligste oppstart", placeholder: "F.eks. Etter avtale, eller 1. august 2026" },
];

const SOURCE_LABELS: Record<(typeof HEARD_ABOUT_SOURCES)[number], string> = {
  linkedin: "LinkedIn",
  finn: "Finn.no",
  nav: "NAV",
  company_website: "Bedriftens nettside",
  university: "Universitet/karrieredag",
  referral: "Tips fra en ansatt eller bekjent",
  social_media: "Sosiale medier",
  job_board: "Annen jobbportal",
  recruiter: "Rekrutterer/headhunter",
  event: "Arrangement/konferanse",
  other: "Annet",
};

type SaveState = "idle" | "saving" | "saved";

export default function SoknadssvarPage() {
  const { profile, loading, updatePersonal } = useProfile();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [translating, setTranslating] = useState(false);
  const [english, setEnglish] = useState<string | null>(null);

  if (loading) return <LoadingBlock />;
  const prefs: ApplicationPrefs = profile.personal?.application_prefs ?? {};

  async function save(patch: Partial<ApplicationPrefs>) {
    setSaveState("saving");
    await updatePersonal({ application_prefs: { ...prefs, ...patch } });
    setSaveState("saved");
    setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1800);
  }

  /** Lagre utdypingen og lag en engelsk versjon til skjemaer på engelsk. */
  async function saveHeardAbout(text: string) {
    if (text === (prefs.heard_about ?? "")) return;
    if (!text) {
      setEnglish("");
      return save({ heard_about: null, heard_about_en: null });
    }
    setTranslating(true);
    let en = prefs.heard_about_en ?? null;
    try {
      const res = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) en = ((await res.json()) as { english?: string }).english || en;
    } catch {
      // Uten oversettelse brukes den norske teksten; brukeren kan skrive den engelske selv.
    }
    setTranslating(false);
    setEnglish(en ?? "");
    await save({ heard_about: text, heard_about_en: en });
  }

  const toggleRegion = (r: (typeof WORK_REGIONS)[number]) => {
    const current = prefs.work_auth ?? [];
    void save({ work_auth: current.includes(r) ? current.filter((x) => x !== r) : [...current, r] });
  };

  const choiceRow = (c: (typeof CHOICES)[number]) => (
    <div key={c.key} className="sm:col-span-2">
      <p className="text-sm font-medium">{c.label}</p>
      {c.hint && <p className="mt-0.5 text-xs text-muted-foreground">{c.hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {c.options.map((o) => (
          <Chip key={o} active={prefs[c.key] === o} onClick={() => void save({ [c.key]: prefs[c.key] === o ? null : o })}>
            {LABELS[o] ?? o}
          </Chip>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Søknadssvar" description="Svar på spørsmålene som går igjen i nesten alle søknadsskjemaer. Extensionen krysser av for deg.">
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
        <section>
          <SectionTitle title="Arbeidstillatelse og jobbønsker" description="Klikk på et valgt svar igjen for å fjerne det. Tomme svar lar extensionen være." />
          <Card className="grid gap-6 p-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="text-sm font-medium">Hvor har du lov til å jobbe?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Velg alle som gjelder. Nevner ikke spørsmålet et land, går extensionen ut fra Norge og ber deg sjekke svaret.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {WORK_REGIONS.map((r) => (
                  <Chip key={r} active={(prefs.work_auth ?? []).includes(r)} onClick={() => toggleRegion(r)}>
                    {REGION_LABELS[r]}
                  </Chip>
                ))}
              </div>
            </div>
            {CHOICES.map(choiceRow)}
          </Card>
        </section>

        <section>
          <SectionTitle title="Oppstart" description="Fylles inn i tekstfelt og nedtrekkslister." />
          <Card className="grid gap-5 p-6 sm:grid-cols-2">
            {TEXTS.map((t) => (
              <Field key={t.key} label={t.label} htmlFor={`pref-${t.key}`}>
                <Input
                  id={`pref-${t.key}`}
                  defaultValue={prefs[t.key] ?? ""}
                  placeholder={t.placeholder}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (prefs[t.key] ?? "")) void save({ [t.key]: v || null });
                  }}
                />
              </Field>
            ))}
          </Card>
        </section>

        <section>
          <SectionTitle
            title="Hvor hørte du om stillingen?"
            description="Velges i lister som «How did you hear about us?». Finnes ikke kategorien, velger extensionen «Annet» og skriver utdypingen."
          />
          <Card className="grid gap-5 p-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex flex-wrap gap-2">
                {HEARD_ABOUT_SOURCES.map((s) => (
                  <Chip key={s} active={prefs.heard_about_source === s} onClick={() => void save({ heard_about_source: prefs.heard_about_source === s ? null : s })}>
                    {SOURCE_LABELS[s]}
                  </Chip>
                ))}
              </div>
            </div>
            <Field label="Utdyping" htmlFor="pref-heard_about" hint="Brukes i fritekstfelt og «Annet, spesifiser».">
              <Input
                id="pref-heard_about"
                defaultValue={prefs.heard_about ?? ""}
                placeholder="F.eks. Via bedriftskontakter på NTNU"
                onBlur={(e) => void saveHeardAbout(e.target.value.trim())}
              />
            </Field>
            <Field label="På engelsk" htmlFor="pref-heard_about_en" hint={translating ? "Oversetter …" : "Lages automatisk. Du kan endre den."}>
              <Input
                key={english ?? prefs.heard_about_en ?? ""}
                id="pref-heard_about_en"
                defaultValue={english ?? prefs.heard_about_en ?? ""}
                placeholder="F.eks. Through company contacts at NTNU"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (prefs.heard_about_en ?? "")) void save({ heard_about_en: v || null });
                }}
              />
            </Field>
          </Card>
        </section>

        <section>
          <SectionTitle title="Om deg (valgfritt)" description="Noen skjemaer spør om dette. Du bestemmer selv om du vil svare." />
          <Card className="grid gap-6 p-6 sm:grid-cols-2">{PERSONAL_CHOICES.map(choiceRow)}</Card>
        </section>

        <p className="text-sm text-muted-foreground">
          Samtykker og erklæringer («Jeg godtar personvernerklæringen») krysser extensionen aldri av. Det må du alltid gjøre selv.
        </p>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm transition",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50 hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
