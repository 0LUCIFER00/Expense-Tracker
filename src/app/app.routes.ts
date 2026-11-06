import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { balanceGuard } from './balance.guard';
import { addMoneyGuard } from './add-money.guard';

/*
 * Every page past the login screen is loaded on demand.
 *
 * Only Login and Register are in the initial bundle, because they are all a
 * first-time visitor can reach; the rest arrive as separate chunks when their
 * route is first opened. Eagerly importing them all put the initial download
 * over its budget, and most of it is never needed on the page being visited.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () =>
      import('./login-page/login-page.component').then(m => m.LoginPageComponent)
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./register-page/register-page.component').then(m => m.RegisterPageComponent)
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'add-expense',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./add-expense/add-expense.component').then(m => m.AddExpenseComponent)
  },
  {
    path: 'transactions',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./expense-list/expense-list.component').then(m => m.ExpenseListComponent)
  },
  {
    path: 'budgets',
    canActivate: [authGuard],
    loadComponent: () => import('./budgets/budgets.component').then(m => m.BudgetsComponent)
  },
  {
    path: 'recurring',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./recurring/recurring.component').then(m => m.RecurringComponent)
  },
  // The page was View Expenses, which is now its Money out tab; keep old links
  // and bookmarks landing there.
  { path: 'view-expenses', redirectTo: '/transactions?tab=out' },
  {
    path: 'add-money',
    canActivate: [authGuard, addMoneyGuard],
    loadComponent: () =>
      import('./add-money/add-money.component').then(m => m.AddMoneyComponent)
  },
  {
    path: 'money',
    canActivate: [authGuard, balanceGuard],
    loadComponent: () => import('./bal-mnt/bal-mnt.component').then(m => m.BalMntComponent)
  },
  // The page was called Balance Management; keep its old address working.
  { path: 'bal-mnt', redirectTo: 'money' },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./profile/profile.component').then(m => m.ProfileComponent)
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./settings/settings.component').then(m => m.SettingsComponent)
  },
  {
    path: 'help_support',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./help-support/help-support.component').then(m => m.HelpSupportComponent)
  },
  { path: '**', redirectTo: 'login' }
];
