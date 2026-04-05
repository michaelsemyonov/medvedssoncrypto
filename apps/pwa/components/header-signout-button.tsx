'use client';

import { Button } from 'antd';
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
    <Button
      className="hero-signout"
      icon={<SignOutIcon className="hero-link-icon" />}
      loading={isPending}
      onClick={() => {
        startTransition(async () => {
          await fetch('/api/auth/logout', {
            method: 'POST',
          });
          window.location.href = '/login';
        });
      }}
      type="default"
    >
      {isPending ? 'Signing Out...' : 'Sign Out'}
    </Button>
  );
}
