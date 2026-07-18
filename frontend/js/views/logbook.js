import { api, session } from "../api.js";
import { el, clear, toast } from "../dom.js";
import { renderMarkdown } from "../markdown.js";
import { formatRange } from "../dates.js";

// Hyttebok per hytte: markdown-innlegg med periode (fra–til) og hvem som var der.
// Editor med bildeopplasting (Blob Storage) og forhåndsvisning.

export function logbookView(container, ctx) {
  const root = el("div.view");
  container.append(root);
  render();

  async function render() {
    clear(root);
    let entries = [];
    try {
      entries = await api.logbook(ctx.cabinId);
    } catch (err) {
      toast(err.message, "error");
    }

    root.append(
      el("button.btn.btn--primary.btn--block", { onclick: () => openEditor() }, "+ Nytt innlegg")
    );

    const list = el("div.list", {}, el("h3.list-title", {}, `Hyttebok (${entries.length})`));
    if (!entries.length) list.append(el("p.muted", {}, "Ingen innlegg ennå."));
    for (const e of entries) {
      const canEdit = e.member_id === session.member.id || session.member.role === "admin";
      const period = e.period_from
        ? formatRange(e.period_from, e.period_to || e.period_from)
        : null;
      const bodyEl = el("div.logbook-body");
      bodyEl.innerHTML = renderMarkdown(e.body);

      list.append(
        el("article.card.logbook-entry", {},
          el("div.logbook-head", {},
            el("div.logbook-meta", {},
              period ? el("div.logbook-period", {}, `📅 ${period}`) : null,
              e.participants ? el("div.logbook-people", {}, `👥 ${e.participants}`) : null,
              el("div.row-sub", {}, `skrevet av ${e.created_by_name}`)
            ),
            canEdit
              ? el("div.logbook-actions", {},
                  el("button.iconbtn", { onclick: () => openEditor(e), "aria-label": "Rediger" }, "✏️"),
                  el("button.iconbtn.iconbtn--danger", { onclick: () => del(e), "aria-label": "Slett" }, "🗑")
                )
              : null
          ),
          bodyEl
        )
      );
    }
    root.append(list);
  }

  async function del(entry) {
    if (!confirm("Slette dette innlegget?")) return;
    try {
      await api.deleteLogbook(entry.id);
      toast("Innlegg slettet", "success");
      render();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // --- Editor (nytt eller eksisterende innlegg) ---
  function openEditor(entry) {
    const from = el("input.input", { type: "date", value: entry?.period_from || "" });
    const to = el("input.input", { type: "date", value: entry?.period_to || "" });
    const people = el("input.input", { type: "text", placeholder: "Hvem var der?", value: entry?.participants || "" });
    const body = el("textarea.input.md-textarea", { rows: "10", placeholder: "Skriv innlegget i markdown …" }, entry?.body || "");

    // Husk siste markørposisjon i tekstfeltet — klikk på «Bilde»-knappen flytter
    // fokus vekk fra feltet, så vi setter bildet inn der markøren sist var (eller
    // på slutten hvis feltet ikke er berørt ennå).
    let lastSel = { start: body.value.length, end: body.value.length };
    const saveSel = () => { lastSel = { start: body.selectionStart, end: body.selectionEnd }; };
    for (const ev of ["keyup", "mouseup", "input", "blur"]) body.addEventListener(ev, saveSel);
    function insertAtSaved(text) {
      const { start, end } = lastSel;
      body.value = body.value.slice(0, start) + text + body.value.slice(end);
      const pos = start + text.length;
      lastSel = { start: pos, end: pos };
      body.focus();
      try { body.setSelectionRange(pos, pos); } catch { /* ignorer */ }
    }

    const preview = el("div.logbook-body.md-preview", { hidden: true });
    const fileInput = el("input", { type: "file", accept: "image/*,.heic,.heif", hidden: true });
    fileInput.addEventListener("change", () => uploadPicked());

    const imgBtn = el("button.btn.btn--sm", { type: "button", onclick: () => fileInput.click() }, "🖼 Bilde");
    const previewBtn = el("button.btn.btn--sm.btn--ghost", { type: "button", onclick: togglePreview }, "👁 Forhåndsvis");

    let previewing = false;
    function togglePreview() {
      previewing = !previewing;
      if (previewing) {
        preview.innerHTML = renderMarkdown(body.value);
        preview.hidden = false;
        body.hidden = true;
        previewBtn.textContent = "✏️ Rediger";
      } else {
        preview.hidden = true;
        body.hidden = false;
        previewBtn.textContent = "👁 Forhåndsvis";
      }
    }

    async function uploadPicked() {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) return toast("Bildet er for stort (maks 12 MB)", "error");
      imgBtn.disabled = true;
      imgBtn.textContent = "⏳ Laster opp …";
      try {
        const { url } = await api.uploadImage(file);
        insertAtSaved(`\n![](${url})\n`);
        toast("Bilde lagt inn der markøren står", "success");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        imgBtn.disabled = false;
        imgBtn.textContent = "🖼 Bilde";
      }
    }

    const dialog = el("div.modal-backdrop", { onclick: (e) => { if (e.target === dialog) dialog.remove(); } },
      el("div.modal.modal--wide", {},
        el("h3", {}, entry ? "Rediger innlegg" : "Nytt innlegg"),
        el("div.addrow", {},
          el("label.field", {}, "Fra", from),
          el("label.field", {}, "Til", to)
        ),
        el("label.field", {}, "Hvem var der?", people),
        el("div.md-toolbar", {}, imgBtn, previewBtn),
        body, preview, fileInput,
        el("p.muted.md-hint", {}, "Markdown støttes: **fet**, *kursiv*, # overskrift, - liste, [lenke](url), bilder."),
        el("div.modal-actions", {},
          el("button.btn", { onclick: () => dialog.remove() }, "Avbryt"),
          el("button.btn.btn--primary", { onclick: submit }, "Lagre")
        )
      )
    );
    document.body.append(dialog);
    body.focus();

    async function submit() {
      const text = body.value.trim();
      if (!text) return toast("Innlegget kan ikke være tomt", "error");
      const payload = {
        period_from: from.value || undefined,
        period_to: to.value || undefined,
        participants: people.value.trim() || undefined,
        body: text,
      };
      try {
        if (entry) await api.updateLogbook(entry.id, payload);
        else await api.createLogbook(ctx.cabinId, payload);
        dialog.remove();
        toast("Innlegg lagret", "success");
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  }
}
