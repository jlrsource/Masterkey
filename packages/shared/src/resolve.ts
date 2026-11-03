import { ANSWER_TAG_FIELDS, type FieldKey } from "./fields";
import { prefAnswer } from "./applicationAnswers";
import { pickDocument } from "./documentLanguage";
import type { Education, Experience, FullProfile, ProfileDocument } from "./schema";

export type ResolvedValue = { kind: "text"; value: string } | { kind: "file"; document: ProfileDocument };

const text = (v: string | null | undefined): ResolvedValue | null =>
  v && v.trim() ? { kind: "text", value: v.trim() } : null;

const byRecent = <T extends { start_date?: string | null; sort_order?: number }>(a: T, b: T) =>
  (b.start_date ?? "").localeCompare(a.start_date ?? "") || (a.sort_order ?? 0) - (b.sort_order ?? 0);

/** Jobben brukeren har nå. Ingen nåværende jobb i profilen gir ingen (ikke den siste jobben). */
export function currentExperience(p: FullProfile): Experience | undefined {
  return p.experiences.find((e) => e.is_current);
}

export function latestEducation(p: FullProfile): Education | undefined {
  return [...p.educations].sort(byRecent)[0];
}


/** Finn verdien fra profilen som hører til en felttype. */
export function resolveValue(key: FieldKey, p: FullProfile): ResolvedValue | null {
  const pe = p.personal;
  // Faste søknadssvar (Ja/Nei, arbeidsform …). Oppstart: fast svar først, så standardsvar med tag.
  const pref = prefAnswer(key, p);
  if (pref) return text(pref.value);
  const tag = ANSWER_TAG_FIELDS[key];
  if (tag) {
    const answer = p.saved_answers.find((a) => a.tags.includes(tag));
    return text(answer?.answer);
  }
  switch (key) {
    case "firstName": return text(pe?.first_name);
    case "lastName": return text(pe?.last_name);
    case "fullName": return text([pe?.first_name, pe?.last_name].filter(Boolean).join(" "));
    case "email": return text(pe?.email);
    case "phone": return text(pe?.phone);
    case "address": return text(pe?.address);
    case "postalCode": return text(pe?.postal_code);
    case "city": return text(pe?.city);
    case "country": return text(pe?.country);
    case "birthDate": return text(pe?.birth_date);
    case "linkedin": return text(pe?.linkedin_url);
    case "website": return text(pe?.website_url);
    case "github": return text(pe?.github_url);
    case "headline": return text(pe?.headline);
    case "summary": return text(pe?.summary);
    case "currentEmployer": return text(currentExperience(p)?.employer);
    case "currentTitle": return text(currentExperience(p)?.title);
    case "school": return text(latestEducation(p)?.school);
    case "degree": return text(latestEducation(p)?.degree);
    case "fieldOfStudy": return text(latestEducation(p)?.field_of_study);
    case "grade": return text(latestEducation(p)?.grade);
    case "studyYear": {
      const n = studyYear(p);
      return n === null ? null : text(String(n));
    }
    case "yearsExperience": {
      const years = yearsOfExperience(p);
      return years === null ? null : text(String(years));
    }
    case "studyCity": return text(latestEducation(p)?.location);
    case "cvFile": {
      const d = pickDocument(p.documents, "cv");
      return d ? { kind: "file", document: d } : null;
    }
    case "diplomaFile": {
      const d = pickDocument(p.documents, "diploma");
      return d ? { kind: "file", document: d } : null;
    }
    case "workCertificateFile": {
      const d = pickDocument(p.documents, "work_certificate");
      return d ? { kind: "file", document: d } : null;
    }
    case "coverLetterFile": {
      const d = pickDocument(p.documents, "cover_letter");
      return d ? { kind: "file", document: d } : null;
    }
    default:
      return null;
  }
}

/**
 * Samlet arbeidserfaring i hele år, fra jobbene i profilen. Overlappende perioder telles én gang
 * (to deltidsjobber samtidig gir ikke dobbel erfaring). Null hvis ingen jobb har startdato.
 */
export function yearsOfExperience(p: FullProfile, today = new Date()): number | null {
  const ranges = p.experiences
    .filter((e) => e.start_date)
    .map((e) => {
      const start = new Date(e.start_date!).getTime();
      const end = e.is_current || !e.end_date ? today.getTime() : new Date(e.end_date).getTime();
      return [start, Math.max(start, end)] as const;
    })
    .filter(([s, e]) => !Number.isNaN(s) && !Number.isNaN(e))
    .sort((a, b) => a[0] - b[0]);
  if (!ranges.length) return null;
  let total = 0;
  let [curStart, curEnd] = ranges[0]!;
  for (const [s, e] of ranges.slice(1)) {
    if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else {
      total += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  total += curEnd - curStart;
  return Math.floor(total / (365.25 * 24 * 3600 * 1000));
}

/** Datoformat ut fra input-type: `date` vil ha ISO, ellers norsk dd.mm.åååå. */
export function formatDateForInput(iso: string, inputType: string | undefined): string {
  if (inputType === "date") return iso;
  if (inputType === "month") return iso.slice(0, 7);
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/**
 * Hvilket årskurs brukeren går i nå (1 = første år), ut fra startdatoen på en pågående utdanning.
 * Et studieår starter i august, så høsten 2026 med start august 2025 er 2. år. Null uten pågående studium.
 */
export function studyYear(p: FullProfile, today = new Date()): number | null {
  const edu = latestEducation(p);
  if (!edu?.start_date) return null;
  const end = edu.end_date ? new Date(edu.end_date) : null;
  if (end && end < today) return null; // ferdig
  const start = new Date(edu.start_date);
  const months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  if (months < 0) return null;
  return Math.min(8, Math.floor(months / 12) + 1);
}

/** Norsk karaktersnitt som tall (f.eks. «3.25», der A = 5) til bokstav («C»), eller null. */
export function gradeLetter(grade: string | null | undefined): string | null {
  const n = Number((grade ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return "EDCBA"[Math.round(n) - 1] ?? null;
}
