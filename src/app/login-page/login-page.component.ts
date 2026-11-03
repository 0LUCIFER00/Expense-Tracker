import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth.service';
import { SettingsService } from '../shared/settings.service';
import { ApiError } from '../shared/api.service';
import { ToastService } from '../shared/toast.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.css', './login-page.component.dark.css']
})
export class LoginPageComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  submitting = false;

  private readonly subscriptions = new Subscription();

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.queryParams.subscribe(params => {
        if (!params['message']) {
          return;
        }

        this.toast.error(params['message']);

        // Dropped from the address straight away, so a refresh does not
        // announce it a second time.
        this.router.navigate([], { relativeTo: this.route, queryParams: {} });
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  onSubmit(): void {
    if (this.loginForm.invalid || this.submitting) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { email, password } = this.loginForm.value;

    this.submitting = true;

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
        this.toast.error(error.message);
      }
    });
  }

  private goHome(): void {
    this.submitting = false;
    this.toast.success('Signed in.');
    this.router.navigate(['/home']);
  }
}
