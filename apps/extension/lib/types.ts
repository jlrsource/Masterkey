import type { FieldKey, FullProfile } from "@soknadsprofil/shared";
import type { SectionKind } from "./engine/sections";

export type FileKey = Extract<FieldKey, "cvFile" | "coverLetterFile" | "diplomaFile">;

export interface FilePayload {
  name: string;
  mime: string;
  base64: string;
}

export interface FillPayload {
  profile: FullProfile;
  files: Partial<Record<FileKey, FilePayload>>;
  /** Overskriv felt som allerede har en verdi. */
  overwrite: boolean;
}

export type FieldStatus = "filled" | "uncertain" | "skipped-has-value" | "no-value" | "failed";

export interface FieldReport {
  /** Felttype, eller en gjentakende seksjon (arbeidserfaring, utdanning, verv). */
  key: FieldKey | SectionKind;
  label: string;
  confidence: number;
  status: FieldStatus;
}

export interface FrameReport {
  url: string;
  adapter: string | null;
  detected: number;
  fields: FieldReport[];
  /** Tekst fra felt som ikke ble gjenkjent, så brukeren ser hva som ble hoppet over. */
  unrecognized: string[];
}

export interface FillSummary {
  filled: number;
  uncertain: number;
  detected: number;
  skipped: number;
  adapter: string | null;
  fields: FieldReport[];
  unrecognized: string[];
  at: number;
}

export interface EngineApi {
  analyze(): { keys: FieldKey[]; adapter: string | null };
  fill(payload: FillPayload): Promise<FrameReport>;
  clear(): void;
}

declare global {
  interface Window {
    __soknadsprofil?: EngineApi;
  }
}
