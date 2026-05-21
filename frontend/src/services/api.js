const API_BASE = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });

  if (!response.ok) {
    let message = "Request failed";

    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}

    throw new Error(message);
  }

  return response.json();
}

export function getPosts() {
  return request("/posts");
}

export function getResources() {
  return request("/resources");
}

export function getSchedules() {
  return request("/schedules");
}

export function getSpotlight() {
  return request("/spotlight");
}

export function login(username, password) {
  return request("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return request("/auth/logout", {
    method: "POST",
  });
}

export function getCurrentUser() {
  return request("/auth/me");
}

export function getDirectory(q = "") {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  return request(`/directory${params}`);
}

export function search(q) {
  return request(`/search?q=${encodeURIComponent(q)}`);
}

export function getSignupSheets() {
  return request("/signup-sheets");
}

export function getSignupSheet(id) {
  return request(`/signup-sheets/${id}`);
}

export function signupForSheet(id, data) {
  return request(`/signup-sheets/${id}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function createSignupSheet(data) {
  return request("/signup-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updateSignupSheet(id, data) {
  return request(`/signup-sheets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deleteSignupSheet(id) {
  return request(`/signup-sheets/${id}`, { method: "DELETE" });
}

export function removeSignupEntry(sheetId, entryId) {
  return request(`/signup-sheets/${sheetId}/entries/${entryId}`, { method: "DELETE" });
}
