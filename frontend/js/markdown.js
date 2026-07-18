// Minimal, trygg Markdown → HTML for Hytteboka.
//
// HTML escapes først, så et lite sett markdown-mønstre påføres. Kun http(s)-URLer
// tillates i lenker og bilder (ingen javascript:-URLer). Ikke en full CommonMark-
// implementasjon, men dekker overskrifter, avsnitt, lister, sitat, kode, fet/kursiv,
// lenker og bilder — nok for hytteinnlegg.

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const safeUrl = (u) => {
  const t = String(u).trim();
  return /^https?:\/\//i.test(t) ? t.replace(/"/g, "%22") : "";
};

function inline(text) {
  let t = escapeHtml(text);
  // Bilder: ![alt](url)
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const u = safeUrl(url);
    return u ? `<img src="${u}" alt="${escapeHtml(alt)}" loading="lazy">` : m;
  });
  // Lenker: [tekst](url)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
    const u = safeUrl(url);
    return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${txt}</a>` : m;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}

const BLOCK_START = /^(#{1,3}\s|[-*]\s|\d+\.\s|>\s?|```)/;

export function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let listType = null;
  let i = 0;

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(escapeHtml(lines[i])); i++; }
      i++;
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { closeList(); const lvl = h[1].length + 2; out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }

    if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); i++; continue; }

    if (/^[-*]\s+/.test(line)) {
      if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`); i++; continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`); i++; continue;
    }

    if (/^\s*$/.test(line)) { closeList(); i++; continue; }

    closeList();
    const para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  closeList();
  return out.join("\n");
}
