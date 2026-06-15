import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { NgIf } from '@angular/common';
import { UserService } from '../shared/user.service';
import {
  ElementRef,
  HostListener,
  ViewChild
} from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, NgIf],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent {

  showBalanceManagement = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private userService: UserService
  ) { }

  ngOnInit(): void {
    this.userService.balanceAccess$.subscribe(access => {
      this.showBalanceManagement = access;
    });
  }

  @ViewChild('profileMenu')
  profileMenu!: ElementRef;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {

    if (
      this.showProfileMenu &&
      !this.profileMenu.nativeElement.contains(event.target)
    ) {
      this.showProfileMenu = false;
    }

  }
  showProfileMenu = false;

  toggleProfileMenu() {
    this.showProfileMenu = !this.showProfileMenu;
  }

  closeProfileMenu() {
    this.showProfileMenu = false;
  }
  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}