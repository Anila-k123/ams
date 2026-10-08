// Team Members: everyone who signs in for this firm, their roles and which
// senior's practice they report to.
import { useEffect, useMemo, useState } from "react";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext";
import FieldError from "../components/FieldError";
import { formatErrors, mobileInput } from "../utils/validators";
import { PageHead, Button, Chip, Avatar, EmptyState, PopMenu, Icon, type MenuItem } from "../ui/kit";
import { Field, TextField, SelectField, SearchInput, FilterChip } from "../ui/forms";
import { Modal, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/firm.css";

const EMPTY_FORM = { fullName: "", email: "", phone: "", barCouncilId: "", specialization: "", experience: 0 };
// Checked as you leave a field, and again on the server (core/validators.py).
const USER_FORMATS = { email: "email", phone: "phone" } as const;

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
  // Hooks stay above every early return: below one they ran on some renders
  // only and React threw "Rendered more hooks than during the previous render".
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [triedSave, setTriedSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [menu, setMenu] = useState<{ el: HTMLElement; user: any } | null>(null);
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

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  useEffect(() => { loadData(); }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) =>
      (!s || [u.fullName, u.email, u.phone].some((v) => String(v || "").toLowerCase().includes(s)))
      && (!roleFilter || (u.roles || []).includes(roleFilter))
      && (!statusFilter || (u.active === false ? "left" : "active") === statusFilter));
  }, [users, q, roleFilter, statusFilter]);

  const openCreate = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setPracticeOwnerId("");
    setSelectedRoles([]);
    setPassword("");
    setRolesLoading(false);
    setRolesLoadFailed(false);
    setTouched({});
    setTriedSave(false);
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
    setTouched({});
    setTriedSave(false);
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
    if (!form.fullName.trim()) { setTriedSave(true); error("Full name is required."); return; }
    if (!form.email.trim()) { setTriedSave(true); error("Email is required."); return; }
    const bad = formatErrors(form, USER_FORMATS);
    if (Object.keys(bad).length) { setTriedSave(true); error(Object.values(bad)[0]); return; }
    if (!editingUser && password.length < 8) {
      setTriedSave(true);
      error("Set an initial password of at least 8 characters.");
      return;
    }
    if (editingUser && (rolesLoading || rolesLoadFailed)) {
      error(rolesLoading ? "Still loading this user's roles…"
                         : "Cannot save: this user's current roles could not be loaded.");
      return;
    }
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (user: any) => {
    // The server decides: an account that created anything is closed (records
    // kept); only an empty one is really deleted.
    const prompt = user.sharesPractice
      ? `Remove ${user.email} from the practice? They will no longer be able to sign in. The cases, clients and invoices they created stay with the practice.`
      : `Delete ${user.email}? If they have created any records the account is closed instead, and those records are kept.`;
    confirm({
      title: user.sharesPractice ? `Remove ${user.fullName || user.email}?` : `Delete ${user.fullName || user.email}?`,
      message: prompt,
      danger: true,
      confirmLabel: user.sharesPractice ? "Remove from practice" : "Delete user",
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

  if (!canManage) {
    return <EmptyState icon="lock" title="No access" text="You do not have permission to manage users." />;
  }

  const seniors = users.filter(
    (u) => u.isPracticeHead && u.active !== false && (!editingUser || u.id !== editingUser.id)
  );
  const nameById: Record<string, any> = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  const practiceOptions = [
    { label: "Head of own practice / firm-wide staff", value: "" },
    ...seniors.map((s) => ({ label: `Reports to ${s.fullName}`, value: String(s.id) })),
  ];

  const errs = formatErrors(form, USER_FORMATS) as Record<string, string>;
  const required: Record<string, string> = {
    fullName: form.fullName.trim() ? "" : "Enter the person's name.",
    email: form.email.trim() ? "" : "Enter their work email.",
  };
  const msgFor = (key: string) => (touched[key] || triedSave ? required[key] || errs[key] || "" : "");

  const text = (key: string, label: string, type = "text", extra: Record<string, any> = {}) => (
    <Field label={label} required={key in required}>
      {(id) => (
        <>
          <input id={id} type={type} className="input" value={form[key]} aria-invalid={!!msgFor(key) || undefined}
            onChange={(e) => setForm({ ...form, [key]: key === "phone" ? mobileInput(e.target.value) : e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, [key]: true }))} {...extra} />
          <FieldError error={msgFor(key)} />
        </>
      )}
    </Field>
  );

  const practiceCell = (u: any) =>
    u.active === false
      ? <Chip>Left</Chip>
      : u.firmWide
        ? <Chip tone="info">Firm-wide</Chip>
        : u.isPracticeHead
          ? <Chip tone="ok">{`Head${u.memberCount ? ` (${u.memberCount})` : ""}`}</Chip>
          : <span className="small">Reports to {nameById[u.practiceOwnerId] || "—"}</span>;

  const columns: Column<any>[] = [
    {
      key: "fullName", label: "Team member", sort: true, render: (u) => (
        <div className="row" style={{ gap: 10 }}>
          <Avatar name={u.fullName} />
          <div style={{ minWidth: 0 }}>
            <div className="cell-title">{u.fullName || "—"}</div>
            <div className="cell-sub ellipsis">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "roles", label: "Roles", render: (u) => (u.roles || []).length
        ? <div className="row wrap" style={{ gap: 4 }}>{u.roles.map((r: string) => <Chip key={r} tone={r === "Super Admin" ? "tape" : ""} plain={r !== "Super Admin"}>{r}</Chip>)}</div>
        : <span className="faint">No role</span>,
    },
    { key: "practice", label: "Practice", hideSm: true, render: practiceCell },
    { key: "phone", label: "Phone", hideSm: true, render: (u) => u.phone ? <span className="num nowrap">{u.phone}</span> : <span className="faint">—</span> },
    { key: "specialization", label: "Specialisation", hideSm: true, sort: true, render: (u) => u.specialization || <span className="faint">—</span> },
    { key: "status", label: "Status", render: (u) => u.active === false ? <Chip>Left</Chip> : <Chip tone="ok">Active</Chip> },
    {
      key: "act", label: <span className="sr-only">Actions</span>, width: 48, render: (u) => (
        <button type="button" className="btn ghost sm icon" aria-label={`Actions for ${u.fullName || u.email}`} aria-haspopup="menu"
          onClick={(e) => setMenu({ el: e.currentTarget, user: u })}>
          <Icon name="more" size="sm" />
        </button>
      ),
    },
  ];

  const menuItems: MenuItem[] = menu ? [
    { label: "Edit", icon: "edit", onClick: () => openEdit(menu.user) },
    "-",
    { label: menu.user.sharesPractice ? "Remove from practice" : "Delete", icon: "trash", danger: true, onClick: () => handleDelete(menu.user) },
  ] : [];

  const saveBlocked = !!editingUser && (rolesLoading || rolesLoadFailed);

  return (
    <div>
      <PageHead
        title="Team Members"
        sub="Everyone who signs in for the firm. Clients are managed from their client page."
        actions={<Button variant="primary" icon="plus" onClick={openCreate}>Add team member</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, email or phone" />
        <select className="input" aria-label="Role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ width: "auto" }}>
          <option value="">All roles</option>
          {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        </select>
        <select className="input" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: "auto" }}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="left">Left</option>
        </select>
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(u) => u.id}
        loading={loading}
        onRow={openEdit}
        initialSort={{ key: "fullName", dir: "asc" }}
        caption="Team members"
        empty={{ icon: "users", title: users.length ? "No one matches" : "No team members yet", text: users.length ? "Try a different search or filter." : "Add the first colleague to get started." }}
      />
      {menu && <PopMenu anchor={menu.el} items={menuItems} onClose={() => setMenu(null)} align="right" width={210} />}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        size="wide"
        title={editingUser ? "Edit team member" : "Add team member"}
        sub={editingUser ? editingUser.email : "Share the initial password with them directly and ask them to change it after first sign-in."}
        footer={<>
          <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave} disabled={saveBlocked || saving}
            title={saveBlocked ? (rolesLoading ? "Loading roles…" : "Roles could not be loaded") : undefined}>
            {editingUser ? "Save changes" : "Add team member"}
          </Button>
        </>}
      >
        <form className="stack" style={{ gap: 20 }} noValidate onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className="form-grid">
            {text("fullName", "Full name")}
            {text("email", "Work email", "email", { autoComplete: "off" })}
            {text("phone", "Mobile", "tel", { inputMode: "numeric", maxLength: 10, placeholder: "98765 43210", title: "10 digits, starting with 6, 7, 8 or 9." })}
            {text("barCouncilId", "Bar Council no.", "text", { placeholder: "Advocates only", className: "input mono" })}
            {text("specialization", "Specialisation")}
            <TextField label="Experience (years)" type="number" min={0} value={form.experience}
              onChange={(e) => setForm({ ...form, experience: Number(e.target.value) || 0 })} />
            {!editingUser && (
              <TextField label="Initial password" type="password" required autoComplete="new-password" placeholder="Min. 8 characters"
                value={password} onChange={(e) => setPassword(e.target.value)}
                hint="At least 8 characters. Share it with them privately."
                error={triedSave && password.length < 8 ? "Use at least 8 characters." : null} />
            )}
            {seniors.length > 0 ? (
              <SelectField label="Practice" full value={practiceOwnerId} options={practiceOptions}
                onChange={(e) => setPracticeOwnerId(e.target.value)}
                hint={"Pick the senior this person reports to: they join that team's loop (its cases, cause-list and hearing alerts). "
                  + "Choose “Head / firm-wide” for a senior who leads their own team, or for common staff (the accountant) who serve the whole firm through their role. "
                  + "A new senior's team is part of this firm, but the other seniors' teams do not see its cases; the Super Admin and Accountant see every team."} />
            ) : (
              <div className="callout info full"><Icon name="info" className="i" size="sm" />
                <div>This account will head its own practice. Once you add colleagues, you'll be able to assign who reports to whom here.</div>
              </div>
            )}
          </div>

          <div>
            <div className="label" id="um-roles-l" style={{ marginBottom: 8 }}>Roles</div>
            {rolesLoading && <p className="faint small">Loading this user's roles…</p>}
            {rolesLoadFailed && (
              <div className="callout warn"><Icon name="warn" className="i" size="sm" />
                <div>Couldn't load this user's current roles. Close and retry: saving now would overwrite them.</div>
              </div>
            )}
            <div className="row wrap" role="group" aria-labelledby="um-roles-l" hidden={rolesLoading || rolesLoadFailed}>
              {roles.map((r) => (
                <FilterChip key={r.id} on={selectedRoles.includes(r.id)} onClick={() => toggleRole(r.id)}>
                  {selectedRoles.includes(r.id) && <Icon name="check" size="sm" />}{r.name}
                </FilterChip>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
