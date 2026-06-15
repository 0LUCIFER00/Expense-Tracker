import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UserService } from '../shared/user.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent {

  addExpenseUserAccess = true;
  addExpenseAdminAccess = true;

  addBalanceUserAccess = true;
  addBalanceAdminAccess = true;

  updatePermissionUser = true;
  updatePermissionAdmin = true;

  viewPermissionUser = true;
  viewPermissionAdmin = true;

  removePermissionUser = true;
  removePermissionAdmin = true;

  isEnabled = false;
  showPopup = false;
  showChancelPopup = false;

  hasAdminPassword = false;

  loginType = '';
  currentUserName = '';
  constructor(private router: Router, private userService: UserService) { }
  
ngOnInit() {
  this.loadSettingsPage();
  this.loginType = localStorage.getItem('loginType') || '';
}

loadSettingsPage() {
  const currentUser = this.userService.getCurrentUser();

  this.hasAdminPassword = !!currentUser?.adminPassword;
  this.isEnabled = this.hasAdminPassword;

  if (currentUser) {
    this.currentUserName = currentUser.name;
  }

  const settings = this.userService.getSettingsAccess();

  this.addBalanceUserAccess = settings.balanceUserAccess;
  this.addBalanceAdminAccess = settings.balanceAdminAccess;
  this.addExpenseUserAccess = settings.expenseUserAccess;
  this.addExpenseAdminAccess = settings.expenseAdminAccess;
  this.updatePermissionUser = settings.updatePermissionUser;
  this.updatePermissionAdmin = settings.updatePermissionAdmin;
  this.viewPermissionUser = settings.viewPermissionUser;
  this.viewPermissionAdmin = settings.viewPermissionAdmin;
  this.removePermissionUser = settings.removePermissionUser;
  this.removePermissionAdmin = settings.removePermissionAdmin
}

onAccessChange() {
  this.userService.setSettingsAccess(
    this.addBalanceUserAccess,
    this.addBalanceAdminAccess,
    this.addExpenseUserAccess,
    this.addExpenseAdminAccess,
    this.updatePermissionUser,
    this.updatePermissionAdmin,
    this.viewPermissionUser,
    this.viewPermissionAdmin,
    this.removePermissionUser,
    this.removePermissionAdmin
  );
  if(this.addBalanceUserAccess === false && this.loginType === 'user'){
    this.userService.balanceManagementAccess(false);
  } else if(this.addBalanceUserAccess === true && this.loginType === 'user'){
    this.userService.balanceManagementAccess(true);
  }
}


  adminPassword = '';
  confirmPassword = '';
  adminCancelPassword = '';

  onToggleChange() {
    if (this.isEnabled) {
      this.showPopup = true;
    } else if (!this.isEnabled) {
      this.showChancelPopup = true;
    } else {
      this.showPopup = false;
    }
  }
  onCancelCancel() {
    this.showChancelPopup = false;
    this.isEnabled = true;
  }

  onOkCancel() {
  const currentUser = this.userService.getCurrentUser();

  if (!currentUser) {
    return;
  }

  const isValid = this.userService.validateAdminPassword(
    currentUser.email,
    this.adminCancelPassword
  );

  if (!isValid) {
    alert('Invalid Admin Password');
    return;
  }

  this.userService.removeAdminPassword(currentUser.email);

  this.showChancelPopup = false;
  this.adminCancelPassword = '';

  this.loadSettingsPage();
}
  onCancel() {
    this.showPopup = false;
    this.isEnabled = false;
    this.adminPassword = '';
    this.confirmPassword = '';
  }

  onOk() {
  if (this.adminPassword === this.confirmPassword) {

    const currentUser = this.userService.getCurrentUser();

    if (currentUser) {
      this.userService.updateAdminPassword(
        currentUser.email,
        this.adminPassword
      );
    }
    this.showPopup = false;
    this.adminPassword = '';
    this.confirmPassword = '';

    this.loadSettingsPage();
  }
}
}