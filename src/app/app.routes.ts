import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { AddExpenseComponent } from './add-expense/add-expense.component';
import { ExpenseListComponent } from './expense-list/expense-list.component';

export const routes: Routes = [
    {
        path: '',
        component: HomeComponent,
    },
    {
        path: 'home',
        redirectTo: ''
    },
    {
        path: 'add-expense',
        component: AddExpenseComponent,
    },
    {
        path: 'view-expenses',
        component: ExpenseListComponent,
    },
    {
        path: '**',
        redirectTo: '',
    }
];
