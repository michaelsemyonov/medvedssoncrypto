import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE_NAME, verifySessionToken } from '@medvedsson/shared';

const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

const getSessionSecret = (): string => {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error('SESSION_SECRET is required for the PWA.');
  }

  return secret;
};

export const getApiBaseUrl = (): string => apiBaseUrl.replace(/\/$/, '');

export const getSessionToken = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
};

export const requireSession = async (): Promise<string> => {
  const token = await getSessionToken();

  if (!token || !verifySessionToken(token, getSessionSecret())) {
    redirect('/login');
  }

  return token;
};

export const fetchApi = async <T>(path: string): Promise<T> => {
  const token = await requireSession();
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    redirect('/login');
  }

  if (!response.ok) {
    throw new Error(`API request failed for ${path}: ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const fetchApiSafe = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return await fetchApi<T>(path);
  } catch {
    return fallback;
  }
};
