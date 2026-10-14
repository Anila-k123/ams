// Team Members: everyone who works in this firm - their roles, which senior's
// practice they report to, their membership (active, invited, suspended,
// left) and the invitations sent. New people are invited by email and choose
// their own password (firms/invitations.py); an administrator never sets one.
// The server enforces every rule shown here (last administrator, who may grant
// high-risk roles, firm boundaries); the page only explains them early.
import { useCallback, useEffect, useMemo, useState } from "react";
import api, { errorMessage } from "../api/client";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext";
import FieldError from "../components/FieldError";
import { emailError, formatErrors, mobileInput } from "../utils/validators";
import { deliveryLabel } from "../utils/delivery";
import { PageHead, Button, Chip, Avatar, EmptyState, PopMenu, Icon, StatusChip, type MenuItem } from "../ui/kit";
import { Field, TextField, SelectField, SearchInput, FilterChip, Tabs } from "../ui/forms";
import { Modal, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/firm.css";

const EMPTY_FORM = { fullName: "", email: "", phone: "", barCouncilId: "", specialization: "", experience: 0 };
// Checked as you leave a field, and again on the server (core/validators.py).
const USER_FORMATS = { email: "email", phone: "phone" } as const;

type Role = { id: number; name: string; isAdmin?: boolean; disabled?: boolean; template?: boolean; builtIn?: boolean };
/** A row of /api/firm/members: the person's membership of this firm. */
export type Member = {
  advocateId: number; fullName: string; email: string; status: string; membershipId: number
  joinedAt: string | null; leftAt: string | null; isSelf: boolean; isAdmin: boolean
  roles: { id: number; name: string; isAdmin: boolean }[]
  invitation: { id: number; status: string; deliveryStatus: string; expiresAt: string } | null
};
type Invitation = {
  id: number; email: string; kind: string; status: string; roleIds: number[]; expiresAt: string; createdAt: string
  sendCount: number; deliveryStatus: string; deliveryError: string; lastSentAt: string | null
};
type Tab = "ACTIVE" | "INVITED" | "SUSPENDED" | "LEFT" | "invitations";

/** Roles an administrator can hand out: the firm's own, enabled roles. */
export const assignableRoles = (roles: Role[]) => roles.filter((r) => !r.template && !r.builtIn && !r.disabled);

/** Would this change leave the firm without an active administrator? */
export const isLastAdmin = (m: Pick<Member, "isAdmin">, members: Pick<Member, "isAdmin" | "status">[]) =>
  m.isAdmin && members.filter((x) => x.status === "ACTIVE" && x.isAdmin).length <= 1;

const EMPTY_INVITE = { email: "", fullName: "", roleIds: [] as number[], teamRootId: "" };

export default function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [selectedRoles, setSelectedRoles] = useState<any[]>([]);
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
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const [menu, setMenu] = useState<{ el: HTMLElement; user: any } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inv, setInv] = useState(EMPTY_INVITE);
  const [inviteTried, setInviteTried] = useState(false);
  const { hasPermission } = usePermission() as any;
  const { success, error } = useToast() as any;
  const canManage = hasPermission("USER_MANAGE");

  const loadData = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([rbacService.getAllUsers(), rbacService.getAllRoles()]);
      setUsers(u);
      setRoles(r);
    } catch {
      error("Couldn't load users and roles.");
    } finally {
      setLoading(false);
    }
    // Membership status and invitations (firm administration API).
    api.get("/api/firm/members").then((res) => setMembers(res.data)).catch(() => setMembers([]));
    api.get("/api/firm/invitations").then((res) => setInvites(res.data)).catch(() => setInvites([]));
  }, [error]);

  useEffect(() => { loadData(); }, [loadData]);

  // Profile rows (users) joined with their membership in this firm.
  const memberById = useMemo(() => new Map(members.map((m) => [m.advocateId, m])), [members]);
  const statusOf = useCallback((u: any) => memberById.get(u.id)?.status || (u.active === false ? "LEFT" : "ACTIVE"),
    [memberById]);
  const memberRows = useMemo(() => members.map((m) => ({ status: m.status, isAdmin: m.isAdmin })), [members]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    users.forEach((u) => { const s = statusOf(u); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [users, statusOf]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) => statusOf(u) === tab
      && (!s || [u.fullName, u.email, u.phone].some((v) => String(v || "").toLowerCase().includes(s)))
      && (!roleFilter || (u.roles || []).includes(roleFilter)));
  }, [users, q, roleFilter, tab, statusOf]);

  const choices = useMemo(() => assignableRoles(roles), [roles]);
  const roleName = (id: number) => roles.find((r) => r.id === id)?.name || `#${id}`;

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
    setSelectedRoles([]);
    setRolesLoadFailed(false);
    setRolesLoading(true);
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

  const doSave = async () => {
    setSaving(true);
    try {
      const practiceOwner = practiceOwnerId ? Number(practiceOwnerId) : null;
      await rbacService.updateUser(editingUser.id, { ...form, practiceOwnerId: practiceOwner });
      // Sync unconditionally so a user's last role can be removed.
      await rbacService.setUserRoles(editingUser.id, selectedRoles);
      setEditingUser(null);
      success("User updated.");
      loadData();
    } catch (err: any) {
      error(err.message || "Couldn't save the user.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!form.fullName.trim()) { setTriedSave(true); error("Full name is required."); return; }
    if (!form.email.trim()) { setTriedSave(true); error("Email is required."); return; }
    const bad = formatErrors(form, USER_FORMATS);
    if (Object.keys(bad).length) { setTriedSave(true); error(Object.values(bad)[0]); return; }
    if (rolesLoading || rolesLoadFailed) {
      error(rolesLoading ? "Still loading this user's roles…"
                         : "Cannot save: this user's current roles could not be loaded.");
      return;
    }
    const m = memberById.get(editingUser.id);
    const keepsAdmin = selectedRoles.some((id) => roles.find((r) => r.id === id)?.isAdmin);
    const removingAdmin = !!m?.isAdmin && !keepsAdmin;
    if (removingAdmin && isLastAdmin(m!, memberRows)) {
      error("This is the firm's last active administrator; the administrator role can't be removed.");
      return;
    }
    if (removingAdmin || m?.isSelf) {
      confirm({
        title: "Change these roles?", danger: true, confirmLabel: "Save changes",
        message: m?.isSelf ? "You are changing your own roles. You may lose access to this page."
                           : `${editingUser.fullName} stops being a firm administrator.`,
        accept: () => { doSave(); },
      });
      return;
    }
    doSave();
  };

  const handleDelete = (user: any) => {
    const m = memberById.get(user.id);
    if (m && isLastAdmin(m, memberRows)) {
      error("This is the firm's last active administrator. Give someone else the administrator role first.");
      return;
    }
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

  /** Suspend (temporary, sessions end at once) or reactivate a membership. */
  const lifecycle = (user: any, action: "suspend" | "reactivate") => {
    const m = memberById.get(user.id);
    if (action === "suspend" && m && isLastAdmin(m, memberRows)) {
      error("This is the firm's last active administrator. Give someone else the administrator role first.");
      return;
    }
    const name = user.fullName || user.email;
    const text = action === "suspend"
      ? { title: `Suspend ${name}?`, label: "Suspend", msg: "They are signed out at once and can't sign in until reactivated. Their work stays with the firm and their roles are kept." }
      : { title: `Reactivate ${name}?`, label: "Reactivate", msg: "They can sign in again with their existing roles." };
    confirm({
      title: text.title, message: text.msg, confirmLabel: text.label, danger: action === "suspend",
      accept: async () => {
        try {
          await api.post(`/api/firm/members/${user.id}/${action}`);
          success(`${name}: ${action === "suspend" ? "suspended" : "reactivated"}.`);
          loadData();
        } catch (e) {
          error(errorMessage(e, "That did not work."));
        }
      },
    });
  };

  // ---- invitations ----------------------------------------------------
  const inviteErrors = {
    email: !inv.email.trim() ? "Enter their email." : emailError(inv.email),
    roleIds: inv.roleIds.length ? "" : "Choose at least one role.",
  };
  const sendInvite = async () => {
    setInviteTried(true);
    if (inviteErrors.email || inviteErrors.roleIds) return;
    setSaving(true);
    try {
      await api.post("/api/firm/invitations", {
        email: inv.email.trim(), fullName: inv.fullName.trim(), roleIds: inv.roleIds,
        ...(inv.teamRootId ? { teamRootId: Number(inv.teamRootId) } : {}),
      });
      success(`Invitation sent to ${inv.email.trim()}.`);
      setInviteOpen(false); setInv(EMPTY_INVITE); setInviteTried(false);
      loadData();
    } catch (e) {
      error(errorMessage(e, "Couldn't send the invitation."));
    } finally {
      setSaving(false);
    }
  };

  const inviteAction = (i: Invitation, action: "resend" | "revoke") => {
    const go = async () => {
      try {
        await api.post(`/api/firm/invitations/${i.id}/${action}`);
        success(action === "resend" ? `New link sent to ${i.email}.` : "Invitation withdrawn.");
        loadData();
      } catch (e) {
        error(errorMessage(e, "That did not work."));
      }
    };
    if (action === "resend") { go(); return; }
    confirm({
      title: `Withdraw the invitation to ${i.email}?`, danger: true, confirmLabel: "Withdraw",
      message: "The link stops working at once. You can invite them again later.", accept: () => { go(); },
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
    (u) => u.isPracticeHead && u.active !== false && statusOf(u) === "ACTIVE" && (!editingUser || u.id !== editingUser.id)
  );
  const nameById: Record<string, any> = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  const practiceOptions = [
    { label: "Head of own practice / firm-wide staff", value: "" },
    ...seniors.map((s) => ({ label: `Reports to ${s.fullName}`, value: String(s.id) })),
  ];
  const practiceHint = "Pick the senior this person reports to: they join that team's loop (its cases, cause-list and hearing alerts). "
    + "Choose “Head / firm-wide” for a senior who leads their own team, or for common staff (the accountant) who serve the whole firm through their role. "
    + "A new senior's team is part of this firm, but the other seniors' teams do not see its cases; the Super Admin and Accountant see every team.";

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
    statusOf(u) !== "ACTIVE"
      ? <span className="faint">—</span>
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
            <div className="cell-title">{u.fullName || "—"}{memberById.get(u.id)?.isSelf && <span className="faint small"> (you)</span>}</div>
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
    { key: "status", label: "Status", render: (u) => <StatusChip status={statusOf(u)} /> },
    {
      key: "act", label: <span className="sr-only">Actions</span>, width: 48, render: (u) => (
        <button type="button" className="btn ghost sm icon" aria-label={`Actions for ${u.fullName || u.email}`} aria-haspopup="menu"
          onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, user: u }); }}>
          <Icon name="more" size="sm" />
        </button>
      ),
    },
  ];

  const menuItems: MenuItem[] = (() => {
    if (!menu) return [];
    const u = menu.user;
    const status = statusOf(u);
    const self = !!memberById.get(u.id)?.isSelf;
    const items: MenuItem[] = [{ label: "Edit", icon: "edit", onClick: () => openEdit(u) }];
    if (!self && status === "ACTIVE") items.push({ label: "Suspend", icon: "lock", onClick: () => lifecycle(u, "suspend") });
    if (status === "SUSPENDED" || status === "LEFT") items.push({ label: "Reactivate", icon: "check", onClick: () => lifecycle(u, "reactivate") });
    if (!self && status !== "LEFT") {
      items.push("-", { label: u.sharesPractice ? "Remove from practice" : "Delete", icon: "trash", danger: true, onClick: () => handleDelete(u) });
    }
    return items;
  })();

  const inviteCols: Column<Invitation>[] = [
    { key: "email", label: "Email", sort: true },
    { key: "roleIds", label: "Roles", hideSm: true, render: (i) => (i.roleIds || []).map(roleName).join(", ") || "—" },
    { key: "status", label: "Status", render: (i) => <StatusChip status={i.status} /> },
    { key: "deliveryStatus", label: "Email", render: (i) => i.deliveryStatus === "FAILED"
      ? <Chip tone="bad" title={i.deliveryError}>not delivered</Chip> : <span className="small">{deliveryLabel(i.deliveryStatus)}</span> },
    { key: "expiresAt", label: "Expires", hideSm: true, sort: true, render: (i) => new Date(i.expiresAt).toLocaleDateString() },
    { key: "actions", label: <span className="sr-only">Actions</span>, align: "right", render: (i) => (i.status === "PENDING" || i.status === "EXPIRED") && (
      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
        <Button size="sm" onClick={() => inviteAction(i, "resend")}>Resend</Button>
        {i.status === "PENDING" && <Button size="sm" variant="ghost" className="danger" onClick={() => inviteAction(i, "revoke")}>Withdraw</Button>}
      </div>
    ) },
  ];

  const pendingInvites = (invites || []).filter((i) => i.status === "PENDING").length;
  const saveBlocked = rolesLoading || rolesLoadFailed;
  const editingMember = editingUser ? memberById.get(editingUser.id) : undefined;

  return (
    <div>
      <PageHead
        title="Team Members"
        sub="Everyone who works in the firm, their roles and membership. Clients are managed from their client page."
        actions={<Button variant="primary" icon="plus" onClick={() => { setInv(EMPTY_INVITE); setInviteTried(false); setInviteOpen(true); }}>Invite team member</Button>}
      />

      <div className="row between" style={{ gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Tabs<Tab> value={tab} onChange={setTab} label="Member status" tabs={[
          { value: "ACTIVE", label: "Active", count: counts.ACTIVE || 0 },
          { value: "INVITED", label: "Invited", count: counts.INVITED || 0 },
          { value: "SUSPENDED", label: "Suspended", count: counts.SUSPENDED || 0 },
          { value: "LEFT", label: "Left", count: counts.LEFT || 0 },
          { value: "invitations", label: "Invitations", count: pendingInvites },
        ]} />
      </div>

      {tab === "invitations" ? (
        <DataTable rows={invites || []} columns={inviteCols} rowKey={(i) => i.id} loading={invites === null}
          caption="Invitations"
          empty={{ icon: "mail", title: "No invitations yet", text: "Invite a colleague: they get a link to join and set their own password." }} />
      ) : (
        <>
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Search name, email or phone" />
            <select className="input" aria-label="Role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="">All roles</option>
              {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
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
            empty={{ icon: "users", title: users.length ? "No one here" : "No team members yet", text: users.length ? "Try another tab, search or filter." : "Invite the first colleague to get started." }}
          />
        </>
      )}
      {menu && <PopMenu anchor={menu.el} items={menuItems} onClose={() => setMenu(null)} align="right" width={210} />}

      {/* Edit an existing member: profile, practice, roles. */}
      <Modal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        size="wide"
        title="Edit team member"
        sub={editingUser?.email}
        footer={<>
          <Button variant="ghost" onClick={() => setEditingUser(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave} disabled={saveBlocked || saving}
            title={saveBlocked ? (rolesLoading ? "Loading roles…" : "Roles could not be loaded") : undefined}>
            Save changes
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
            {seniors.length > 0 ? (
              <SelectField label="Practice" full value={practiceOwnerId} options={practiceOptions}
                onChange={(e) => setPracticeOwnerId(e.target.value)} hint={practiceHint} />
            ) : (
              <div className="callout info full"><Icon name="info" className="i" size="sm" />
                <div>This account heads its own practice. Once there are colleagues, you can assign who reports to whom here.</div>
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
              {choices.map((r) => (
                <FilterChip key={r.id} on={selectedRoles.includes(r.id)} onClick={() => toggleRole(r.id)}>
                  {selectedRoles.includes(r.id) && <Icon name="check" size="sm" />}{r.name}
                </FilterChip>
              ))}
            </div>
            {editingMember && isLastAdmin(editingMember, memberRows) && (
              <p className="muted small" role="note" style={{ marginTop: 8 }}>The last active administrator must keep the administrator role.</p>
            )}
          </div>
        </form>
      </Modal>

      {/* Invite: the person joins from the emailed link and sets their own password. */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a team member"
        sub="They receive a one-time link to join this firm and choose their own password."
        footer={<><Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={sendInvite}>Send invitation</Button></>}>
        <div className="stack">
          <div className="form-grid">
            <TextField label="Email" type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })}
              error={inviteTried ? inviteErrors.email || null : null} />
            <TextField label="Name" value={inv.fullName} onChange={(e) => setInv({ ...inv, fullName: e.target.value })} />
            {seniors.length > 0 && (
              <SelectField label="Practice" full value={inv.teamRootId} options={practiceOptions}
                onChange={(e) => setInv({ ...inv, teamRootId: e.target.value })} hint={practiceHint} />
            )}
          </div>
          <div>
            <div className="label" id="um-inv-roles-l" style={{ marginBottom: 8 }}>Roles <span className="req" aria-hidden="true">*</span></div>
            <div className="row wrap" role="group" aria-labelledby="um-inv-roles-l">
              {choices.map((r) => {
                const on = inv.roleIds.includes(r.id);
                return (
                  <FilterChip key={r.id} on={on}
                    onClick={() => setInv({ ...inv, roleIds: on ? inv.roleIds.filter((x) => x !== r.id) : [...inv.roleIds, r.id] })}>
                    {on && <Icon name="check" size="sm" />}{r.name}
                  </FilterChip>
                );
              })}
            </div>
            {!choices.length && <p className="muted small">This firm has no roles to assign yet. Create one under Roles & Permissions.</p>}
            {inviteTried && inviteErrors.roleIds && <span className="err" role="alert">{inviteErrors.roleIds}</span>}
          </div>
          <p className="faint small">Phone, Bar Council number and specialisation can be added with Edit once they have joined.</p>
        </div>
      </Modal>
    </div>
  );
}
