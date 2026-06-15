import { Injectable } from '@angular/core';
import { User } from './user.model';
import { Settings } from './user.model';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  private users: User[] = [];

  private settingsAccess: Settings[] = [];

  constructor() {
    const storedUsers = localStorage.getItem('users');
    this.users = storedUsers ? JSON.parse(storedUsers) : [];
  }

  private saveUsers() {
    localStorage.setItem('users', JSON.stringify(this.users));
  }

  private balanceAccessSubject = new BehaviorSubject<boolean>(
    this.getInitialBalanceAccess()
  );

  balanceAccess$ = this.balanceAccessSubject.asObservable();

  private getInitialBalanceAccess(): boolean {
    const value = localStorage.getItem('balanceManagementAccess');

    if (value === null) {
      localStorage.setItem('balanceManagementAccess', 'true');
      return true;
    }

    return value === 'true';
  }

  balanceManagementAccess(access: boolean) {
    localStorage.setItem('balanceManagementAccess', access.toString());
    this.balanceAccessSubject.next(access);
  }

  getBalanceManagementAccess(): boolean {
    return this.balanceAccessSubject.value;
  }

  registerUser(user: User) {
    this.users.push(user);
    this.saveUsers();
  }

  getUsers(): User[] {
    return this.users;
  }

  getUserByEmail(email: string): User | undefined {
    return this.users.find(u => u.email === email);
  }

  updateAdminPassword(email: string, adminPassword: string) {
    const user = this.users.find(u => u.email === email);

    if (user) {
      user.adminPassword = adminPassword;
      this.saveUsers();

      localStorage.setItem('currentUser', JSON.stringify(user));
    }
  }

  getCurrentUser(): User | null {
    const currentUser = localStorage.getItem('currentUser');
    return currentUser ? JSON.parse(currentUser) : null;
  }

  removeAdminPassword(email: string) {
    const user = this.users.find(u => u.email === email);

    if (user) {
      user.adminPassword = '';

      this.saveUsers();

      // Update currentUser also
      localStorage.setItem(
        'currentUser',
        JSON.stringify(user)
      );
    }
  }

  validateAdminPassword(email: string, password: string): boolean {
    const user = this.users.find(u => u.email === email);

    return !!user && user.adminPassword === password;
  }

  setSettingsAccess(balanceUserAccess: boolean, balanceAdminAccess: boolean, expenseUserAccess: boolean, expenseAdminAccess: boolean, updatePermissionUser: boolean, updatePermissionAdmin: boolean, viewPermissionUser: boolean, viewPermissionAdmin: boolean, removePermissionUser: boolean, removePermissionAdmin: boolean) {
    const settings: Settings = {
      balanceUserAccess,
      balanceAdminAccess,
      expenseUserAccess,
      expenseAdminAccess,
      updatePermissionUser,
      updatePermissionAdmin,
      viewPermissionUser,
      viewPermissionAdmin,
      removePermissionUser,
      removePermissionAdmin
    };
    localStorage.setItem('settingsAccess', JSON.stringify(settings));
  }

  getSettingsAccess(): Settings {
    const defaultSettings: Settings = {
      balanceUserAccess: true,
      balanceAdminAccess: true,
      expenseUserAccess: true,
      expenseAdminAccess: true,
      updatePermissionUser: true,
      updatePermissionAdmin: true,
      viewPermissionUser: true,
      viewPermissionAdmin: true,
      removePermissionUser: true,
      removePermissionAdmin: true
    };

    const settings = localStorage.getItem('settingsAccess');

    if (!settings) {
      return defaultSettings;
    }

    return {
      ...defaultSettings,
      ...JSON.parse(settings)
    };
  }
}