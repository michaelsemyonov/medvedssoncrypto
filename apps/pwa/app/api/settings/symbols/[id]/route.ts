import { type NextRequest } from 'next/server';

import { verifySessionToken, SESSION_COOKIE_NAME } from '@medvedsson/shared';

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

const getAuthorizedToken = (request: NextRequest): string | null => {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  if (!token) {
    return null;
  }

  return verifySessionToken(token, getSessionSecret()) ? token : null;
};

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getAuthorizedToken(request);

  if (!token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body: unknown = await request.json();
  const response = await fetch(`${getApiBaseUrl()}/symbols/${id}`, {
    method: 'PUT',
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
