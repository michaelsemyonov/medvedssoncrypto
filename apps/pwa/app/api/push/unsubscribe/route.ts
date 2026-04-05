import { type NextRequest } from 'next/server';

import { verifySessionToken, SESSION_COOKIE_NAME } from '@medvedsson/shared';
import { resolveApiBaseUrl } from '@/lib/api-base-url.ts';

const getApiBaseUrl = (): string => resolveApiBaseUrl();

const getSessionSecret = (): string => {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error('SESSION_SECRET is required for the PWA.');
  }

  return secret;
};

const getAuthorizedToken = (request: NextRequest): string | null => {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  if (!token) {
    return null;
  }

  return verifySessionToken(token, getSessionSecret()) ? token : null;
};

export async function POST(request: NextRequest) {
  const token = getAuthorizedToken(request);

  if (!token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await request.json();
  const response = await fetch(`${getApiBaseUrl()}/push/unsubscribe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const payload = await response.text();

  return new Response(payload, {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
    },
  });
}
