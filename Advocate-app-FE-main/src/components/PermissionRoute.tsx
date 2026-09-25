import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermission } from '../contexts/PermissionContext';

interface Props {
  children: ReactNode;
  permissions: string | string[];
  logical?: 'OR' | 'AND';
  fallback?: ReactNode;
}

export default function PermissionRoute({ children, permissions, logical = 'OR', fallback }: Props) {
  const { loading, hasAnyPermission, hasAllPermissions } = usePermission() as any;

  if (loading) return null;

  const list = Array.isArray(permissions) ? permissions : [permissions];
  const hasAccess = logical === 'AND' ? hasAllPermissions(...list) : hasAnyPermission(...list);

  if (!hasAccess) return <>{fallback || <Navigate to="/dashboard" replace />}</>;

  return <>{children}</>;
}
