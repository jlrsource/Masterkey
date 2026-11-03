import { browser } from "wxt/browser";
import { emptyProfile, fullProfileSchema, normalize, pickDocument, REMEMBERED_TAG, type DocLanguage, type FullProfile, type ProfileDocument } from "@soknadsprofil/shared";
import type { ExtState } from "./messages";
import { supabase } from "./supabase";
import type { FileKey, FilePayload, FillPayload, FillSummary, FrameReport, PageAnalysis } from "./types";

const log = (...args: unknown[]) => console.info("[Masterkey]", ...args);

export const WEB_APP_URL = import.meta.env.WXT_WEB_APP_URL ?? "http://localhost:3000";
const PROFILE_KEY = "profile";
const PROFILE_AT_KEY = "profileFetchedAt";
const LAST_FILL_KEY = "lastFill";

// ---------------------------------------------------------------- auth

export async function connect(tokenHash: string) {
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error || !data.session) return { ok: false, error: error?.message ?? "Ingen sesjon" };
  await refreshProfile();
  return { ok: true, email: data.session.user.email };
}

export async function signOut() {
  await supabase.auth.signOut({ scope: "local" });
  await browser.storage.local.remove([PROFILE_KEY, PROFILE_AT_KEY, LAST_FILL_KEY]);
  return { ok: true };
}

async function currentEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

// ---------------------------------------------------------------- profil

export async function refreshProfile(): Promise<FullProfile | null> {
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return null;
  const { data, error } = await supabase.rpc("get_full_profile");
  if (error) {
    console.warn("[Masterkey] kunne ikke hente profil", error);
    return null;
  }
  const parsed = fullProfileSchema.safeParse(data);
  const profile = parsed.success ? parsed.data : { ...emptyProfile(), ...(data as Partial<FullProfile>) };
  await browser.storage.local.set({ [PROFILE_KEY]: profile, [PROFILE_AT_KEY]: Date.now() });
  return profile;
}

/** Fersk profil hvis mulig, ellers siste cachede versjon. */
async function getProfile(): Promise<FullProfile | null> {
  const fresh = await refreshProfile();
  if (fresh) return fresh;
  const cached = await browser.storage.local.get(PROFILE_KEY);
  return (cached[PROFILE_KEY] as FullProfile | undefined) ?? null;
}

export async function getState(): Promise<ExtState> {
  const store = await browser.storage.local.get([PROFILE_KEY, PROFILE_AT_KEY, LAST_FILL_KEY]);
  const profile = store[PROFILE_KEY] as FullProfile | undefined;
  const p = profile?.personal;
  return {
    email: await currentEmail(),
    name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || null,
    profileFetchedAt: (store[PROFILE_AT_KEY] as number | undefined) ?? null,
    lastFill: (store[LAST_FILL_KEY] as ExtState["lastFill"]) ?? null,
    webAppUrl: WEB_APP_URL,
  };
}

// ---------------------------------------------------------------- filer

async function downloadAsPayload(path: string, name: string, mime: string | null | undefined): Promise<FilePayload | null> {
  const { data, error } = await supabase.storage.from("documents").download(path);
  if (error || !data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { name, mime: mime ?? data.type ?? "application/octet-stream", base64: btoa(bin) };
}

async function filesFor(
  keys: Set<string>,
  profile: FullProfile,
  lang: DocLanguage | null,
): Promise<Pick<FillPayload, "files" | "cvExtras">> {
  const want: [FileKey, "cv" | "cover_letter" | "diploma" | "work_certificate"][] = [
    ["cvFile", "cv"],
    ["coverLetterFile", "cover_letter"],
    ["diplomaFile", "diploma"],
    ["workCertificateFile", "work_certificate"],
  ];
  const download = (doc: ProfileDocument | undefined) => (doc ? downloadAsPayload(doc.storage_path, doc.file_name, doc.mime_type) : null);
  const files: FillPayload["files"] = {};
  for (const [key, type] of want) {
    if (!keys.has(key)) continue;
    // Karakterutskrift o.l. på samme språk som siden, hvis profilen har flere.
    const payload = await download(pickDocument(profile.documents, type, lang));
    if (payload) files[key] = payload;
  }
  // «Upload relevant files»: karakterutskriften kan legges ved sammen med CV-en.
  // Siden avgjør selv om den brukes (bare i felt som tar imot flere filer).
  const extra = files.cvFile ? (files.diplomaFile ?? (await download(pickDocument(profile.documents, "diploma", lang)))) : null;
  return { files, cvExtras: extra ? [extra] : [] };
}

// ---------------------------------------------------------------- utfylling

async function ensureEngine(tabId: number) {
  await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["/filler.js"] });
}

/** Én utfylling av fanen: finn feltene, last ned filene som trengs, og fyll ut i alle rammer. */
async function fillOnce(tabId: number, profile: FullProfile, overwrite: boolean): Promise<FrameReport[]> {
  await ensureEngine(tabId);
  // Steg 1: finn ut hvilke felt som finnes, så vi bare laster ned filer ved behov.
  const analyses = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => window.__soknadsprofil?.analyze() ?? null,
  });
  const pages = analyses.map((r) => r.result as PageAnalysis | null).filter((r): r is PageAnalysis => Boolean(r));
  const keys = new Set(pages.flatMap((p) => p.keys));
  const lang = pages.find((p) => p.lang)?.lang ?? null;
  const { files, cvExtras } = await filesFor(keys, profile, lang);

  // Steg 2: fyll ut i alle rammer.
  const payload: FillPayload = { profile, files, cvExtras, overwrite };
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: async (p: FillPayload) => (await window.__soknadsprofil?.fill(p)) ?? null,
    args: [payload],
  });
  return results.map((r) => r.result as FrameReport | null).filter((r): r is FrameReport => Boolean(r));
}

/** Klikk en knapp som sender skjemaet (bare EasyCruits «Add»-knapper), og vent til den nye siden er lastet. */
async function clickAndWaitForPage(tabId: number, buttonName: string): Promise<boolean> {
  // Sikkerhet: aldri «Next», «Send» eller lignende. Bare «Add» som legger til en oppføring.
  if (!/^b_(multi_)?add/.test(buttonName)) return false;
  const loaded = new Promise<boolean>((resolve) => {
    let started = false;
    const timer = setTimeout(() => done(false), 25000);
    const listener = (id: number, info: { status?: string }) => {
      if (id !== tabId) return;
      if (info.status === "loading") started = true;
      if (info.status === "complete" && started) done(true);
    };
    const done = (ok: boolean) => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    browser.tabs.onUpdated.addListener(listener);
  });
  await browser.scripting.executeScript({
    target: { tabId },
    func: (name: string) => document.querySelector<HTMLInputElement>(`input[type="submit"][name="${CSS.escape(name)}"]`)?.click(),
    args: [buttonName],
  });
  const ok = await loaded;
  if (ok) await new Promise((r) => setTimeout(r, 800)); // la siden bli ferdig tegnet
  return ok;
}

/**
 * «Education [Add]» og «Work experience [Add]» hos EasyCruit åpner hver sin side der vitnemålet eller
 * arbeidsattesten lastes opp. Klikk «Add», last opp dokumentet, klikk «Add» igjen, og fyll ut det som
 * eventuelt ble tømt når vi er tilbake. Én seksjon om gangen.
 */
async function fillSubpages(tabId: number, profile: FullProfile, reports: FrameReport[]): Promise<FrameReport["fields"]> {
  const out: FrameReport["fields"] = [];
  const done = new Set<string>();
  let current = reports;
  for (let round = 0; round < 2; round++) {
    const add = current.flatMap((r) => r.subpageAdds ?? []).find((a) => !done.has(a.kind));
    if (!add) break;
    done.add(add.kind);
    const what = add.kind === "educations" ? { label: "Utdanning", doc: "vitnemålet", key: "diplomaFile", section: "Education" } : { label: "Arbeidserfaring", doc: "arbeidsattesten", key: "workCertificateFile", section: "Work experience" };
    const report = { key: add.kind, confidence: 1, status: "failed" as const };
    log(`${what.section}: klikker «Add» (${add.button}) og venter på ny side`);
    if (!(await clickAndWaitForPage(tabId, add.button))) {
      out.push({ ...report, label: `${what.label}: «Add» åpnet ingen ny side. Klikk «Add» under ${what.section} selv.` });
      break;
    }
    const sub = await fillOnce(tabId, profile, false);
    const uploaded = sub.flatMap((r) => r.fields).some((f) => f.key === what.key && f.status === "filled");
    const [found] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => document.querySelector<HTMLInputElement>('input[type="submit"][name="b_multi_add"]')?.name ?? null,
    });
    const name = found?.result as string | null;
    if (!uploaded || !name) {
      out.push({ ...report, label: `${what.label}: lastet ikke opp ${what.doc}. Gjør det selv på denne siden.` });
      break;
    }
    if (!(await clickAndWaitForPage(tabId, name))) {
      out.push({ ...report, label: `${what.label}: ${what.doc} er valgt. Klikk «Add» selv.` });
      break;
    }
    out.push({ ...report, label: `${what.label}: ${what.doc} lagt til (egen side)`, status: "filled" as const });
    // Tilbake på hovedsiden: fyll ut det som mangler (filer må ofte velges på nytt etter at siden lastes).
    current = await fillOnce(tabId, profile, false);
    out.push(...current.flatMap((r) => r.fields.filter((f) => f.status === "filled")));
  }
  return out;
}

export async function fillActiveTab(overwrite = false): Promise<{ ok: true; summary: FillSummary } | { ok: false; error: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return { ok: false, error: "Denne siden kan ikke fylles ut." };
  if (!(await currentEmail())) return { ok: false, error: "Koble til Masterkey først." };

  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Fant ingen profil. Sjekk internettforbindelsen." };

  try {
    const reports = await fillOnce(tab.id, profile, overwrite);
    const fields = reports.flatMap((r) => r.fields);
    try {
      fields.push(...(await fillSubpages(tab.id, profile, reports)));
    } catch (e) {
      // F.eks. at Chrome ikke gir tilgang til den nye siden. Vis det, men behold resten av resultatet.
      const why = e instanceof Error ? e.message : String(e);
      console.warn("[Masterkey] egen side for vitnemål/attest feilet", e);
      fields.push({
        key: "educations",
        label: why.includes("Cannot access") ? "Utdanning: Chrome ga ikke tilgang til den nye siden. Trykk «Fyll ut» der." : `Utdanning: stoppet (${why.slice(0, 80)})`,
        confidence: 1,
        status: "failed",
      });
    }
    const summary: FillSummary = {
      filled: fields.filter((f) => f.status === "filled").length,
      uncertain: fields.filter((f) => f.status === "uncertain").length,
      skipped: fields.filter((f) => f.status === "skipped-has-value").length,
      detected: reports.reduce((s, r) => s + r.detected, 0),
      adapter: reports.find((r) => r.adapter)?.adapter ?? null,
      fields,
      unrecognized: [...new Set(reports.flatMap((r) => r.unrecognized ?? []))].slice(0, 20),
      at: Date.now(),
    };
    await browser.storage.local.set({ [LAST_FILL_KEY]: { ...summary, url: tab.url } });
    return { ok: true, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message.includes("Cannot access") ? "Chrome tillater ikke utfylling på denne siden." : message };
  }
}

export async function clearHighlights() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false };
  await browser.scripting
    .executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.__soknadsprofil?.clear() })
    .catch(() => undefined);
  return { ok: true };
}

// ---------------------------------------------------------------- husk svarene

/**
 * Lagrer svarene brukeren har fylt inn selv på siden som standardsvar (tag «husket»), så de fylles
 * ut neste gang samme spørsmål dukker opp. Finnes spørsmålet fra før, oppdateres svaret.
 */
export async function saveAnswers(): Promise<{ ok: true; added: number; updated: number } | { ok: false; error: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return { ok: false, error: "Denne siden kan ikke leses." };
  if (!(await currentEmail())) return { ok: false, error: "Koble til Masterkey først." };
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Fant ingen profil. Sjekk internettforbindelsen." };

  await ensureEngine(tab.id);
  const results = await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => window.__soknadsprofil?.collectAnswers() ?? [],
  });
  const answers = results.flatMap((r) => (r.result as { question: string; answer: string }[] | undefined) ?? []);
  if (!answers.length) return { ok: true, added: 0, updated: 0 };

  const existing = new Map((profile.saved_answers ?? []).map((a) => [normalize(a.question), a]));
  let added = 0;
  let updated = 0;
  for (const { question, answer } of answers) {
    const old = existing.get(normalize(question));
    if (old?.answer === answer) continue;
    const { error } = old?.id
      ? await supabase.from("saved_answers").update({ answer }).eq("id", old.id)
      : await supabase.from("saved_answers").insert({ question, answer, tags: [REMEMBERED_TAG] });
    if (error) {
      console.warn("[Masterkey] kunne ikke lagre svar", error);
      return { ok: false, error: "Kunne ikke lagre svarene. Prøv igjen." };
    }
    if (old) updated++;
    else added++;
  }
  await refreshProfile();
  return { ok: true, added, updated };
}
