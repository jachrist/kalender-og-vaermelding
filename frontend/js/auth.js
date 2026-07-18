import { api, session } from "./api.js";
import { el, clear, toast } from "./dom.js";

// Innloggingsskjerm: e-post -> engangskode -> token i localStorage.

export function renderLogin(container, onLogin) {
  clear(container);
  const card = el("div.login-card");
  container.append(el("div.login-wrap", {}, card));
  step1();

  function step1() {
    clear(card);
    const email = el("input.input", { type: "email", placeholder: "din@epost.no", autocomplete: "email" });
    const btn = el("button.btn.btn--primary.btn--block", { onclick: sendCode }, "Send engangskode");
    card.append(
      el("div.brand.brand--lg", {}, "🏔️ Hytteportal"),
      el("p.muted", {}, "Logg inn med e-post. Du får en engangskode."),
      el("label.field", {}, "E-post", email),
      btn
    );
    email.focus();
    email.addEventListener("keydown", (e) => { if (e.key === "Enter") sendCode(); });

    async function sendCode() {
      const e = email.value.trim();
      if (!e) return toast("Skriv inn e-posten din", "error");
      btn.disabled = true;
      try {
        await api.requestCode(e);
        toast("Kode sendt — sjekk e-posten", "success");
        step2(e);
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
      }
    }
  }

  function step2(email) {
    clear(card);
    const code = el("input.input.input--code", { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "000000" });
    const btn = el("button.btn.btn--primary.btn--block", { onclick: verify }, "Logg inn");
    card.append(
      el("div.brand.brand--lg", {}, "🏔️ Hytteportal"),
      el("p.muted", {}, `Skriv inn koden vi sendte til ${email}.`),
      el("label.field", {}, "Engangskode", code),
      btn,
      el("button.btn.btn--ghost.btn--block", { onclick: step1 }, "← Tilbake")
    );
    code.focus();
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") verify(); });

    async function verify() {
      const c = code.value.trim();
      if (c.length < 6) return toast("Koden er 6 sifre", "error");
      btn.disabled = true;
      try {
        const { token, member } = await api.verifyCode(email, c);
        session.set({ token, member });
        onLogin();
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
      }
    }
  }
}
