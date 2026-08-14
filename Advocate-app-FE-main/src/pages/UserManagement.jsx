import React, { useEffect, useState } from "react";
import { FiEdit2, FiTrash2, FiUserPlus, FiX, FiSave } from "react-icons/fi";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import "../assets/styles/AdminManagement.css";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", barCouncilId: "", specialization: "", experience: 0 });
  const [selectedRoles, setSelectedRoles] = useState([]);
  const { hasPermission } = usePermission();
  const canManage = hasPermission("USER_MANAGE");

  const loadData = async () => {
    try {
      const [u, r] = await Promise.all([rbacService.getAllUsers(), rbacService.getAllRoles()]);
      setUsers(u);
      setRoles(r);
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditingUser(null);
    setForm({ fullName: "", email: "", phone: "", barCouncilId: "", specialization: "", experience: 0 });
    setSelectedRoles([]);
    setShowForm(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName || "",
      email: user.email || "",
      phone: user.phone || "",
      barCouncilId: user.barCouncilId || "",
      specialization: user.specialization || "",
      experience: user.experience || 0,
    });
    setSelectedRoles(user.roleIds || []);
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (editingUser) {
        await rbacService.updateUser(editingUser.id, form);
        if (selectedRoles.length > 0) {
          await rbacService.setUserRoles(editingUser.id, selectedRoles);
        }
      } else {
        const created = await rbacService.createUser({ ...form, password: "changeme123" });
        if (selectedRoles.length > 0) {
          await rbacService.setUserRoles(created.id, selectedRoles);
        }
      }
      setShowForm(false);
      loadData();
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user?")) return;
    try {
      await rbacService.deleteUser(id);
      loadData();
    } catch (err) {
      alert("Error: " + err.message);
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
              </div>
              <div className="am-role-select">
                <h4>Assign Roles</h4>
                <div className="am-role-chips">
                  {roles.map((r) => (
                    <button key={r.id} className={`am-chip ${selectedRoles.includes(r.id) ? "active" : ""}`} onClick={() => toggleRole(r.id)}>
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="am-modal-footer">
              <button className="am-btn am-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="am-btn am-btn-primary" onClick={handleSave}><FiSave /> Save</button>
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
