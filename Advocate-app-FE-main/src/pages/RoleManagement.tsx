import { useEffect, useState } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { Card } from "primereact/card";
import { ProgressSpinner } from "primereact/progressspinner";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext";
import "../assets/styles/AdminManagement.css";

export default function RoleManagement() {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [selectedPerms, setSelectedPerms] = useState<any[]>([]);
  const [permsLoading, setPermsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const { hasPermission } = usePermission() as any;
  const { success, error } = useToast() as any;
  const canManage = hasPermission("ROLE_MANAGE");

  const loadData = async () => {
    try {
      const [r, p] = await Promise.all([rbacService.getAllRoles(), rbacService.getAllPermissions()]);
      setRoles(r);
      setPermissions(p);
    } catch {
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

  const openEdit = async (role: any) => {
    setEditingRole(role);
    setLoadFailed(false);
    setForm({ name: role.name, description: role.description || "" });
    // GET roles/<id>/permissions returns full permission OBJECTS; map to ids
    // so saving never posts an empty list and wipes the role.
    setPermsLoading(true);
    setSelectedPerms([]);
    setShowForm(true);
    try {
      const perms = await rbacService.getRolePermissions(role.id);
      setSelectedPerms((perms || []).map((p: any) => (typeof p === "object" ? p.id : p)));
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
    } catch (err: any) {
      error(err.message || "Couldn't save the role.");
    }
  };

  const handleDelete = (id: any) => {
    confirmDialog({
      message: "Delete this role? This cannot be undone.",
      header: "Delete role",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await rbacService.deleteRole(id);
          success("Role deleted.");
          loadData();
        } catch (err: any) {
          error(err.message || "Couldn't delete the role.");
        }
      },
    });
  };

  const togglePerm = (permId: any) => {
    setSelectedPerms((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  };

  const groupedPerms = permissions.reduce((acc: Record<string, any[]>, p: any) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  if (loading) return <div className="flex justify-content-center p-5"><ProgressSpinner style={{ width: 40, height: 40 }} /></div>;
  if (!canManage) return <div className="am-empty">You do not have permission to manage roles.</div>;

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancel" severity="secondary" outlined onClick={() => setShowForm(false)} />
      <Button
        label="Save"
        icon="pi pi-save"
        onClick={handleSave}
        disabled={!!editingRole && (permsLoading || loadFailed)}
      />
    </div>
  );

  return (
    <div className="admin-management">
      <ConfirmDialog />
      <div className="flex justify-content-end mb-3">
        <Button label="Create Role" icon="pi pi-plus" onClick={openCreate} />
      </div>

      <Dialog
        visible={showForm}
        onHide={() => setShowForm(false)}
        header={editingRole ? "Edit Role" : "Create Role"}
        footer={footer}
        style={{ width: "min(860px, 95vw)" }}
        dismissableMask
      >
        <div className="grid">
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label htmlFor="role-name">Role Name</label>
            <InputText id="role-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label htmlFor="role-desc">Description</label>
            <InputText id="role-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <h4 className="mt-3 mb-2">Permissions</h4>
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
              {(perms as any[]).map((p) => (
                <label key={p.id} className={`am-perm-item ${selectedPerms.includes(p.id) ? "active" : ""}`}>
                  <Checkbox checked={selectedPerms.includes(p.id)} onChange={() => togglePerm(p.id)} />
                  <span className="am-perm-name">{p.name}</span>
                  <span className="am-perm-desc">{p.description}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </Dialog>

      <div className="grid">
        {roles.map((role) => (
          <div key={role.id} className="col-12 md:col-6 lg:col-4">
            <Card className="h-full">
              <div className="flex align-items-start gap-3">
                <i className="pi pi-shield am-role-icon" />
                <div>
                  <h3 className="m-0">{role.name}</h3>
                  <p className="am-muted mt-1 mb-0">{role.description || "No description"}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="small" outlined icon="pi pi-pencil" label="Edit" onClick={() => openEdit(role)} />
                <Button size="small" outlined severity="danger" icon="pi pi-trash" label="Delete" onClick={() => handleDelete(role.id)} />
              </div>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
