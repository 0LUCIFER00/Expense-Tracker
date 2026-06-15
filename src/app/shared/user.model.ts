export interface User {
  name: string;
  email: string;
  password: string;
  adminPassword?: string;
}

export interface Settings {
  balanceUserAccess: boolean;
  balanceAdminAccess: boolean;
  expenseUserAccess: boolean;
  expenseAdminAccess: boolean;
  updatePermissionUser: boolean;
  updatePermissionAdmin: boolean;
  viewPermissionUser: boolean;
  viewPermissionAdmin: boolean;
  removePermissionUser: boolean;
  removePermissionAdmin: boolean;
}