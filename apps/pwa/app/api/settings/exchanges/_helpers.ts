import { type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, verifySessionToken } from '@medvedsson/shared';
import { resolveApiBaseUrl } from '@/lib/api-base-url.ts';

const getApiBaseUrl = (): string => resolveApiBaseUrl();

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
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  };

  if (options.body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] =
      'application/json';
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
