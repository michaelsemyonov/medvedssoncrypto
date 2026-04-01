import { NextResponse } from 'next/server';

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

export async function POST(request: Request) {
  const { adminPassword, sessionSecret, sessionTtlHours } = getAuthConfig();
  const formData = await request.formData();
  const passwordValue = formData.get('password');
  const password = typeof passwordValue === 'string' ? passwordValue : '';

  if (password !== adminPassword) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: '/login?error=invalid'
      }
    });
  }

  const token = createSessionToken(sessionSecret, sessionTtlHours);
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      location: '/'
    }
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionTtlHours * 60 * 60
  });

  return response;
}
