// Bittelite DOM-hjelperbibliotek for å bygge grensesnitt uten rammeverk.

// el('div.klasse#id', { attr }, ...barn)
export function el(selector, props = {}, ...children) {
  const [tag, ...rest] = selector.split(/(?=[.#])/);
  const node = document.createElement(tag || "div");
  for (const token of rest) {
    if (token[0] === ".") node.classList.add(token.slice(1));
    else if (token[0] === "#") node.id = token.slice(1);
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (key === "onclick" || key.startsWith("on")) {
      node.addEventListener(key.slice(2), value);
    } else if (key === "html") {
      node.innerHTML = value;
    } else if (value === true) {
      node.setAttribute(key, "");
    } else if (value !== false && value != null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

// Enkel toast-melding.
export function toast(message, kind = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = el("div#toast-host");
    document.body.append(host);
  }
  const t = el(`div.toast.toast--${kind}`, {}, message);
  host.append(t);
  setTimeout(() => t.classList.add("toast--show"), 10);
  setTimeout(() => {
    t.classList.remove("toast--show");
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

export const kr = (v) =>
  v == null || v === "" ? "" : new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(v);
