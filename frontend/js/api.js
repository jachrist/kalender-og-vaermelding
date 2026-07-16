// Liten API-klient mot Azure Functions-backenden.
// Bytt API_BASE til produksjons-URL ved deploy (eller les fra en env-fil).

const API_BASE = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://localhost:7071/api"
  : "/api";

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`API ${method} ${path} feilet: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  health: () => request("/health"),
  listCabins: () => request("/cabins"),
  createCabin: (cabin) => request("/cabins", { method: "POST", body: cabin }),
};
