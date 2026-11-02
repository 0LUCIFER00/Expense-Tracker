import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth.service';
import { SettingsService } from '../shared/settings.service';
import { Settings } from '../shared/models';
import { WhatsappService, WhatsappLinkStatus } from '../shared/whatsapp.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css', './settings.component.dark.css']
})
export class SettingsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly settingsService = inject(SettingsService);
  private readonly whatsapp = inject(WhatsappService);

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

  /** Only an admin session may see or change the permission matrix. */
  get isAdminSession(): boolean {
    return this.loginType === 'admin';
  }

  adminPassword = '';
  confirmPassword = '';
  adminCancelPassword = '';
  cancelPasswordError = '';
  setPasswordError = '';
  errorMessage = '';

  // --- WhatsApp linking ---
  whatsappStatus: WhatsappLinkStatus | null = null;
  whatsappCode = '';
  whatsappCodeMinutes = 0;
  whatsappChatUrl: string | null = null;
  whatsappBusinessNumber: string | null = null;
  whatsappBusy = false;
  whatsappError = '';

  ngOnInit(): void {
    this.loadSettingsPage();
    this.loadWhatsappStatus();
  }

  private loadWhatsappStatus(): void {
    this.whatsapp.status().subscribe({
      next: status => {
        this.whatsappStatus = status;
        this.whatsappBusinessNumber = status.businessNumber;

        // A freshly connected number makes the pending code irrelevant.
        if (status.connected) {
          this.whatsappCode = '';
          this.whatsappChatUrl = null;
        }
      },
      error: error => {
        this.whatsappError = error.message;
      }
    });
  }

  onConnectWhatsapp(): void {
    this.whatsappBusy = true;
    this.whatsappError = '';

    this.whatsapp.requestCode().subscribe({
      next: result => {
        this.whatsappCode = result.code;
        this.whatsappCodeMinutes = result.expiresInMinutes;
        this.whatsappChatUrl = result.chatUrl;
        this.whatsappBusinessNumber = result.businessNumber;
        this.whatsappBusy = false;
      },
      error: error => {
        this.whatsappBusy = false;
        this.whatsappError = error.message;
      }
    });
  }

  onRefreshWhatsapp(): void {
    this.loadWhatsappStatus();
  }

  onDisconnectWhatsapp(): void {
    this.whatsappBusy = true;
    this.whatsappError = '';

    this.whatsapp.disconnect().subscribe({
      next: () => {
        this.whatsappBusy = false;
        this.whatsappCode = '';
        this.loadWhatsappStatus();
      },
      error: error => {
        this.whatsappBusy = false;
        this.whatsappError = error.message;
      }
    });
  }

  loadSettingsPage(): void {
    this.loginType = this.auth.loginType;

    this.auth.ensureSession().subscribe(session => {
      this.hasAdminPassword = Boolean(session?.user.hasAdminPassword);
      this.isEnabled = this.hasAdminPassword;
      this.currentUserName = session?.user.name ?? '';
      this.loginType = session?.loginType ?? 'user';
    });

    this.settingsService.load(true).subscribe({
      next: settings => this.applySettings(settings),
      error: error => {
        this.errorMessage = error.message;
      }
    });
  }

  private applySettings(settings: Settings): void {
    this.addBalanceUserAccess = settings.balanceUserAccess;
    this.addBalanceAdminAccess = settings.balanceAdminAccess;
    this.addExpenseUserAccess = settings.expenseUserAccess;
    this.addExpenseAdminAccess = settings.expenseAdminAccess;
    this.updatePermissionUser = settings.updatePermissionUser;
    this.updatePermissionAdmin = settings.updatePermissionAdmin;
    this.viewPermissionUser = settings.viewPermissionUser;
    this.viewPermissionAdmin = settings.viewPermissionAdmin;
    this.removePermissionUser = settings.removePermissionUser;
    this.removePermissionAdmin = settings.removePermissionAdmin;
  }

  onAccessChange(): void {
    this.errorMessage = '';

    this.settingsService
      .update({
        balanceUserAccess: this.addBalanceUserAccess,
        balanceAdminAccess: this.addBalanceAdminAccess,
        expenseUserAccess: this.addExpenseUserAccess,
        expenseAdminAccess: this.addExpenseAdminAccess,
        updatePermissionUser: this.updatePermissionUser,
        updatePermissionAdmin: this.updatePermissionAdmin,
        viewPermissionUser: this.viewPermissionUser,
        viewPermissionAdmin: this.viewPermissionAdmin,
        removePermissionUser: this.removePermissionUser,
        removePermissionAdmin: this.removePermissionAdmin
      })
      .subscribe({
        next: settings => this.applySettings(settings),
        error: error => {
          this.errorMessage = error.message;
          // Put the toggles back to whatever the server still believes.
          this.settingsService.load(true).subscribe(current => this.applySettings(current));
        }
      });
  }

  onToggleChange(): void {
    if (this.isEnabled) {
      this.setPasswordError = '';
      this.showPopup = true;
    } else {
      this.cancelPasswordError = '';
      this.showChancelPopup = true;
    }
  }

  onCancelCancel(): void {
    this.showChancelPopup = false;
    this.adminCancelPassword = '';
    this.cancelPasswordError = '';
    this.isEnabled = true;
  }

  onOkCancel(): void {
    this.auth.removeAdminPassword(this.adminCancelPassword).subscribe({
      next: () => {
        this.showChancelPopup = false;
        this.adminCancelPassword = '';
        this.cancelPasswordError = '';

        // The server resets every permission to granted when the last admin
        // password goes, so pull the fresh values rather than showing stale ones.
        this.settingsService.reset();
        this.loadSettingsPage();
      },
      error: error => {
        this.cancelPasswordError = error.message;
      }
    });
  }

  onCancel(): void {
    this.showPopup = false;
    this.isEnabled = false;
    this.adminPassword = '';
    this.confirmPassword = '';
    this.setPasswordError = '';
  }

  onOk(): void {
    if (this.adminPassword !== this.confirmPassword) {
      return;
    }

    this.auth.setAdminPassword(this.adminPassword).subscribe({
      next: () => {
        this.showPopup = false;
        this.adminPassword = '';
        this.confirmPassword = '';
        this.setPasswordError = '';
        this.loadSettingsPage();
      },
      error: error => {
        this.setPasswordError = error.message;
      }
    });
  }
}
