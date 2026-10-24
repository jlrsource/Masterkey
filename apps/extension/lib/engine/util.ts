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

/** Forelder på tvers av shadow DOM: øverste element i en shadow root har verten som forelder. */
export function composedParent(el: Element): Element | null {
  return el.parentElement ?? ((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
}

/** Inneholder `ancestor` elementet, også om det ligger inni en shadow root under det? */
export function composedContains(ancestor: Element, el: Element): boolean {
  for (let node: Element | null = el; node; node = composedParent(node)) if (node === ancestor) return true;
  return false;
}

/** Det ytterste elementet i dokumentet som (eventuelt via shadow-verter) inneholder `el`. */
export function documentHost(el: Element): Element {
  let node = el;
  for (let root = node.getRootNode(); root instanceof ShadowRoot; root = node.getRootNode()) node = root.host;
  return node;
}

/** querySelectorAll som også leter inni åpne shadow roots (web-komponenter). */
export function deepQueryAll<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  const out: T[] = [];
  const visit = (node: ParentNode) => {
    out.push(...Array.from(node.querySelectorAll<T>(selector)));
    node.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(root);
  return out;
}

export function commonAncestor(els: Element[]): Element | null {
  let node: Element | null = els[0] ? composedParent(els[0]) : null;
  while (node && !els.every((e) => composedContains(node!, e))) node = composedParent(node);
  return node;
}
