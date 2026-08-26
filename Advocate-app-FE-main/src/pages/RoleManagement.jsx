import React, { useEffect, useState } from "react";
import { FiEdit2, FiTrash2, FiPlus, FiX, FiSave, FiShield } from "react-icons/fi";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext.jsx";
import "../assets/styles/AdminManagement.css";

export default function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRole, setEditingRole] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [selectedPerms, setSelectedPerms] = useState([]);
  const [permsLoading, setPermsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const { hasPermission } = usePermission();
  const { success, error } = useToast();
  const canManage = hasPermission("ROLE_MANAGE");

  const loadData = async () => {
    try {
      const [r, p] = await Promise.all([rbacService.getAllRoles(), rbacService.getAllPermissions()]);
      setRoles(r);
      setPermissions(p);
    } catch (err) {
      error("Couldn't load roles and permissions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditingRole(null);
    setForm({ name: "", description: "" });
    setSelectedPerms([]);
    setPermsLoading(false);
    setLoadFailed(false);
    setShowForm(true);
  };

  const openEdit = async (role) => {
    setEditingRole(role);
    setLoadFailed(false);
    setForm({ name: role.name, description: role.description || "" });
    // GET roles/<id>/permissions returns full permission OBJECTS; the
    // checkboxes below compare against permission IDs. Mapping was missing, so
    // every box rendered unchecked and saving then posted an empty list —
    // silently stripping the role of every permission it had.
    setPermsLoading(true);
    setSelectedPerms([]);
    setShowForm(true);
    try {
      const perms = await rbacService.getRolePermissions(role.id);
      setSelectedPerms((perms || []).map((p) => (typeof p === "object" ? p.id : p)));
    } catch {
      error("Couldn't load this role's current permissions — not saving would be safer.");
      setLoadFailed(true);
    } finally {
      setPermsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { error("Role name is required."); return; }
    // Never write a permission set we failed to read — that is the wipe.
    if (editingRole && (permsLoading || loadFailed)) {
      error(permsLoading ? "Still loading this role's permissions…"
                         : "Cannot save: this role's current permissions could not be loaded.");
      return;
    }
    try {
      if (editingRole) {
        await rbacService.updateRole(editingRole.id, form);
        await rbacService.setRolePermissions(editingRole.id, selectedPerms);
      } else {
        const created = await rbacService.createRole(form);
        if (selectedPerms.length > 0) {
          await rbacService.setRolePermissions(created.id, selectedPerms);
        }
      }
      setShowForm(false);
      success(editingRole ? "Role updated." : "Role created.");
      loadData();
    } catch (err) {
      error(err.message || "Couldn't save the role.");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this role? This cannot be undone.")) return;
    try {
      await rbacService.deleteRole(id);
      success("Role deleted.");
      loadData();
    } catch (err) {
      error(err.message || "Couldn't delete the role.");
    }
  };

  const togglePerm = (permId) => {
    setSelectedPerms((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  };

  const groupedPerms = permissions.reduce((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  if (loading) return <div className="am-loading">Loading...</div>;
  if (!canManage) return <div className="am-empty">You do not have permission to manage roles.</div>;

  return (
    <div className="admin-management">
      <div className="am-header">
        <h2 className="am-title">Role Management</h2>
        <button className="am-btn am-btn-primary" onClick={openCreate}><FiPlus /> Create Role</button>
      </div>

      {showForm && (
        <div className="am-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="am-modal am-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="am-modal-header">
              <h3>{editingRole ? "Edit Role" : "Create Role"}</h3>
              <FiX className="am-modal-close" onClick={() => setShowForm(false)} />
            </div>
            <div className="am-modal-body">
              <div className="am-form-grid am-form-grid-2">
                <label>Role Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              </div>
              <h4>Permissions</h4>
              {permsLoading && <p className="am-empty">Loading this role's permissions…</p>}
              {loadFailed && (
                <p className="am-empty">
                  Couldn't load this role's current permissions. Close and retry —
                  saving now would overwrite them.
                </p>
              )}
              <div className="am-permission-grid" hidden={permsLoading || loadFailed}>
                {Object.entries(groupedPerms).map(([module, perms]) => (
                  <div key={module} className="am-perm-group">
                    <h5 className="am-perm-module">{module}</h5>
                    {perms.map((p) => (
                      <label key={p.id} className={`am-perm-item ${selectedPerms.includes(p.id) ? "active" : ""}`}>
                        <input
                          type="checkbox"
                          checked={selectedPerms.includes(p.id)}
                          onChange={() => togglePerm(p.id)}
                        />
                        <span className="am-perm-name">{p.name}</span>
                        <span className="am-perm-desc">{p.description}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="am-modal-footer">
              <button className="am-btn am-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button
                className="am-btn am-btn-primary"
                onClick={handleSave}
                disabled={!!editingRole && (permsLoading || loadFailed)}
              ><FiSave /> Save</button>
            </div>
          </div>
        </div>
      )}

      <div className="am-role-grid">
        {roles.map((role) => (
          <div key={role.id} className="am-role-card">
            <div className="am-role-card-header">
              <FiShield className="am-role-icon" />
              <div>
                <h3>{role.name}</h3>
                <p>{role.description || "No description"}</p>
              </div>
            </div>
            <div className="am-role-card-actions">
              <button className="am-btn am-btn-sm" onClick={() => openEdit(role)}><FiEdit2 /> Edit</button>
              <button className="am-btn am-btn-sm am-btn-danger" onClick={() => handleDelete(role.id)}><FiTrash2 /> Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
