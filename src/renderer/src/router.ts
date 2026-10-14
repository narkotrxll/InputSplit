import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from './views/DashboardView.vue'

// Hash history: the app is loaded from a file:// URL in production.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    {
      path: '/applications',
      name: 'applications',
      component: () => import('./views/ApplicationsView.vue'),
    },
    {
      path: '/controllers',
      name: 'controllers',
      component: () => import('./views/ControllersView.vue'),
    },
    { path: '/profiles', name: 'profiles', component: () => import('./views/ProfilesView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/about', name: 'about', component: () => import('./views/AboutView.vue') },
  ],
})
