'use client';

import { usePathname } from 'next/navigation';
import { useTransition } from 'react';

export function HeaderSignOutButton() {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  if (pathname === '/login') {
    return null;
  }

  return (
    <button
      className="secondary-button hero-signout"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await fetch('/api/auth/logout', {
            method: 'POST',
          });
          window.location.href = '/login';
        });
      }}
      type="button"
    >
      {isPending ? 'Signing Out...' : 'Sign Out'}
    </button>
  );
}
