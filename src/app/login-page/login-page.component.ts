import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth.service';
import { SettingsService } from '../shared/settings.service';
import { ApiError } from '../shared/api.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css'
})
export class LoginPageComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly settingsService = inject(SettingsService);

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  successMessage = '';
  accessMessage = '';
  submitting = false;

  private messageTimeout: ReturnType<typeof setTimeout> | undefined;
  private redirectTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions = new Subscription();

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.queryParams.subscribe(params => {
        if (!params['message']) {
          return;
        }

        this.accessMessage = params['message'];

        clearTimeout(this.messageTimeout);

        this.messageTimeout = setTimeout(() => {
          this.accessMessage = '';
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {}
          });
        }, 1000);
      })
    );
  }

  ngOnDestroy(): void {
    clearTimeout(this.messageTimeout);
    clearTimeout(this.redirectTimeout);
    this.subscriptions.unsubscribe();
  }

  onSubmit(): void {
    if (this.loginForm.invalid || this.submitting) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { email, password } = this.loginForm.value;

    this.submitting = true;
    this.accessMessage = '';

    this.authService.login(email, password).subscribe({
      next: () => {
        // Pull the permission matrix in before leaving, so the header renders
        // the right links on arrival.
        this.settingsService.load(true).subscribe({
          next: () => this.goHome(),
          error: () => this.goHome()
        });
      },
      error: (error: ApiError) => {
        this.submitting = false;
        this.accessMessage = error.message;
      }
    });
  }

  private goHome(): void {
    this.submitting = false;
    this.successMessage = 'Login successful! Redirecting to home...';

    this.redirectTimeout = setTimeout(() => {
      this.router.navigate(['/home']);
    }, 1000);
  }
}
