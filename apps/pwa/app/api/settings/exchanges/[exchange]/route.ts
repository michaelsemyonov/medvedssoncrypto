import { type NextRequest } from 'next/server';

import { proxyJson } from '../_helpers.ts';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ exchange: string }> }
) {
  const { exchange } = await params;
  const body: unknown = await request.json();

  return proxyJson(request, {
    method: 'PUT',
    path: `/exchange-accounts/${exchange}`,
    body,
  });
}
