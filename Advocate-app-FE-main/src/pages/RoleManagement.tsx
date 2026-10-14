// Roles & Permissions: a role decides what its people can see and change.
import { useEffect, useState } from "react";
import rbacService from "../services/rbacService";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext";
import { PageHead, Button, Chip, EmptyState, Skel, Icon } from "../ui/kit";
import { TextField } from "../ui/forms";
import { Modal, confirm } from "../ui/overlays";
import "../ui/pages/firm.css";

// High-risk permissions (who can do what, firm-wide reach, money) are marked
// by the server: /api/permissions sends `highRisk` (rbac/firm_roles.HIGH_RISK),
// and only a firm administrator may grant them.

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
  const [triedSave, setTriedSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [cloneOf, setCloneOf] = useState<any>(null);
  const [cloneName, setCloneName] = useState("");
  const [membersOf, setMembersOf] = useState<any>(null);
  const [members, setMembers] = useState<any[] | null>(null);
  const { hasPermission } = usePermission() as any;
  const { success, error } = useToast() as any;
  const canManage = hasPermission("ROLE_MANAGE");

  const loadData = async () => {
    try {
      const [r, p] = await Promise.all([rbacService.getAllRoles(), rbacService.getAllPermissions()]);
      setRoles(r);
      setPermissions(p);
      // Firm mode only: the system templates a firm can clone from.
      if (!r.some((x: any) => x.builtIn)) {
        rbacService.getRoleTemplates().then(setTemplates).catch(() => setTemplates([]));
      }
    } catch {
      error("Couldn't load roles and permissions.");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditingRole(null);
    setForm({ name: "", description: "" });
    setSelectedPerms([]);
    setPermsLoading(false);
    setLoadFailed(false);
    setTriedSave(false);
    setShowForm(true);
  };

  const openEdit = async (role: any) => {
    setEditingRole(role);
    setLoadFailed(false);
    setTriedSave(false);
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
    if (!form.name.trim()) { setTriedSave(true); error("Role name is required."); return; }
    // Never write a permission set we failed to read — that is the wipe.
    if (editingRole && (permsLoading || loadFailed)) {
      error(permsLoading ? "Still loading this role's permissions…"
                         : "Cannot save: this role's current permissions could not be loaded.");
      return;
    }
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (role: any) => {
    confirm({
      title: `Delete ${role.name}?`,
      message: "Delete this role? This cannot be undone.",
      danger: true,
      confirmLabel: "Delete role",
      accept: async () => {
        try {
          await rbacService.deleteRole(role.id);
          success("Role deleted.");
          loadData();
        } catch (err: any) {
          error(err.message || "Couldn't delete the role.");
        }
      },
    });
  };

  const openClone = (role: any) => { setCloneOf(role); setCloneName(`${role.name} (copy)`); };

  const handleClone = async () => {
    if (!cloneName.trim()) { error("Give the new role a name."); return; }
    setSaving(true);
    try {
      await rbacService.cloneRole(cloneOf.id, cloneName.trim());
      success(`Created ${cloneName.trim()}.`);
      setCloneOf(null);
      loadData();
    } catch (err: any) {
      error(err.message || "Couldn't copy the role.");
    } finally {
      setSaving(false);
    }
  };

  const openMembers = async (role: any) => {
    setMembersOf(role); setMembers(null);
    try { setMembers(await rbacService.getRoleMembers(role.id)); } catch { setMembers([]); error("Couldn't load who holds this role."); }
  };

  const toggleDisabled = (role: any) => {
    const disabling = !role.disabled;
    const run = async () => {
      try {
        await rbacService.updateRole(role.id, { name: role.name, description: role.description || "", disabled: disabling });
        success(disabling ? `${role.name} disabled.` : `${role.name} enabled.`);
        loadData();
      } catch (err: any) {
        error(err.message || "Couldn't change the role.");
      }
    };
    if (!disabling) { run(); return; }
    confirm({
      title: `Disable ${role.name}?`, danger: true, confirmLabel: "Disable role",
      message: `People holding it (${role.memberCount ?? 0}) lose its permissions until it is enabled again. It can't be assigned while disabled.`,
      accept: run,
    });
  };

  const togglePerm = (permId: any) => {
    setSelectedPerms((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  };

  // "Select all in module": on adds every permission in the module, off removes them.
  const toggleModule = (perms: any[], on: boolean) => {
    const ids = perms.map((p) => p.id);
    setSelectedPerms((prev) => (on ? [...new Set([...prev, ...ids])] : prev.filter((p) => !ids.includes(p))));
  };

  const groupedPerms = permissions.reduce((acc: Record<string, any[]>, p: any) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  if (!canManage) {
    return <EmptyState icon="lock" title="No access" text="You do not have permission to manage roles." />;
  }

  const readOnly = !!editingRole && !editingRole.editable;
  // Firm-level roles (server in firm mode): every listed role belongs to this
  // firm and can be edited; shared built-in roles (legacy mode) are read-only.
  const sharedRoles = roles.some((r) => r.builtIn);
  const saveBlocked = readOnly || (!!editingRole && (permsLoading || loadFailed));

  return (
    <div>
      <PageHead
        title="Roles & Permissions"
        sub="A role decides what its people can see and change. Edit a role and everyone in it is updated at once."
        actions={!loading && !sharedRoles ? <Button variant="primary" icon="plus" onClick={openCreate}>Create role</Button> : undefined}
      />
      {/* Legacy mode only: role rows are shared by every firm on the server, so
          built-in roles are read-only (rbac/views.py interim lock). In firm mode
          each firm owns its roles (rbac/firm_views.py). The server enforces both. */}
      {sharedRoles && (
        <p className="muted small" role="note" style={{ margin: "0 0 12px" }}>
          Built-in roles are shared by every firm on this server, so they can be assigned but not changed yet.
        </p>
      )}

      {loading ? (
        <div className="pp-role-grid">
          {[0, 1, 2].map((i) => <div key={i} className="panel pp-role"><Skel h={22} w="50%" /><Skel h={12} /><Skel h={12} w="70%" /></div>)}
        </div>
      ) : roles.length === 0 ? (
        <EmptyState icon="shield" title="No roles yet" text="Create a role, then assign it to team members." />
      ) : (
        <div className="pp-role-grid">
          {roles.map((role) => (
            <article key={role.id} className="panel pp-role">
              <div className="row between">
                <h3>{role.name}</h3>
                {role.builtIn && <Chip tone="tape">Built-in</Chip>}
                {role.isAdmin && <Chip tone="tape">Firm Administrator</Chip>}
                {role.disabled && <Chip>Disabled</Chip>}
              </div>
              <p className="muted small grow">{role.description || "No description"}</p>
              {role.memberCount !== undefined && (
                <button type="button" className="linkish small" onClick={() => openMembers(role)}>
                  {role.memberCount} {role.memberCount === 1 ? "person" : "people"}
                </button>
              )}
              <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 2 }}>
                {role.editable ? (
                  <>
                    <Button size="sm" icon="edit" onClick={() => openEdit(role)} aria-label={`Edit ${role.name}`}>Edit</Button>
                    {role.template === false && <Button size="sm" variant="ghost" onClick={() => openClone(role)} aria-label={`Copy ${role.name}`}>Copy</Button>}
                    <span className="grow" />
                    {role.template === false && !role.isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => toggleDisabled(role)}>{role.disabled ? "Enable" : "Disable"}</Button>
                    )}
                    {!role.isAdmin && <Button size="sm" variant="ghost" className="danger" icon="trash" onClick={() => handleDelete(role)} aria-label={`Delete ${role.name}`}>Delete</Button>}
                  </>
                ) : (
                  <Button size="sm" icon="eye" onClick={() => openEdit(role)} aria-label={`View ${role.name}`}
                    title="Built-in roles can't be changed yet">View</Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {templates.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 className="h3">System templates</h2>
          <p className="muted small">Standard roles provided with AMS. They can't be changed; copy one to start a role for your firm.</p>
          <div className="pp-role-grid">
            {templates.map((t) => (
              <article key={t.id} className="panel pp-role">
                <div className="row between"><h3>{t.name}</h3><Chip tone="info">Template</Chip></div>
                <p className="muted small grow">{t.description || "No description"}</p>
                <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 2 }}>
                  <Button size="sm" icon="eye" onClick={() => openEdit(t)}>View</Button>
                  <span className="grow" />
                  <Button size="sm" variant="primary" onClick={() => openClone(t)} aria-label={`Copy template ${t.name}`}>Use as a starting point</Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <Modal open={!!cloneOf} onClose={() => setCloneOf(null)} size="narrow" title={`Copy ${cloneOf?.name || ""}`}
        sub="The new role starts with the same permissions; change them afterwards."
        footer={<><Button variant="ghost" onClick={() => setCloneOf(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={saving || !cloneName.trim()} onClick={handleClone}>Create role</Button></>}>
        <TextField label="New role name" required value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
      </Modal>

      <Modal open={!!membersOf} onClose={() => setMembersOf(null)} size="narrow" title={`People with ${membersOf?.name || ""}`}>
        {members === null ? <Skel h={40} /> : members.length === 0 ? <p className="muted">Nobody holds this role.</p> : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {members.map((m) => <li key={m.id}><b>{m.fullName}</b> <span className="muted small">{m.email}</span></li>)}
          </ul>
        )}
      </Modal>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        size="xwide"
        title={readOnly ? editingRole.name : editingRole ? `Edit ${editingRole.name}` : "Create role"}
        sub={readOnly ? (editingRole?.template ? "System template: copy it to make a role you can change." : "Built-in role: shared by every firm, so it can't be changed yet.") : "Tick what people with this role can do. High-risk permissions are marked."}
        footer={<>
          <span className="faint xs grow" aria-live="polite">{selectedPerms.length} permissions selected</span>
          <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          {!readOnly && (
            <Button variant="primary" loading={saving} onClick={handleSave} disabled={saveBlocked || saving}>
              {editingRole ? "Save role" : "Create role"}
            </Button>
          )}
        </>}
      >
        <form className="stack" style={{ gap: 16 }} noValidate onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className="form-grid">
            <TextField label="Role name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={triedSave && !form.name.trim() ? "Give the role a name." : null} />
            <TextField label="Description" value={form.description} placeholder="What this role is for"
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {permsLoading && <p className="faint small">Loading this role's permissions…</p>}
          {loadFailed && (
            <div className="callout warn"><Icon name="warn" className="i" size="sm" />
              <div>Couldn't load this role's current permissions. Close and retry: saving now would overwrite them.</div>
            </div>
          )}
          <div className="table-wrap" hidden={permsLoading || loadFailed}>
            <table className="t pp-matrix">
              <thead><tr><th scope="col" style={{ width: 200 }}>Module</th><th scope="col">Permissions</th></tr></thead>
              <tbody>
                {Object.entries(groupedPerms).map(([module, perms]) => {
                  const list = perms as any[];
                  const n = list.filter((p) => selectedPerms.includes(p.id)).length;
                  return (
                    <tr key={module}>
                      <th scope="row" className="fm-mod">
                        <div className="fm-mod-name">{module}</div>
                        <label className="check xs" style={{ marginTop: 6 }}>
                          <input type="checkbox" checked={n === list.length && n > 0}
                            ref={(el) => { if (el) el.indeterminate = n > 0 && n < list.length; }}
                            onChange={(e) => toggleModule(list, e.target.checked)} />
                          Select all
                        </label>
                      </th>
                      <td>
                        <div className="perms">
                          {list.map((p) => (
                            <label key={p.id} className="check" title={p.description || p.name}>
                              <input type="checkbox" checked={selectedPerms.includes(p.id)} onChange={() => togglePerm(p.id)} />
                              <span>{p.description || p.name}<span className="mono faint xs fm-perm-code">{p.name}</span>
                                {p.highRisk && <Chip tone="bad" title="High risk: only a firm administrator can grant this">High risk</Chip>}</span>
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      </Modal>
    </div>
  );
}
