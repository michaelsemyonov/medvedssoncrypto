import { type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, verifySessionToken } from '@medvedsson/shared';

const getApiBaseUrl = (): string =>
  (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');

const getSessionSecret = (): string => {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error('SESSION_SECRET is required for the PWA.');
  }

  return secret;
};

export const getAuthorizedToken = (request: NextRequest): string | null => {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  if (!token) {
    return null;
  }

  return verifySessionToken(token, getSessionSecret()) ? token : null;
};

export const proxyJson = async (
  request: NextRequest,
  options: {
    method: 'PUT' | 'POST';
    path: string;
    body?: unknown;
  }
) => {
  const token = getAuthorizedToken(request);

  if (!token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const init: RequestInit = {
    method: options.method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${getApiBaseUrl()}${options.path}`, init);

  const payload = await response.text();

  return new Response(payload, {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
    },
  });
};
