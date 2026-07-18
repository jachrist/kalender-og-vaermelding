import { api } from "../api.js";
import { el, clear, toast } from "../dom.js";
import { formatDay } from "../dates.js";

// Vedlikeholdsoppgaver. Alle medlemmer kan opprette, redigere og slette.

const STATUS_LABELS = { open: "Åpen", in_progress: "Pågår", done: "Ferdig" };

export function maintenanceView(container, ctx) {
  const root = el("div.view");
  container.append(root);
  render();

  async function render() {
    clear(root);
    let items = [];
    try {
      items = await api.maintenance(ctx.cabinId);
    } catch (err) {
      toast(err.message, "error");
    }

    // Legg til oppgave
    const title = el("input.input", { type: "text", placeholder: "Hva må gjøres?" });
    const desc = el("input.input", { type: "text", placeholder: "Beskrivelse (valgfritt)" });
    const due = el("input.input.input--sm", { type: "date" });
    root.append(
      el("div.card.addbox", {},
        title,
        desc,
        el("label.field.field--inline", {}, "Frist", due),
        el("button.btn.btn--primary.btn--block", { onclick: add }, "+ Legg til oppgave")
      )
    );

    async function add() {
      const t = title.value.trim();
      if (!t) return toast("Skriv inn en oppgave", "error");
      try {
        await api.createMaintenance(ctx.cabinId, {
          title: t,
          description: desc.value.trim() || undefined,
          due_date: due.value || undefined,
        });
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    const list = el("div.list", {}, el("h3.list-title", {}, "Oppgaver"));
    if (!items.length) list.append(el("p.muted", {}, "Ingen oppgaver registrert."));
    for (const it of items) {
      const statusSel = el("select.select.select--sm",
        { onchange: (e) => setStatus(it, e.target.value) },
        ...Object.entries(STATUS_LABELS).map(([v, label]) =>
          el("option", { value: v, ...(v === it.status ? { selected: true } : {}) }, label)
        )
      );

      list.append(
        el(`div.row${it.status === "done" ? ".row--done" : ""}`, {},
          el("div.row-main", { onclick: () => openEdit(it) },
            el("div.row-title", {}, it.title),
            el("div.row-sub", {},
              [
                it.due_date ? `frist ${formatDay(it.due_date)}` : null,
                it.description || null,
                `lagt inn av ${it.created_by_name}`,
              ].filter(Boolean).join(" · ")
            )
          ),
          statusSel,
          el("button.iconbtn.iconbtn--danger", { onclick: () => del(it), "aria-label": "Slett" }, "🗑")
        )
      );
    }
    root.append(list);

    async function setStatus(it, status) {
      try { await api.updateMaintenance(it.id, { status }); render(); }
      catch (err) { toast(err.message, "error"); }
    }
    async function del(it) {
      if (!confirm(`Slette oppgaven "${it.title}"?`)) return;
      try { await api.deleteMaintenance(it.id); render(); }
      catch (err) { toast(err.message, "error"); }
    }
  }

  function openEdit(it) {
    const title = el("input.input", { type: "text", value: it.title });
    const desc = el("input.input", { type: "text", value: it.description || "" });
    const due = el("input.input.input--sm", { type: "date", value: it.due_date || "" });

    const dialog = el("div.modal-backdrop", { onclick: (e) => { if (e.target === dialog) dialog.remove(); } },
      el("div.modal", {},
        el("h3", {}, "Rediger oppgave"),
        el("label.field", {}, "Tittel", title),
        el("label.field", {}, "Beskrivelse", desc),
        el("label.field", {}, "Frist", due),
        el("div.modal-actions", {},
          el("button.btn", { onclick: () => dialog.remove() }, "Avbryt"),
          el("button.btn.btn--primary", { onclick: save }, "Lagre")
        )
      )
    );
    document.body.append(dialog);

    async function save() {
      const t = title.value.trim();
      if (!t) return toast("Tittel kan ikke være tom", "error");
      try {
        await api.updateMaintenance(it.id, {
          title: t,
          description: desc.value.trim(),
          due_date: due.value || null,
        });
        dialog.remove();
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  }
}
