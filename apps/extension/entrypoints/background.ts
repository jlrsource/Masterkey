import { browser } from "wxt/browser";
import { clearHighlights, connect, fillActiveTab, getState, refreshProfile, saveAnswers, signOut } from "@/lib/background-logic";
import type { BgRequest } from "@/lib/messages";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
    const handle = async () => {
      switch (msg.type) {
        case "GET_STATE":
          return getState();
        case "CONNECT":
          return connect(msg.tokenHash);
        case "SIGN_OUT":
          return signOut();
        case "REFRESH_PROFILE":
          return { ok: Boolean(await refreshProfile()) };
        case "FILL_ACTIVE_TAB":
          return fillActiveTab(msg.overwrite);
        case "CLEAR_HIGHLIGHTS":
          return clearHighlights();
        case "SAVE_ANSWERS":
          return saveAnswers();
      }
    };
    handle().then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String(e) }));
    return true; // svarer asynkront
  });

  // Tastatursnarvei (Alt+Shift+F) fyller ut uten å åpne popupen.
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== "fill-page") return;
    const res = await fillActiveTab();
    await browser.action.setBadgeBackgroundColor({ color: res.ok ? "#22c55e" : "#ef4444" });
    await browser.action.setBadgeText({ text: res.ok ? String(res.summary.filled + res.summary.uncertain) : "!" });
    setTimeout(() => browser.action.setBadgeText({ text: "" }), 4000);
  });
});
