import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { UserService } from '../shared/user.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css'
})
export class LoginPageComponent implements OnInit {
  loginForm: FormGroup;
  successMessage: string = '';
  accessMessage: string = '';
  addBalanceUserAccess = true;
  addBalanceAdminAccess = true
  addExpenseUserAccess = true;
  addExpenseAdminAccess = true;
  private messageTimeout: any;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private userService: UserService
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      if (params['message']) {
        this.accessMessage = params['message'];

        if (this.messageTimeout) {
          clearTimeout(this.messageTimeout);
        }

        this.messageTimeout = setTimeout(() => {
          this.accessMessage = '';
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {}
          });
        }, 1000);
      }

      const settings = this.userService.getSettingsAccess();

      this.addBalanceUserAccess = settings.balanceUserAccess;
      this.addBalanceAdminAccess = settings.balanceAdminAccess;
      this.addExpenseUserAccess = settings.expenseUserAccess;
      this.addExpenseAdminAccess = settings.expenseAdminAccess;
    });
  }

onSubmit(): void {

  if(this.loginForm.invalid) {
  this.loginForm.markAllAsTouched();
  return;
}

const email = this.loginForm.value.email;
const password = this.loginForm.value.password;

const user = this.userService.getUserByEmail(email);

if (
  !user ||
  (user.password !== password &&
    user.adminPassword !== password)
) {
  this.accessMessage = 'Invalid email or password';
  return;
}

const isAdminLogin = user.adminPassword === password;
if (isAdminLogin || this.addBalanceUserAccess) {
  this.userService.balanceManagementAccess(true);
} else {
  this.userService.balanceManagementAccess(false);
}
localStorage.setItem(
  'loginType',
  isAdminLogin ? 'admin' : 'user'
);

localStorage.setItem(
  'currentUser',
  JSON.stringify(user)
);

this.authService.login();

this.successMessage =
  'Login successful! Redirecting to home...';

setTimeout(() => {
  this.router.navigate(['/home']);
}, 1000);
  }
}