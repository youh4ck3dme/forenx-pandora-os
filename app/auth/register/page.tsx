/**
 * PANDORA / ForenX - Registration Redirect
 *
 * Registrácia je zjednotená do jedinej autentifikačnej brány cez Supabase Auth.
 * Táto trasa presmerováva na /auth/login/ v režime vytvorenia účtu (mode=signup).
 */

import { redirect } from 'next/navigation';
import { validateRedirectTarget } from '@/lib/auth/redirect';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawNext = typeof params?.next === 'string' ? params.next : undefined;
  const safeNext = validateRedirectTarget(rawNext);

  if (safeNext) {
    redirect(`/auth/login/?mode=signup&next=${encodeURIComponent(safeNext)}`);
  }

  redirect('/auth/login/?mode=signup');
}
