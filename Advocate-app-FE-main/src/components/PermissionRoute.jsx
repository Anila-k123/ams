import React from "react";
import { Navigate } from "react-router-dom";
import { usePermission } from "../contexts/PermissionContext";

export default function PermissionRoute({ children, permissions, logical = "OR", fallback }) {
  const { loading, hasPermission, hasAnyPermission, hasAllPermissions } = usePermission();

  if (loading) return null;

  const hasAccess =
    logical === "AND"
      ? hasAllPermissions(...(Array.isArray(permissions) ? permissions : [permissions]))
      : hasAnyPermission(...(Array.isArray(permissions) ? permissions : [permissions]));

  if (!hasAccess) {
    return fallback || <Navigate to="/dashboard" replace />;
  }

  return children;
}
