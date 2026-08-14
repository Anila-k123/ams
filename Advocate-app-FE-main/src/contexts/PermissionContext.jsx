import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import rbacService from "../services/rbacService";

const PermissionContext = createContext(null);

export function PermissionProvider({ children }) {
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
    const token = localStorage.getItem("token");
    if (token) fetchPermissions();
    else setLoading(false);
  }, [fetchPermissions]);

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
