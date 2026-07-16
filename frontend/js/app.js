import { api } from "./api.js";

const PANELS = ["bruk", "innkjop", "vedlikehold"];

function showPanel(name) {
  for (const p of PANELS) {
    document.getElementById(`panel-${p}`).hidden = p !== name;
  }
  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-selected", tab.dataset.panel === name ? "true" : "false");
  }
  location.hash = name;
}

function initTabs() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => showPanel(tab.dataset.panel));
  }
  const initial = PANELS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "bruk";
  showPanel(initial);
}

async function initCabinPicker() {
  const picker = document.getElementById("cabin-picker");
  try {
    const cabins = await api.listCabins();
    if (Array.isArray(cabins) && cabins.length) {
      picker.innerHTML = cabins
        .map((c) => `<option value="${c.id}">${c.name}</option>`)
        .join("");
      return;
    }
  } catch (err) {
    // API kjører kanskje ikke ennå — vis en nøytral fallback.
    console.warn("Kunne ikke hente hytter:", err.message);
  }
  picker.innerHTML = `<option value="">(ingen hytter ennå)</option>`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) =>
        console.warn("SW-registrering feilet:", err.message)
      );
    });
  }
}

initTabs();
initCabinPicker();
registerServiceWorker();
