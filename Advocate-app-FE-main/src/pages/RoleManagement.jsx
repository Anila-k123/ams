import React, { useEffect, useState } from "react";
import { FiEdit2, FiTrash2, FiPlus, FiX, FiSave, FiShield } from "react-icons/fi";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import "../assets/styles/AdminManagement.css";

export default function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRole, setEditingRole] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [selectedPerms, setSelectedPerms] = useState([]);
  const { hasPermission } = usePermission();
  const canManage = hasPermission("ROLE_MANAGE");

  const loadData = async () => {
    try {
      const [r, p] = await Promise.all([rbacService.getAllRoles(), rbacService.getAllPermissions()]);
      setRoles(r);
      setPermissions(p);
    } catch (err) {
      console.error("Failed to load roles:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditingRole(null);
    setForm({ name: "", description: "" });
    setSelectedPerms([]);
    setShowForm(true);
  };

  const openEdit = async (role) => {
    setEditingRole(role);
    setForm({ name: role.name, description: role.description || "" });
    try {
      const permIds = await rbacService.getRolePermissions(role.id);
      setSelectedPerms(permIds);
    } catch {
      setSelectedPerms([]);
    }
    setShowForm(true);
  };

  const handleSave = async () => {
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
      loadData();
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this role?")) return;
    try {
      await rbacService.deleteRole(id);
      loadData();
    } catch (err) {
      alert("Error: " + err.message);
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
              <div className="am-permission-grid">
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
              <button className="am-btn am-btn-primary" onClick={handleSave}><FiSave /> Save</button>
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
