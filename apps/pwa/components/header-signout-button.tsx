'use client';

import { usePathname } from 'next/navigation';
import { useTransition } from 'react';

import { SignOutIcon } from '@/components/header-icons.tsx';

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
      <span className="hero-link-content">
        <SignOutIcon className="hero-link-icon" />
        <span>{isPending ? 'Signing Out...' : 'Sign Out'}</span>
      </span>
    </button>
  );
}
