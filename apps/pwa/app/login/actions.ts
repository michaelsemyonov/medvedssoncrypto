'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSessionToken, SESSION_COOKIE_NAME } from '@medvedsson/shared';

const getAuthConfig = () => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS ?? 168);

  if (!adminPassword || !sessionSecret) {
    throw new Error('ADMIN_PASSWORD and SESSION_SECRET are required for login.');
  }

  return {
    adminPassword,
    sessionSecret,
    sessionTtlHours
  };
};

export const loginAction = async (formData: FormData): Promise<void> => {
  const { adminPassword, sessionSecret, sessionTtlHours } = getAuthConfig();
  const passwordValue = formData.get('password');
  const password = typeof passwordValue === 'string' ? passwordValue : '';

  if (password !== adminPassword) {
    redirect('/login?error=invalid');
  }

  const cookieStore = await cookies();
  const token = createSessionToken(sessionSecret, sessionTtlHours);

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionTtlHours * 60 * 60
  });

  redirect('/');
};
