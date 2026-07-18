import { api, session } from "./api.js";
import { el, clear, toast } from "./dom.js";
import { renderLogin } from "./auth.js";
import { bookingView } from "./views/booking.js";
import { purchasesView } from "./views/purchases.js";
import { maintenanceView } from "./views/maintenance.js";
import { adminView } from "./views/admin.js";

const TABS = [
  { key: "bruk", label: "Bruk", icon: "📅", render: (c, ctx) => bookingView(c, ctx) },
  { key: "innkjop", label: "Innkjøp", icon: "🛒", render: (c, ctx) => purchasesView(c, ctx) },
  { key: "vedlikehold", label: "Vedlikehold", icon: "🔧", render: (c, ctx) => maintenanceView(c, ctx) },
  { key: "admin", label: "Admin", icon: "⚙️", render: (c) => adminView(c), adminOnly: true },
];

const loginEl = document.getElementById("login");
const appEl = document.getElementById("app");
const contentEl = document.getElementById("content");
const tabbarEl = document.getElementById("tabbar");
const cabinPicker = document.getElementById("cabin-picker");
const userBtn = document.getElementById("user-btn");

let cabins = [];
let activeCabinId = null;
let activeTab = "bruk";

async function boot() {
  if (!session.isLoggedIn) return showLogin();

  // Verifiser at tokenet fortsatt er gyldig og oppdater medlemsinfo.
  try {
    const { member } = await api.me();
    session.set({ member });
  } catch {
    return showLogin(); // 'unauthorized' håndteres også globalt
  }

  showApp();

  try {
    cabins = await api.cabins();
  } catch (err) {
    toast(err.message, "error");
    cabins = [];
  }
  activeCabinId = cabins[0]?.id || null;
  buildCabinPicker();
  buildTabbar();
  renderActive();
}

function showLogin() {
  appEl.hidden = true;
  loginEl.hidden = false;
  renderLogin(loginEl, boot);
}

function showApp() {
  loginEl.hidden = true;
  appEl.hidden = false;
  userBtn.textContent = session.member.name;
}

function buildCabinPicker() {
  clear(cabinPicker);
  if (!cabins.length) {
    cabinPicker.append(el("option", { value: "" }, "(ingen hytter)"));
    return;
  }
  for (const c of cabins) {
    cabinPicker.append(el("option", { value: c.id }, c.name));
  }
  cabinPicker.value = activeCabinId;
  cabinPicker.onchange = () => {
    activeCabinId = cabinPicker.value;
    renderActive();
  };
}

function buildTabbar() {
  clear(tabbarEl);
  const isAdmin = session.member.role === "admin";
  for (const tab of TABS) {
    if (tab.adminOnly && !isAdmin) continue;
    const btn = el("button.tab", { onclick: () => { activeTab = tab.key; renderActive(); } },
      el("span.tab__icon", {}, tab.icon),
      el("span.tab__label", {}, tab.label)
    );
    btn.dataset.tab = tab.key;
    tabbarEl.append(btn);
  }
}

function renderActive() {
  const tab = TABS.find((t) => t.key === activeTab) || TABS[0];
  activeTab = tab.key;
  for (const btn of tabbarEl.querySelectorAll(".tab")) {
    btn.setAttribute("aria-selected", btn.dataset.tab === activeTab ? "true" : "false");
  }
  clear(contentEl);
  if (!activeCabinId && !tab.adminOnly) {
    contentEl.append(el("p.muted.pad", {}, "Ingen hytter tilgjengelig."));
    return;
  }
  tab.render(contentEl, { cabinId: activeCabinId, member: session.member });
}

async function logout() {
  try { await api.logout(); } catch { /* ignorer */ }
  session.clear();
  showLogin();
}

userBtn.addEventListener("click", () => {
  if (confirm(`Logget inn som ${session.member.name}. Logg ut?`)) logout();
});

window.addEventListener("unauthorized", () => {
  toast("Økten er utløpt — logg inn på nytt", "error");
  showLogin();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

boot();
