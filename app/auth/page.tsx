/**
 * PANDORA / ForenX - Auth Entry Page
 * 
 * Redirect entry point for /auth route.
 * Redirects to /auth/login to maintain URL structure.
 */

import { redirect } from 'next/navigation';

export default function AuthPage() {
  redirect('/auth/login');
}
