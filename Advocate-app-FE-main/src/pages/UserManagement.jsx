import React, { useEffect, useState } from "react";
import { FiEdit2, FiTrash2, FiUserPlus, FiX, FiSave } from "react-icons/fi";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext.jsx";
import "../assets/styles/AdminManagement.css";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", barCouncilId: "", specialization: "", experience: 0 });
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [password, setPassword] = useState("");
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesLoadFailed, setRolesLoadFailed] = useState(false);
  const { hasPermission } = usePermission();
  const { success, error } = useToast();
  const canManage = hasPermission("USER_MANAGE");

  const loadData = async () => {
    try {
      const [u, r] = await Promise.all([rbacService.getAllUsers(), rbacService.getAllRoles()]);
      setUsers(u);
      setRoles(r);
    } catch (err) {
      error("Couldn't load users and roles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditingUser(null);
    setForm({ fullName: "", email: "", phone: "", barCouncilId: "", specialization: "", experience: 0 });
    setSelectedRoles([]);
    setPassword("");
    setRolesLoading(false);
    setRolesLoadFailed(false);
    setShowForm(true);
  };

  const openEdit = async (user) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName || "",
      email: user.email || "",
      phone: user.phone || "",
      barCouncilId: user.barCouncilId || "",
      specialization: user.specialization || "",
      experience: user.experience || 0,
    });
    // The users endpoint returns `roles` as NAMES, and no `roleIds` at all —
    // so the old `user.roleIds || []` was always [], meaning edit never
    // pre-selected anything and saving could silently drop a user's roles.
    setPassword("");
    setSelectedRoles([]);
    setRolesLoadFailed(false);
    setRolesLoading(true);
    setShowForm(true);
    try {
      const assigned = await rbacService.getUserRoles(user.id);
      setSelectedRoles((assigned || []).map((r) => (typeof r === "object" ? r.id : r)));
    } catch {
      error("Couldn't load this user's current roles.");
      setRolesLoadFailed(true);
    } finally {
      setRolesLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) { error("Full name is required."); return; }
    if (!form.email.trim()) { error("Email is required."); return; }
    if (!editingUser && password.length < 8) {
      error("Set an initial password of at least 8 characters.");
      return;
    }
    if (editingUser && (rolesLoading || rolesLoadFailed)) {
      error(rolesLoading ? "Still loading this user's roles…"
                         : "Cannot save: this user's current roles could not be loaded.");
      return;
    }
    try {
      if (editingUser) {
        await rbacService.updateUser(editingUser.id, form);
        // Sync unconditionally — the old `length > 0` guard made it impossible
        // to remove a user's last role.
        await rbacService.setUserRoles(editingUser.id, selectedRoles);
      } else {
        // Was hardcoded to a shared "changeme123" for every new account.
        const created = await rbacService.createUser({ ...form, password });
        if (selectedRoles.length > 0) {
          await rbacService.setUserRoles(created.id, selectedRoles);
        }
      }
      setShowForm(false);
      setPassword("");
      success(editingUser ? "User updated." : "User created.");
      loadData();
    } catch (err) {
      error(err.message || "Couldn't save the user.");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    try {
      await rbacService.deleteUser(id);
      success("User deleted.");
      loadData();
    } catch (err) {
      error(err.message || "Couldn't delete the user.");
    }
  };

  const toggleRole = (roleId) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]
    );
  };

  if (loading) return <div className="am-loading">Loading...</div>;
  if (!canManage) return <div className="am-empty">You do not have permission to manage users.</div>;

  return (
    <div className="admin-management">
      <div className="am-header">
        <h2 className="am-title">User Management</h2>
        <button className="am-btn am-btn-primary" onClick={openCreate}><FiUserPlus /> Create User</button>
      </div>

      {showForm && (
        <div className="am-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="am-modal" onClick={(e) => e.stopPropagation()}>
            <div className="am-modal-header">
              <h3>{editingUser ? "Edit User" : "Create User"}</h3>
              <FiX className="am-modal-close" onClick={() => setShowForm(false)} />
            </div>
            <div className="am-modal-body">
              <div className="am-form-grid">
                <label>Full Name<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
                <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
                <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
                <label>Bar Council ID<input value={form.barCouncilId} onChange={(e) => setForm({ ...form, barCouncilId: e.target.value })} /></label>
                <label>Specialization<input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} /></label>
                <label>Experience (years)<input type="number" value={form.experience} onChange={(e) => setForm({ ...form, experience: +e.target.value })} /></label>
                {!editingUser && (
                  <label>Initial Password
                    <input
                      type="password"
                      value={password}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                )}
              </div>
              {!editingUser && (
                <p className="am-empty" style={{ textAlign: "left", padding: "4px 0" }}>
                  Share this password with the user directly and ask them to change it after first sign-in.
                </p>
              )}
              <div className="am-role-select">
                <h4>Assign Roles</h4>
                {rolesLoading && <p className="am-empty">Loading this user's roles…</p>}
                {rolesLoadFailed && (
                  <p className="am-empty">
                    Couldn't load this user's current roles. Close and retry — saving now would overwrite them.
                  </p>
                )}
                <div className="am-role-chips" hidden={rolesLoading || rolesLoadFailed}>
                  {roles.map((r) => (
                    <button key={r.id} type="button" className={`am-chip ${selectedRoles.includes(r.id) ? "active" : ""}`} onClick={() => toggleRole(r.id)}>
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="am-modal-footer">
              <button className="am-btn am-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button
                className="am-btn am-btn-primary"
                onClick={handleSave}
                disabled={!!editingUser && (rolesLoading || rolesLoadFailed)}
              ><FiSave /> Save</button>
            </div>
          </div>
        </div>
      )}

      <table className="am-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Specialization</th>
            <th>Roles</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.fullName}</td>
              <td>{u.email}</td>
              <td>{u.phone}</td>
              <td>{u.specialization}</td>
              <td>{(u.roles || []).join(", ")}</td>
              <td className="am-actions">
                <button className="am-icon-btn" title="Edit" onClick={() => openEdit(u)}><FiEdit2 /></button>
                <button className="am-icon-btn danger" title="Delete" onClick={() => handleDelete(u.id)}><FiTrash2 /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
