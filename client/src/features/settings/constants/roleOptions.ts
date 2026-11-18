export interface RoleOption {
  value: string;
  label: string;
  description: string;
  permissions: string[];
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    value: 'owner',
    label: 'Owner',
    description: 'Full access to all settings and data',
    permissions: ['read', 'write', 'delete', 'manage_members', 'manage_settings', 'transfer_ownership'],
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Can manage members and most settings',
    permissions: ['read', 'write', 'delete', 'manage_members', 'manage_settings'],
  },
  {
    value: 'member',
    label: 'Member',
    description: 'Can view and add transactions',
    permissions: ['read', 'write'],
  },
  {
    value: 'view_only',
    label: 'Viewer',
    description: 'Read-only access to data',
    permissions: ['read'],
  },
];

export const getRoleLabel = (value: string): string => {
  const role = ROLE_OPTIONS.find(r => r.value === value);
  return role?.label ?? value;
};

export const getRoleDescription = (value: string): string => {
  const role = ROLE_OPTIONS.find(r => r.value === value);
  return role?.description ?? '';
};

export const hasPermission = (role: string, permission: string): boolean => {
  const roleOption = ROLE_OPTIONS.find(r => r.value === role);
  return roleOption?.permissions.includes(permission) ?? false;
};
