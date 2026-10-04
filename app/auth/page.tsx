/**
 * PANDORA / ForenX - Auth Entry Page
 *
 * Redirect entry point for /auth route.
 * Redirects to /auth/login while preserving the safe redirect target.
 */

import { validateRedirectTarget } from '@/lib/auth/redirect';
import { redirect } from 'next/navigation';

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawNext = typeof params?.next === 'string' ? params.next : undefined;
  const safeNext = validateRedirectTarget(rawNext);

  if (safeNext) {
    redirect(`/auth/login/?next=${encodeURIComponent(safeNext)}`);
  }

  redirect('/auth/login/');
}
