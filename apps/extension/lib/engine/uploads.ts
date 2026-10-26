import { classifyField, FIELD_LABELS, type FieldKey } from "@soknadsprofil/shared";
import type { FieldReport, FilePayload, FillPayload } from "../types";
import { highlight, isVisible, setFileValue } from "./dom";
import { realClick } from "./picker";
import { HINT_UPLOAD_PANELS, HINT_UPLOAD_WIDGETS, type UploadPanelHint, type UploadWidgetHint } from "./platforms";
import { saveButtonIn, visibleText } from "./sections";
import { composedParent, deepQueryAll, describeEl, log, sleep, waitFor } from "./util";

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

// ---------------------------------------------------------------- vedleggspanel (Webcruiter)

/** Vedleggspaneler på siden («Legg til vedlegg»), der CV-en og karakterutskriften lastes opp sammen. */
export function findUploadPanels(doc: Document): UploadPanelHint[] {
  return HINT_UPLOAD_PANELS.filter((h) => {
    const trigger = doc.querySelector<HTMLElement>(h.trigger);
    return trigger && isVisible(trigger) && doc.querySelector(h.input);
  });
}

/** Filfeltene i panelene. Den vanlige utfyllingen skal ikke røre dem. */
export function uploadPanelInputs(doc: Document): Set<Element> {
  return new Set(HINT_UPLOAD_PANELS.flatMap((h) => Array.from(doc.querySelectorAll(h.input))));
}

/** Nærmeste boks rundt elementet som har sin egen «Lagre». */
function saveRoot(el: Element): Element | null {
  let node: Element | null = composedParent(el);
  for (let depth = 0; node && depth < 10; depth++) {
    if (saveButtonIn(node)) return node;
    node = composedParent(node);
  }
  return null;
}

export async function fillUploadPanels(payload: FillPayload, doc: Document): Promise<FieldReport[]> {
  const reports: FieldReport[] = [];
  for (const hint of findUploadPanels(doc)) {
    const report: FieldReport = { key: "cvFile", label: "Vedlegg", confidence: 0.9, status: "no-value" };
    reports.push(report);
    const cv = payload.files.cvFile;
    if (!cv) continue;
    // Filer som allerede står i vedleggslisten, lastes ikke opp på nytt.
    // Bare synlige rader: listen har også skjulte rader for alle filene i MasterCV.
    const attachedList = doc.querySelector(hint.attached);
    const attachedText = attachedList ? visibleText(doc, attachedList) : "";
    const files = [cv, ...(payload.cvExtras ?? [])].filter((f) => !attachedText.includes(f.name));
    if (!files.length && !payload.overwrite) {
      report.label = "Vedlegg (alt er lagt ved fra før)";
      report.status = "skipped-has-value";
      continue;
    }

    const trigger = doc.querySelector<HTMLElement>(hint.trigger)!;
    log(`vedlegg: klikker ${describeEl(trigger)}`);
    realClick(trigger);
    const input = await waitFor(() => {
      const i = doc.querySelector<HTMLInputElement>(hint.input);
      return i && (isVisible(i) || isVisible(i.parentElement ?? i)) ? i : null;
    }, 4000);
    if (!input) {
      log("vedlegg: panelet åpnet seg ikke ✗");
      report.status = "failed";
      continue;
    }
    const before = doc.querySelectorAll(hint.uploaded).length;
    // Ferdige filer vises enten som Kendo-rader (k-file-success) eller som nye rader i panelets liste.
    const panel = saveRoot(input) ?? input.parentElement!;
    // Kendos egen fil-liste viser navnet med en gang opplastingen starter, så den telles ikke.
    const occurrences = (name: string) => {
      const clone = panel.cloneNode(true) as Element;
      clone.querySelectorAll(".k-upload-files, .k-upload-status, .k-file").forEach((n) => n.remove());
      return (clone.textContent ?? "").split(name).length - 1;
    };
    const stillUploading = () => panel.querySelector(".k-file-progress, .k-upload-status-progress, [aria-busy='true']") !== null;
    const countsBefore = new Map(files.map((f) => [f.name, occurrences(f.name)]));
    // Tar feltet bare én fil, lastes de opp én og én (feltet byttes ofte ut etter hver fil).
    const batches = input.multiple ? [files] : files.map((f) => [f]);
    for (const batch of batches) {
      const current = doc.querySelector<HTMLInputElement>(hint.input) ?? input;
      setFileValue(current, batch.map(base64ToFile));
      await sleep(300);
    }
    const names = files.map((f) => f.name).join(", ");
    const uploaded = await waitFor(
      () =>
        !stillUploading() &&
        (doc.querySelectorAll(hint.uploaded).length - before >= files.length || files.every((f) => occurrences(f.name) > countsBefore.get(f.name)!)),
      30000,
    );
    log(`vedlegg ← ${names} ${uploaded ? "lastet opp ✓" : "✗ ble ikke bekreftet"}`);
    report.label = `Vedlegg: ${names}`;
    if (!uploaded) {
      report.status = "failed";
      continue;
    }
    // «Lagre» i panelet (aldri «Send»): legger filene ved søknaden.
    const save = saveButtonIn(panel);
    if (save) {
      log(`vedlegg: lagrer med ${describeEl(save)}`);
      realClick(save);
      await waitFor(() => !isVisible(save), 10000);
    }
    report.status = "filled";
    highlight(doc.querySelector(hint.attached) ?? trigger, "filled", "Masterkey: Vedlegg");
  }
  return reports;
}
