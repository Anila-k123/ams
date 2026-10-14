import { createContext, useContext, useState, useEffect, useCallback } from "react";
import rbacService from "../services/rbacService";
import { useAuth } from "../context/AuthContext";

const PermissionContext = createContext(null);

export function PermissionProvider({ children }) {
  const { token } = useAuth();
  const [permissions, setPermissions] = useState(new Set());
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    try {
      const [perms, userRoles] = await Promise.all([
        rbacService.getMyPermissions(),
        rbacService.getMyRoles(),
      ]);
      setPermissions(new Set(perms || []));
      setRoles(userRoles || []);
    } catch (err) {
      console.error("Failed to fetch permissions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) { setLoading(true); fetchPermissions(); }
    else { setPermissions(new Set()); setRoles([]); setLoading(false); }
  }, [token, fetchPermissions]);

  // api/client.ts signals a 403: a role may have been removed. Re-read, at most
  // every few seconds, so menus and buttons follow what the server allows.
  useEffect(() => {
    if (!token) return undefined;
    let last = 0;
    const onStale = () => {
      if (Date.now() - last < 5000) return;
      last = Date.now();
      fetchPermissions();
    };
    window.addEventListener("ams:permissions-stale", onStale);
    return () => window.removeEventListener("ams:permissions-stale", onStale);
  }, [token, fetchPermissions]);

  const hasPermission = useCallback(
    (perm) => permissions.has(perm),
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (...perms) => perms.some((p) => permissions.has(p)),
    [permissions]
  );

  const hasAllPermissions = useCallback(
    (...perms) => perms.every((p) => permissions.has(p)),
    [permissions]
  );

  const hasRole = useCallback(
    (roleName) => roles.includes(roleName),
    [roles]
  );

  return (
    <PermissionContext.Provider
      value={{
        permissions: [...permissions],
        roles,
        loading,
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        hasRole,
        refresh: fetchPermissions,
      }}
    >
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermission() {
  const ctx = useContext(PermissionContext);
  if (!ctx) throw new Error("usePermission must be used within PermissionProvider");
  return ctx;
}

export default PermissionContext;
