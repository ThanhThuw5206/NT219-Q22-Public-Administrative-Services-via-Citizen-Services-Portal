const API_BASE = "/api";

function getToken() {
    return localStorage.getItem("token");
}

function getUser() {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
}

function setAuth(token, user) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
}

function isLoggedIn() {
    return !!getToken();
}

function getUserRole() {
    const user = getUser();
    return user?.roles?.[0] || null;
}

async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { ...options.headers };

    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (res.status === 401) {
        logout();
        return null;
    }

    return res;
}

async function apiGet(path) {
    const res = await apiFetch(path);
    if (!res) return null;
    if (!res.ok) throw new Error((await res.json()).message || "Request failed");
    return res.json();
}

async function apiPost(path, body) {
    const res = await apiFetch(path, {
        method: "POST",
        body: JSON.stringify(body)
    });
    if (!res) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
}

async function apiPostForm(path, formData) {
    const res = await apiFetch(path, {
        method: "POST",
        body: formData
    });
    if (!res) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
}

function requireAuth() {
    if (!isLoggedIn()) {
        window.location.href = "/login.html";
        return false;
    }
    return true;
}

function requireRole(...roles) {
    const user = getUser();
    if (!user || !roles.some(r => user.roles?.includes(r))) {
        window.location.href = "/";
        return false;
    }
    return true;
}
