
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../auth.service';
import { SettingsService } from '../shared/settings.service';
import { PASSWORD_MIN, Settings } from '../shared/models';
import { WhatsappService, WhatsappLinkStatus } from '../shared/whatsapp.service';
import { ToastService } from '../shared/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly settingsService = inject(SettingsService);
  private readonly whatsapp = inject(WhatsappService);
  private readonly toast = inject(ToastService);

  addExpenseUserAccess = true;

  addBalanceUserAccess = true;

  addMoneyUserAccess = true;

  whatsappBalanceUserAccess = true;

  updatePermissionUser = true;

  viewPermissionUser = true;

  removePermissionUser = true;

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

  /** For the template: the Create button waits for a long enough password. */
  readonly passwordMin = PASSWORD_MIN;
  confirmPassword = '';
  adminCancelPassword = '';
  cancelPasswordError = '';
  setPasswordError = '';

  // --- WhatsApp linking ---
  whatsappStatus: WhatsappLinkStatus | null = null;
  whatsappCode = '';
  whatsappCodeMinutes = 0;
  whatsappChatUrl: string | null = null;
  whatsappBusinessNumber: string | null = null;
  whatsappBusy = false;

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
        this.toast.error(error.message);
      }
    });
  }

  onConnectWhatsapp(): void {
    this.whatsappBusy = true;

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
        this.toast.error(error.message);
      }
    });
  }

  onRefreshWhatsapp(): void {
    this.loadWhatsappStatus();
  }

  onDisconnectWhatsapp(): void {
    this.whatsappBusy = true;

    this.whatsapp.disconnect().subscribe({
      next: () => {
        this.whatsappBusy = false;
        this.whatsappCode = '';
        this.toast.success('WhatsApp disconnected.');
        this.loadWhatsappStatus();
      },
      error: error => {
        this.whatsappBusy = false;
        this.toast.error(error.message);
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
        this.toast.error(error.message);
      }
    });
  }

  private applySettings(settings: Settings): void {
    this.addBalanceUserAccess = settings.balanceUserAccess;
    this.addMoneyUserAccess = settings.addMoneyUserAccess;
    this.whatsappBalanceUserAccess = settings.whatsappBalanceUserAccess;
    this.addExpenseUserAccess = settings.expenseUserAccess;
    this.updatePermissionUser = settings.updatePermissionUser;
    this.viewPermissionUser = settings.viewPermissionUser;
    this.removePermissionUser = settings.removePermissionUser;
  }

  onAccessChange(): void {
    this.settingsService
      .update({
        balanceUserAccess: this.addBalanceUserAccess,
        addMoneyUserAccess: this.addMoneyUserAccess,
        whatsappBalanceUserAccess: this.whatsappBalanceUserAccess,
        expenseUserAccess: this.addExpenseUserAccess,
        updatePermissionUser: this.updatePermissionUser,
        viewPermissionUser: this.viewPermissionUser,
        removePermissionUser: this.removePermissionUser
      })
      .subscribe({
        next: settings => {
          this.applySettings(settings);
          this.toast.success('Permissions updated.');
        },
        error: error => {
          this.toast.error(error.message);
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
        this.toast.success('Full access removed. Every permission is granted again.');
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
        this.toast.success('Full access created. Sign in with it to manage permissions.');
        this.loadSettingsPage();
      },
      error: error => {
        this.setPasswordError = error.message;
      }
    });
  }
}
