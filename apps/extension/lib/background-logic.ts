import { browser } from "wxt/browser";
import { emptyProfile, fullProfileSchema, pickDocument, type DocLanguage, type FullProfile, type ProfileDocument } from "@soknadsprofil/shared";
import type { ExtState } from "./messages";
import { supabase } from "./supabase";
import type { FileKey, FilePayload, FillPayload, FillSummary, FrameReport, PageAnalysis } from "./types";

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
  const want: [FileKey, "cv" | "cover_letter" | "diploma"][] = [
    ["cvFile", "cv"],
    ["coverLetterFile", "cover_letter"],
    ["diplomaFile", "diploma"],
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

export async function fillActiveTab(overwrite = false): Promise<{ ok: true; summary: FillSummary } | { ok: false; error: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return { ok: false, error: "Denne siden kan ikke fylles ut." };
  if (!(await currentEmail())) return { ok: false, error: "Koble til Masterkey først." };

  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Fant ingen profil. Sjekk internettforbindelsen." };

  try {
    await ensureEngine(tab.id);
    // Steg 1: finn ut hvilke felt som finnes, så vi bare laster ned filer ved behov.
    const analyses = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => window.__soknadsprofil?.analyze() ?? null,
    });
    const pages = analyses.map((r) => r.result as PageAnalysis | null).filter((r): r is PageAnalysis => Boolean(r));
    const keys = new Set(pages.flatMap((p) => p.keys));
    const lang = pages.find((p) => p.lang)?.lang ?? null;
    const { files, cvExtras } = await filesFor(keys, profile, lang);

    // Steg 2: fyll ut i alle rammer.
    const payload: FillPayload = { profile, files, cvExtras, overwrite };
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: async (p: FillPayload) => (await window.__soknadsprofil?.fill(p)) ?? null,
      args: [payload],
    });
    const reports = results.map((r) => r.result as FrameReport | null).filter((r): r is FrameReport => Boolean(r));
    const fields = reports.flatMap((r) => r.fields);
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
