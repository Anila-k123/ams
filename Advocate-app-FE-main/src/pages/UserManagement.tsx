import { useEffect, useState } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Password } from "primereact/password";
import { Dropdown } from "primereact/dropdown";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext";
import "../assets/styles/AdminManagement.css";

const EMPTY_FORM = { fullName: "", email: "", phone: "", barCouncilId: "", specialization: "", experience: 0 };

export default function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [selectedRoles, setSelectedRoles] = useState<any[]>([]);
  const [password, setPassword] = useState("");
  // Which practice the account belongs to: "" = heads their own practice (a
  // senior) or firm-wide staff; an id = reports to that senior.
  const [practiceOwnerId, setPracticeOwnerId] = useState("");
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesLoadFailed, setRolesLoadFailed] = useState(false);
  const { hasPermission } = usePermission() as any;
  const { success, error } = useToast() as any;
  const canManage = hasPermission("USER_MANAGE");

  const loadData = async () => {
    try {
      const [u, r] = await Promise.all([rbacService.getAllUsers(), rbacService.getAllRoles()]);
      setUsers(u);
      setRoles(r);
    } catch {
      error("Couldn't load users and roles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setPracticeOwnerId("");
    setSelectedRoles([]);
    setPassword("");
    setRolesLoading(false);
    setRolesLoadFailed(false);
    setShowForm(true);
  };

  const openEdit = async (user: any) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName || "",
      email: user.email || "",
      phone: user.phone || "",
      barCouncilId: user.barCouncilId || "",
      specialization: user.specialization || "",
      experience: user.experience || 0,
    });
    setPracticeOwnerId(user.practiceOwnerId ? String(user.practiceOwnerId) : "");
    // The users endpoint returns `roles` as NAMES; fetch the ids separately.
    setPassword("");
    setSelectedRoles([]);
    setRolesLoadFailed(false);
    setRolesLoading(true);
    setShowForm(true);
    try {
      const assigned = await rbacService.getUserRoles(user.id);
      setSelectedRoles((assigned || []).map((r: any) => (typeof r === "object" ? r.id : r)));
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
      const practiceOwner = practiceOwnerId ? Number(practiceOwnerId) : null;
      if (editingUser) {
        await rbacService.updateUser(editingUser.id, { ...form, practiceOwnerId: practiceOwner });
        // Sync unconditionally so a user's last role can be removed.
        await rbacService.setUserRoles(editingUser.id, selectedRoles);
      } else {
        const created = await rbacService.createUser({ ...form, password, practiceOwnerId: practiceOwner });
        if (selectedRoles.length > 0) {
          await rbacService.setUserRoles(created.id, selectedRoles);
        }
      }
      setShowForm(false);
      setPassword("");
      success(editingUser ? "User updated." : "User created.");
      loadData();
    } catch (err: any) {
      error(err.message || "Couldn't save the user.");
    }
  };

  const handleDelete = (user: any) => {
    // The server decides: an account that created anything is closed (records
    // kept); only an empty one is really deleted.
    const prompt = user.sharesPractice
      ? `Remove ${user.email} from the practice? They will no longer be able to sign in. The cases, clients and invoices they created stay with the practice.`
      : `Delete ${user.email}? If they have created any records the account is closed instead, and those records are kept.`;
    confirmDialog({
      message: prompt,
      header: user.sharesPractice ? "Remove from practice" : "Delete user",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      style: { maxWidth: 480 },
      accept: async () => {
        try {
          const res = await rbacService.deleteUser(user.id);
          success(res?.message || (res?.closed ? "Account closed." : "User deleted."));
          loadData();
        } catch (err: any) {
          error(err.message || "Couldn't remove the user.");
        }
      },
    });
  };

  const toggleRole = (roleId: any) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]
    );
  };

  if (loading) return <div className="flex justify-content-center p-5"><ProgressSpinner style={{ width: 40, height: 40 }} /></div>;
  if (!canManage) return <div className="am-empty">You do not have permission to manage users.</div>;

  const seniors = users.filter(
    (u) => u.isPracticeHead && u.active !== false && (!editingUser || u.id !== editingUser.id)
  );
  const nameById: Record<string, any> = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  const practiceOptions = [
    { label: "Head of own practice / firm-wide staff", value: "" },
    ...seniors.map((s) => ({ label: `Reports to ${s.fullName}`, value: String(s.id) })),
  ];

  const field = (key: string, label: string, type = "text") => (
    <div className="col-12 md:col-6 flex flex-column gap-1">
      <label htmlFor={`um-${key}`}>{label}</label>
      <InputText id={`um-${key}`} type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </div>
  );

  const practiceBody = (u: any) =>
    u.active === false
      ? <Tag severity="danger" value="Left" />
      : u.firmWide
        ? <Tag severity="info" value="Firm-wide" />
        : u.isPracticeHead
          ? <Tag severity="success" value={`Head${u.memberCount ? ` (${u.memberCount})` : ""}`} />
          : <Tag severity="info" value={`Reports to ${nameById[u.practiceOwnerId] || "—"}`} />;

  const actionsBody = (u: any) => (
    <div className="flex gap-1">
      <Button icon="pi pi-pencil" rounded text tooltip="Edit" tooltipOptions={{ position: "top" }} onClick={() => openEdit(u)} />
      <Button
        icon="pi pi-trash" rounded text severity="danger"
        tooltip={u.sharesPractice ? "Remove from practice" : "Delete"} tooltipOptions={{ position: "top" }}
        onClick={() => handleDelete(u)}
      />
    </div>
  );

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancel" severity="secondary" outlined onClick={() => setShowForm(false)} />
      <Button
        label="Save"
        icon="pi pi-save"
        onClick={handleSave}
        disabled={!!editingUser && (rolesLoading || rolesLoadFailed)}
      />
    </div>
  );

  return (
    <div className="admin-management">
      <ConfirmDialog />
      <div className="flex justify-content-end mb-3">
        <Button label="Create User" icon="pi pi-user-plus" onClick={openCreate} />
      </div>

      <Dialog
        visible={showForm}
        onHide={() => setShowForm(false)}
        header={editingUser ? "Edit User" : "Create User"}
        footer={footer}
        style={{ width: "min(640px, 95vw)" }}
        dismissableMask
      >
        <div className="grid">
          {field("fullName", "Full Name")}
          {field("email", "Email", "email")}
          {field("phone", "Phone")}
          {field("barCouncilId", "Bar Council ID")}
          {field("specialization", "Specialization")}
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label htmlFor="um-experience">Experience (years)</label>
            <InputNumber inputId="um-experience" value={form.experience} onValueChange={(e) => setForm({ ...form, experience: Number(e.value) || 0 })} useGrouping={false} />
          </div>
          {!editingUser && (
            <div className="col-12 md:col-6 flex flex-column gap-1">
              <label htmlFor="um-password">Initial Password</label>
              <Password
                inputId="um-password"
                value={password}
                feedback={false}
                toggleMask
                autoComplete="new-password"
                placeholder="Min. 8 characters"
                onChange={(e) => setPassword(e.target.value)}
                inputClassName="w-full"
                className="w-full"
              />
            </div>
          )}
        </div>
        {!editingUser && (
          <p className="am-empty text-left py-1">
            Share this password with the user directly and ask them to change it after first sign-in.
          </p>
        )}
        {seniors.length > 0 ? (
          <div className="flex flex-column gap-1 mt-2">
            <strong>Practice</strong>
            <Dropdown value={practiceOwnerId} options={practiceOptions} onChange={(e) => setPracticeOwnerId(e.value)} />
            <small className="am-muted">
              Pick the senior this person reports to — they join that team's loop
              (its cases, cause-list and hearing alerts). Choose “Head / firm-wide”
              for a senior who leads their own team, or for common staff (accountant,
              receptionist) who serve the whole firm through their role.
            </small>
          </div>
        ) : (
          <p className="am-empty text-left py-1">
            This account will head its own practice. Once you add colleagues, you'll be able to assign who reports to whom here.
          </p>
        )}
        <div className="mt-3">
          <h4 className="mb-2">Assign Roles</h4>
          {rolesLoading && <p className="am-empty">Loading this user's roles…</p>}
          {rolesLoadFailed && (
            <p className="am-empty">
              Couldn't load this user's current roles. Close and retry — saving now would overwrite them.
            </p>
          )}
          <div className="flex flex-wrap gap-2" hidden={rolesLoading || rolesLoadFailed}>
            {roles.map((r) => (
              <Button
                key={r.id}
                type="button"
                size="small"
                rounded
                label={r.name}
                outlined={!selectedRoles.includes(r.id)}
                icon={selectedRoles.includes(r.id) ? "pi pi-check" : undefined}
                onClick={() => toggleRole(r.id)}
              />
            ))}
          </div>
        </div>
      </Dialog>

      <DataTable value={users} dataKey="id" stripedRows size="small" emptyMessage="No users.">
        <Column field="fullName" header="Name" />
        <Column field="email" header="Email" />
        <Column field="phone" header="Phone" />
        <Column field="specialization" header="Specialization" />
        <Column header="Roles" body={(u: any) => (u.roles || []).join(", ")} />
        <Column header="Practice" body={practiceBody} />
        <Column header="Actions" body={actionsBody} />
      </DataTable>
    </div>
  );
}
