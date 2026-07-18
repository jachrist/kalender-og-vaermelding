// API-klient mot Azure Functions-backenden. Håndterer token (localStorage) og
// sender det i X-Access-Token-headeren. (Authorization kan ikke brukes: Azure
// Static Web Apps reserverer den til sin egen auth og overstyrer den før den når
// managed functions.) Ved 401 tømmes økten og en 'unauthorized'-hendelse sendes
// ut slik at appen kan vise innloggingsskjermen.

const API_BASE =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:7071/api"
    : "/api";

const TOKEN_KEY = "hytteportal-token";
const MEMBER_KEY = "hytteportal-member";

export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get member() {
    try {
      return JSON.parse(localStorage.getItem(MEMBER_KEY) || "null");
    } catch {
      return null;
    }
  },
  set({ token, member }) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (member) localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MEMBER_KEY);
  },
  get isLoggedIn() {
    return Boolean(this.token && this.member);
  },
};

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && session.token) headers["X-Access-Token"] = session.token;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    session.clear();
    window.dispatchEvent(new CustomEvent("unauthorized"));
    throw new Error("Ikke innlogget");
  }

  let data = null;
  if (res.status !== 204) {
    data = await res.json().catch(() => null);
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Feil (${res.status})`);
  }
  return data;
}

export const api = {
  // Auth
  requestCode: (email) => request("/auth/request-code", { method: "POST", body: { email }, auth: false }),
  verifyCode: (email, code) => request("/auth/verify", { method: "POST", body: { email, code }, auth: false }),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),

  // Cabins
  cabins: () => request("/cabins"),

  // Members
  members: () => request("/members"),
  createMember: (m) => request("/members", { method: "POST", body: m }),
  updateMember: (id, patch) => request(`/members/${id}`, { method: "PATCH", body: patch }),
  deleteMember: (id) => request(`/members/${id}`, { method: "DELETE" }),

  // Bookings
  bookings: (cabinId, from, to) => {
    const q = from && to ? `?from=${from}&to=${to}` : "";
    return request(`/cabins/${cabinId}/bookings${q}`);
  },
  createBooking: (cabinId, b) => request(`/cabins/${cabinId}/bookings`, { method: "POST", body: b }),
  deleteBooking: (id) => request(`/bookings/${id}`, { method: "DELETE" }),

  // Purchases
  purchases: (cabinId) => request(`/cabins/${cabinId}/purchases`),
  createPurchase: (cabinId, p) => request(`/cabins/${cabinId}/purchases`, { method: "POST", body: p }),
  updatePurchase: (id, patch) => request(`/purchases/${id}`, { method: "PATCH", body: patch }),
  deletePurchase: (id) => request(`/purchases/${id}`, { method: "DELETE" }),

  // Recurring expenses
  recurring: (cabinId) => request(`/cabins/${cabinId}/recurring`),
  createRecurring: (cabinId, r) => request(`/cabins/${cabinId}/recurring`, { method: "POST", body: r }),
  updateRecurring: (id, patch) => request(`/recurring/${id}`, { method: "PATCH", body: patch }),
  deleteRecurring: (id) => request(`/recurring/${id}`, { method: "DELETE" }),
  runRecurring: () => request("/recurring/run", { method: "POST" }),

  // Maintenance
  maintenance: (cabinId) => request(`/cabins/${cabinId}/maintenance`),
  createMaintenance: (cabinId, m) => request(`/cabins/${cabinId}/maintenance`, { method: "POST", body: m }),
  updateMaintenance: (id, patch) => request(`/maintenance/${id}`, { method: "PATCH", body: patch }),
  deleteMaintenance: (id) => request(`/maintenance/${id}`, { method: "DELETE" }),
};
