import { SettingsClient } from '@/components/settings-client.tsx';
import { fetchApiWithFallback } from '@/lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { data, unavailable } = await fetchApiWithFallback<{ vapidPublicKey: string; symbols: string[] }>('/settings', {
    vapidPublicKey: '',
    symbols: []
  });

  return (
    <SettingsClient
      apiUnavailable={unavailable}
      vapidPublicKey={String(data.vapidPublicKey ?? '')}
      symbols={data.symbols ?? []}
    />
  );
}
