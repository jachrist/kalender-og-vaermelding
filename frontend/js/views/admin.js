import { api, session } from "../api.js";
import { el, clear, toast } from "../dom.js";

// Medlemsadministrasjon (kun admin). Legg til / endre rolle / fjern medlemmer.

export function adminView(container) {
  const root = el("div.view");
  container.append(root);
  render();

  async function render() {
    clear(root);
    let members = [];
    try {
      members = await api.members();
    } catch (err) {
      toast(err.message, "error");
    }

    // Legg til medlem
    const name = el("input.input", { type: "text", placeholder: "Navn" });
    const email = el("input.input", { type: "email", placeholder: "E-post" });
    const role = el("select.select", {},
      el("option", { value: "member" }, "Medlem"),
      el("option", { value: "admin" }, "Administrator")
    );
    root.append(
      el("div.card.addbox", {},
        el("h3.list-title", {}, "Nytt medlem"),
        name, email, role,
        el("button.btn.btn--primary.btn--block", { onclick: add }, "+ Legg til medlem")
      )
    );

    async function add() {
      const n = name.value.trim();
      const e = email.value.trim();
      if (!n || !e) return toast("Fyll inn navn og e-post", "error");
      try {
        await api.createMember({ name: n, email: e, role: role.value });
        toast("Medlem lagt til", "success");
        render();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    const list = el("div.list", {}, el("h3.list-title", {}, `Medlemmer (${members.length})`));
    for (const m of members) {
      const isSelf = m.id === session.member.id;
      const roleSel = el("select.select.select--sm",
        { onchange: (e) => setRole(m, e.target.value), ...(isSelf ? { disabled: true } : {}) },
        el("option", { value: "member", ...(m.role === "member" ? { selected: true } : {}) }, "Medlem"),
        el("option", { value: "admin", ...(m.role === "admin" ? { selected: true } : {}) }, "Admin")
      );
      list.append(
        el("div.row", {},
          el("div.row-main", {},
            el("div.row-title", {}, m.name, isSelf ? el("span.tag", {}, "deg") : null),
            el("div.row-sub", {}, m.email)
          ),
          roleSel,
          isSelf
            ? null
            : el("button.iconbtn.iconbtn--danger", { onclick: () => del(m), "aria-label": "Fjern" }, "🗑")
        )
      );
    }
    root.append(list);

    async function setRole(m, role) {
      try { await api.updateMember(m.id, { role }); toast("Rolle oppdatert", "success"); }
      catch (err) { toast(err.message, "error"); render(); }
    }
    async function del(m) {
      if (!confirm(`Fjerne ${m.name} (${m.email})?`)) return;
      try { await api.deleteMember(m.id); render(); }
      catch (err) { toast(err.message, "error"); }
    }
  }
}
