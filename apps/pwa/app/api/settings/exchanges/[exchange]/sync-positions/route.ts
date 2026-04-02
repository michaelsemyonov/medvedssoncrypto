import { type NextRequest } from 'next/server';

import { proxyJson } from '../../_helpers.ts';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ exchange: string }> }
) {
  const { exchange } = await params;

  return proxyJson(request, {
    method: 'POST',
    path: `/exchange-accounts/${exchange}/sync-positions`,
  });
}
