import { api, session } from "../api.js";
import { el, clear, toast, kr } from "../dom.js";

// Handleliste med pris og kommentar + faste utgifter (recurring) som API-et
// materialiserer automatisk hver måned.

export function purchasesView(container, ctx) {
  const root = el("div.view");
  container.append(root);
  render();

  async function render() {
    clear(root);
    let items = [], recurring = [];
    try {
      [items, recurring] = await Promise.all([
        api.purchases(ctx.cabinId),
        api.recurring(ctx.cabinId),
      ]);
    } catch (err) {
      toast(err.message, "error");
    }

    // --- Legg til vare ---
    const title = el("input.input", { type: "text", placeholder: "Hva skal kjøpes?" });
    const price = el("input.input.input--sm", { type: "number", step: "0.01", placeholder: "Pris" });
    const comment = el("input.input", { type: "text", placeholder: "Kommentar (valgfritt)" });
    root.append(
      el("div.card.addbox", {},
        el("div.addrow", {}, title, price),
        comment,
        el("button.btn.btn--primary.btn--block", { onclick: add }, "+ Legg til")
      )
    );

    async function add() {
      const t = title.value.trim();
      if (!t) return toast("Skriv inn en vare", "error");
      try {
        await api.createPurchase(ctx.cabinId, {
          title: t,
          price: price.value || undefined,
          comment: comment.value.trim() || undefined,
        });
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    // --- Handleliste ---
    const list = el("div.list", {}, el("h3.list-title", {}, "Handleliste"));
    if (!items.length) list.append(el("p.muted", {}, "Lista er tom."));
    for (const it of items) {
      const canEdit = it.created_by === session.member.id || session.member.role === "admin";
      const check = el("input", { type: "checkbox" });
      check.checked = !!it.bought;
      check.addEventListener("change", () => toggleBought(it, check.checked));

      list.append(
        el(`div.row${it.bought ? ".row--done" : ""}`, {},
          el("label.check", {}, check),
          el("div.row-main", {},
            el("div.row-title", {}, it.title, it.source === "recurring" ? el("span.tag", {}, "fast") : null),
            el("div.row-sub", {},
              [
                it.price != null ? kr(it.price) : null,
                it.comment || null,
                it.bought ? `kjøpt av ${it.bought_by_name || "?"}` : `lagt inn av ${it.created_by_name}`,
              ].filter(Boolean).join(" · ")
            )
          ),
          canEdit
            ? el("button.iconbtn.iconbtn--danger", { onclick: () => del(it), "aria-label": "Slett" }, "🗑")
            : null
        )
      );
    }
    root.append(list);

    async function toggleBought(it, bought) {
      try {
        await api.updatePurchase(it.id, { bought });
        render();
      } catch (err) {
        toast(err.message, "error");
        render();
      }
    }
    async function del(it) {
      if (!confirm(`Slette "${it.title}"?`)) return;
      try {
        await api.deletePurchase(it.id);
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    // --- Faste utgifter ---
    root.append(recurringSection(recurring));
  }

  function recurringSection(recurring) {
    const section = el("details.card.recurring", {},
      el("summary", {}, `Faste utgifter (${recurring.length})`)
    );

    const rTitle = el("input.input", { type: "text", placeholder: "Fast utgift, f.eks. strøm" });
    const rPrice = el("input.input.input--sm", { type: "number", step: "0.01", placeholder: "Beløp" });
    const rDay = el("input.input.input--sm", { type: "number", min: "1", max: "28", value: "1" });
    section.append(
      el("div.addbox", {},
        el("div.addrow", {}, rTitle, rPrice),
        el("label.field.field--inline", {}, "Legges inn den (dag i mnd)", rDay),
        el("button.btn.btn--block", { onclick: addRecurring }, "+ Legg til fast utgift")
      )
    );

    for (const r of recurring) {
      const canEdit = r.created_by === session.member.id || session.member.role === "admin";
      section.append(
        el("div.row", {},
          el("div.row-main", {},
            el("div.row-title", {}, r.title, r.active ? null : el("span.tag.tag--muted", {}, "pauset")),
            el("div.row-sub", {},
              [r.price != null ? kr(r.price) : null, `den ${r.day_of_month}. hver måned`, r.comment || null]
                .filter(Boolean).join(" · ")
            )
          ),
          canEdit
            ? el("button.iconbtn", { onclick: () => toggleActive(r), "aria-label": "Pause/aktiver" }, r.active ? "⏸" : "▶")
            : null,
          canEdit
            ? el("button.iconbtn.iconbtn--danger", { onclick: () => delRecurring(r), "aria-label": "Slett" }, "🗑")
            : null
        )
      );
    }

    if (session.member.role === "admin") {
      section.append(
        el("button.btn.btn--ghost.btn--block", { onclick: runNow }, "Kjør faste utgifter nå")
      );
    }

    async function addRecurring() {
      const t = rTitle.value.trim();
      if (!t) return toast("Skriv inn en utgift", "error");
      try {
        await api.createRecurring(ctx.cabinId, {
          title: t,
          price: rPrice.value || undefined,
          day_of_month: Number(rDay.value) || 1,
        });
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }
    async function toggleActive(r) {
      try { await api.updateRecurring(r.id, { active: !r.active }); render(); }
      catch (err) { toast(err.message, "error"); }
    }
    async function delRecurring(r) {
      if (!confirm(`Slette den faste utgiften "${r.title}"?`)) return;
      try { await api.deleteRecurring(r.id); render(); }
      catch (err) { toast(err.message, "error"); }
    }
    async function runNow() {
      try {
        const data = await api.runRecurring();
        toast(`La inn ${data.generated} faste utgifter`, "success");
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    return section;
  }
}
