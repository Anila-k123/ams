const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api`;

function authHeaders() {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}` };
}

async function handleResponse(res) {
  if (res.status === 403) throw new Error("Access denied");
  if (!res.ok) {
    const text = await res.text().catch(() => "Request failed");
    throw new Error(text);
  }
  return res.json();
}

const rbacService = {
  async getMyPermissions() {
    const res = await fetch(`${API_BASE}/advocates/my-permissions`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getMyRoles() {
    const res = await fetch(`${API_BASE}/advocates/my-roles`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getAllRoles() {
    const res = await fetch(`${API_BASE}/roles`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async getRole(id) {
    const res = await fetch(`${API_BASE}/roles/${id}`, { headers: authHeaders() });
    return handleResponse(res);
  },

  async createRole(role) {
    const res = await fetch(`${API_BASE}/roles`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(role),
    });
    return handleResponse(res);
  },

  async updateRole(id, role) {
    const res = await fetch(`${API_BASE}/roles/${id}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(role),
    });
    return handleResponse(res);
  },

  async deleteRole(id) {
    const res = await fetch(`${API_BASE}/roles/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getRolePermissions(id) {
    const res = await fetch(`${API_BASE}/roles/${id}/permissions`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async setRolePermissions(id, permissionIds) {
    const res = await fetch(`${API_BASE}/roles/${id}/permissions`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(permissionIds),
    });
    return handleResponse(res);
  },

  async getAllPermissions() {
    const res = await fetch(`${API_BASE}/permissions`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getAllUsers() {
    const res = await fetch(`${API_BASE}/admin/users`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async getUser(id) {
    const res = await fetch(`${API_BASE}/admin/users/${id}`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async createUser(user) {
    const res = await fetch(`${API_BASE}/admin/users`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });
    return handleResponse(res);
  },

  async updateUser(id, user) {
    const res = await fetch(`${API_BASE}/admin/users/${id}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });
    return handleResponse(res);
  },

  async deleteUser(id) {
    const res = await fetch(`${API_BASE}/admin/users/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  async setUserRoles(userId, roleIds) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(roleIds),
    });
    return handleResponse(res);
  },

  async getUserRoles(userId) {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
};

export default rbacService;
