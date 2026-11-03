import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { SettingsService } from '../shared/settings.service';
import { ToastService } from '../shared/toast.service';
import { ApiError } from '../shared/api.service';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.component.html',
  styleUrls: ['./register-page.component.css', './register-page.component.dark.css']
})
export class RegisterPageComponent implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);

  registerForm: FormGroup = this.fb.group(
    {
      name: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      adminPassword: ['']
    },
    { validators: this.passwordMatchValidator() }
  );


  submitting = false;

  private redirectTimeout: ReturnType<typeof setTimeout> | undefined;

  ngOnDestroy(): void {
    clearTimeout(this.redirectTimeout);
  }

  passwordMatchValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const password = control.get('password')?.value;
      const confirmPassword = control.get('confirmPassword')?.value;

      return password === confirmPassword ? null : { passwordMismatch: true };
    };
  }

  onSubmit(): void {
    if (this.registerForm.invalid || this.submitting) {
      this.registerForm.markAllAsTouched();
      return;
    }

    const { name, email, password, adminPassword } = this.registerForm.value;

    this.submitting = true;

    this.authService
      .register({ name, email, password, adminPassword: adminPassword || undefined })
      .subscribe({
        next: () => {
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
    this.toast.success('Welcome. Your account is ready.');

    this.redirectTimeout = setTimeout(() => {
      this.router.navigate(['/home']);
    }, 1000);
  }
}
