export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Venter til `check` gir en sann verdi, eller til tiden er ute (da null). */
export async function waitFor<T>(check: () => T | null | undefined | false, timeoutMs: number): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return null;
    await sleep(100);
  }
}

/** Logg i sidens konsoll (DevTools), så vi kan se hva som skjer på ekte sider. */
export const log = (...args: unknown[]) => console.info("[Masterkey]", ...args);

export const describeEl = (el: Element) =>
  `<${el.tagName.toLowerCase()}${el.id ? `#${el.id.slice(0, 30)}` : ""}${el.getAttribute("data-automation-id") ? ` [${el.getAttribute("data-automation-id")}]` : ""}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}>`;

export function commonAncestor(els: Element[]): Element | null {
  let node: Element | null = els[0]?.parentElement ?? null;
  while (node && !els.every((e) => node!.contains(e))) node = node.parentElement;
  return node;
}
