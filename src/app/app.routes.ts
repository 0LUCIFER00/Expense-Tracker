import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { AddExpenseComponent } from './add-expense/add-expense.component';
import { ExpenseListComponent } from './expense-list/expense-list.component';
import { LoginPageComponent } from './login-page/login-page.component';
import { RegisterPageComponent } from './register-page/register-page.component';
import { authGuard } from './auth.guard';
import { BalMntComponent } from './bal-mnt/bal-mnt.component';
import { ProfileComponent } from './profile/profile.component';
import { SettingsComponent } from './settings/settings.component';
import { HelpSupportComponent } from './help-support/help-support.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginPageComponent },
  { path: 'register', component: RegisterPageComponent },
  { path: 'home', component: HomeComponent, canActivate: [authGuard] },
  { path: 'add-expense', component: AddExpenseComponent, canActivate: [authGuard] },
  { path: 'view-expenses', component: ExpenseListComponent, canActivate: [authGuard] },
  { path: 'bal-mnt', component: BalMntComponent, canActivate: [authGuard] },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'settings', component: SettingsComponent, canActivate: [authGuard] },
  { path: 'help_support', component: HelpSupportComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'login' }
];