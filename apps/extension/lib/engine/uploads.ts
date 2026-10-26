import { classifyField, FIELD_LABELS, type FieldKey } from "@soknadsprofil/shared";
import type { FieldReport, FilePayload, FillPayload } from "../types";
import { highlight, isVisible, setFileValue } from "./dom";
import { realClick } from "./picker";
import { HINT_UPLOAD_WIDGETS, type UploadWidgetHint } from "./platforms";
import { deepQueryAll, log, waitFor } from "./util";

/**
 * Vedleggsfelt uten filfelt på siden (SuccessFactors): filfeltet dukker først opp etter et klikk
 * på «+». Vi klikker, fyller filfeltet som dukker opp, og venter til opplastingen er ferdig før
 * neste felt, siden plattformen bare har én opplastingsboks åpen om gangen.
 */

type FileKey = Extract<FieldKey, "cvFile" | "coverLetterFile" | "diplomaFile">;

export interface UploadWidget {
  container: HTMLElement;
  hint: UploadWidgetHint;
  key: FileKey;
  label: string;
}

const FILE_KEYS: FileKey[] = ["cvFile", "coverLetterFile", "diplomaFile"];
/** «Øvrig dokumentasjon», «Vedlegg», «Other documents»: karakterutskriften passer der. */
const OTHER_DOCUMENTS = /dokument|vedlegg|attachment|document|øvrig|annet|other|additional/i;

function widgetKey(label: string): FileKey | null {
  const c = classifyField({ tag: "input", label, type: "file" });
  if (c && (FILE_KEYS as FieldKey[]).includes(c.key)) return c.key as FileKey;
  return OTHER_DOCUMENTS.test(label) ? "diplomaFile" : null;
}

export function findUploadWidgets(doc: Document): UploadWidget[] {
  const out: UploadWidget[] = [];
  for (const hint of HINT_UPLOAD_WIDGETS) {
    for (const container of deepQueryAll<HTMLElement>(doc, hint.container)) {
      // Har feltet et ekte filfelt, tar den vanlige utfyllingen seg av det.
      if (container.querySelector('input[type="file"]') || !container.querySelector(hint.trigger)) continue;
      const label = container.querySelector(hint.label)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const key = widgetKey(label);
      if (key) out.push({ container, hint, key, label });
    }
  }
  return out;
}

export function base64ToFile(f: FilePayload): File {
  const bin = atob(f.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.mime });
}

export async function fillUploadWidgets(payload: FillPayload, doc: Document): Promise<FieldReport[]> {
  const reports: FieldReport[] = [];
  const used = new Set<FileKey>();
  for (const w of findUploadWidgets(doc)) {
    const report: FieldReport = { key: w.key, label: `${FIELD_LABELS[w.key]} (${w.label})`, confidence: 0.9, status: "no-value" };
    reports.push(report);
    if (used.has(w.key)) {
      report.status = "skipped-has-value";
      continue;
    }
    if (w.container.querySelector(w.hint.uploaded) && !payload.overwrite) {
      report.status = "skipped-has-value";
      continue;
    }
    const file = payload.files[w.key];
    if (!file) continue;

    const before = new Set(deepQueryAll(doc, 'input[type="file"]'));
    const trigger = w.container.querySelector<HTMLElement>(w.hint.trigger);
    if (!trigger) continue;
    realClick(trigger);
    // Filfeltet ligger i en boks som åpnes (ofte usynlig selv, bak en knapp med tekst).
    const input = await waitFor(
      () => deepQueryAll<HTMLInputElement>(doc, 'input[type="file"]').find((i) => !before.has(i) && (isVisible(i) || isVisible(i.parentElement ?? i))),
      3000,
    );
    if (!input) {
      log(`vedlegg «${w.label}»: fant ikke filfeltet etter klikk ✗`);
      report.status = "failed";
      continue;
    }
    const ok = setFileValue(input, base64ToFile(file));
    // Vent til opplastingen er ferdig, så neste felt kan åpne sin egen boks.
    const done = ok && Boolean(await waitFor(() => w.container.querySelector(w.hint.uploaded), 20000));
    log(`vedlegg «${w.label}» ← ${file.name} ${done ? "lastet opp ✓" : ok ? "✗ ble ikke bekreftet" : "✗"}`);
    report.label = `${FIELD_LABELS[w.key]}: ${file.name}`;
    report.status = done ? "filled" : "failed";
    if (done) {
      used.add(w.key);
      highlight(w.container, "filled", `Masterkey: ${FIELD_LABELS[w.key]}`);
    }
  }
  return reports;
}
