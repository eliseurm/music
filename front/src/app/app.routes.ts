// app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./page/home/home-page.component').then(m => m.HomePageComponent)
  },
  {
    path: 'music',
    loadComponent: () => import('./page/music/music-page.component').then(m => m.MusicPageComponent)
  },
  {
    path: 'rachasocial',
    loadComponent: () => import('./page/racha-social/racha-social-page.component').then(m => m.RachaSocialPageComponent)
  }
];
