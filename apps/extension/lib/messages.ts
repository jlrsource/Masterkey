import { browser } from "wxt/browser";
import type { FillSummary } from "./types";

export type BgRequest =
  | { type: "GET_STATE" }
  | { type: "CONNECT"; tokenHash: string }
  | { type: "SIGN_OUT" }
  | { type: "REFRESH_PROFILE" }
  | { type: "FILL_ACTIVE_TAB"; overwrite?: boolean }
  | { type: "CLEAR_HIGHLIGHTS" }
  | { type: "SAVE_ANSWERS" };

export interface ExtState {
  email: string | null;
  name: string | null;
  profileFetchedAt: number | null;
  lastFill: (FillSummary & { url: string }) | null;
  webAppUrl: string;
}

export type BgResponse<T extends BgRequest["type"]> = T extends "GET_STATE"
  ? ExtState
  : T extends "CONNECT"
    ? { ok: boolean; email?: string; error?: string }
    : T extends "FILL_ACTIVE_TAB"
      ? { ok: true; summary: FillSummary } | { ok: false; error: string }
      : T extends "SAVE_ANSWERS"
        ? { ok: true; added: number; updated: number } | { ok: false; error: string }
        : { ok: boolean; error?: string };

export function sendToBackground<T extends BgRequest>(msg: T): Promise<BgResponse<T["type"]>> {
  return browser.runtime.sendMessage(msg);
}
