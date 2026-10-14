import api from "../api/client";

// Same error contract as before: 403 -> "Access denied"; any other failure ->
// the API's {"error"|"detail"|"message": "..."} sentence, else the raw body text,
// else "Request failed".
function toError(err: any): Error {
  const res = err?.response;
  if (!res) return err instanceof Error ? err : new Error("Request failed");
  // A 403 that explains itself (e.g. "Built-in roles ... cannot be changed yet")
  // keeps its sentence; a bare one stays "Access denied".
  if (res.status === 403) {
    const reason = res.data && typeof res.data === "object" ? res.data.error : null;
    return new Error(reason || "Access denied");
  }
  const data = res.data;
  let message = "Request failed";
  if (typeof data === "string") {
    message = data || message;
    try {
      const body = JSON.parse(data);
      message = body.error || body.detail || body.message || message;
    } catch {
      /* not JSON — use the raw text */
    }
  } else if (data && typeof data === "object") {
    message = data.error || data.detail || data.message || JSON.stringify(data);
  }
  return new Error(message);
}

async function call(method: "get" | "post" | "put" | "delete", path: string, body?: any) {
  try {
    const res = await api.request({ method, url: `/api${path}`, data: body });
    return res.data;
  } catch (err) {
    throw toError(err);
  }
}

const rbacService = {
  getMyPermissions: () => call("get", "/advocates/my-permissions"),
  getMyRoles: () => call("get", "/advocates/my-roles"),
  getAllRoles: () => call("get", "/roles"),
  getRoleTemplates: () => call("get", "/roles?templates=1"),
  cloneRole: (id: any, name: string) => call("post", `/roles/${id}/clone`, { name }),
  getRoleMembers: (id: any) => call("get", `/roles/${id}/members`),
  getRole: (id: any) => call("get", `/roles/${id}`),
  createRole: (role: any) => call("post", "/roles", role),
  updateRole: (id: any, role: any) => call("put", `/roles/${id}`, role),
  deleteRole: (id: any) => call("delete", `/roles/${id}`),
  getRolePermissions: (id: any) => call("get", `/roles/${id}/permissions`),
  setRolePermissions: (id: any, permissionIds: any) => call("put", `/roles/${id}/permissions`, permissionIds),
  getAllPermissions: () => call("get", "/permissions"),
  getAllUsers: () => call("get", "/admin/users"),
  getUser: (id: any) => call("get", `/admin/users/${id}`),
  // No createUser: team members are invited (POST /api/firm/invitations) and set their own password.
  updateUser: (id: any, user: any) => call("put", `/admin/users/${id}`, user),
  deleteUser: (id: any) => call("delete", `/admin/users/${id}`),
  setUserRoles: (userId: any, roleIds: any) => call("put", `/admin/users/${userId}/roles`, roleIds),
  getUserRoles: (userId: any) => call("get", `/admin/users/${userId}/roles`),
};

export default rbacService;
