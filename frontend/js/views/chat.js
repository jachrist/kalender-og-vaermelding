import { api, session } from "../api.js";
import { el, clear, toast } from "../dom.js";

// Felles chat for alle medlemmer. Plain tekst, all historikk beholdes.
// Poller etter nye meldinger hvert 5. sekund så lenge fanen er åpen.

export function chatView(container, _ctx) {
  const root = el("div.view.chat");
  container.append(root);

  const listEl = el("div.chat-list");
  const input = el("textarea.input.chat-input", { rows: "1", placeholder: "Skriv en melding …" });
  const sendBtn = el("button.btn.btn--primary", { onclick: send }, "Send");
  root.append(
    listEl,
    el("div.chat-compose", {}, input, sendBtn)
  );

  let lastAt = null;      // created_at på siste melding vi har
  const seen = new Set(); // id-er vi allerede har vist

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  function timeLabel(iso) {
    const d = new Date(iso);
    return d.toLocaleString("nb-NO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function append(messages) {
    const atBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 40;
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      lastAt = m.created_at;
      const mine = m.member_id === session.member.id;
      listEl.append(
        el(`div.chat-msg${mine ? ".chat-msg--mine" : ""}`, {},
          el("div.chat-meta", {}, `${m.member_name} · ${timeLabel(m.created_at)}`),
          el("div.chat-bubble", {}, m.body)   // tekstnode = escapet av nettleseren
        )
      );
    }
    if (atBottom) listEl.scrollTop = listEl.scrollHeight;
  }

  async function load() {
    try {
      const messages = await api.chat();
      if (!messages.length) listEl.append(el("p.muted.pad", {}, "Ingen meldinger ennå. Skriv den første!"));
      append(messages);
      listEl.scrollTop = listEl.scrollHeight;
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function poll() {
    // Stopp automatisk når viewet er byttet ut (root fjernet fra DOM).
    if (!document.body.contains(root)) { clearInterval(timer); return; }
    if (!lastAt) return;
    try {
      const messages = await api.chat(lastAt);
      if (messages.length) append(messages);
    } catch { /* stille — prøver igjen ved neste intervall */ }
  }

  async function send() {
    const body = input.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    try {
      const msg = await api.sendChat(body);
      input.value = "";
      append([msg]);
      listEl.scrollTop = listEl.scrollHeight;
    } catch (err) {
      toast(err.message, "error");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  const timer = setInterval(poll, 5000);
  load();
}
