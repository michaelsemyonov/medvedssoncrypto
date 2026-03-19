import { SettingsClient } from '../../components/settings-client.tsx';
import { fetchApi } from '../../lib/api.ts';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const data = await fetchApi<{ vapidPublicKey: string; symbols: string[] }>('/settings');

  return (
    <SettingsClient
      vapidPublicKey={String(data.vapidPublicKey ?? '')}
      symbols={data.symbols ?? []}
    />
  );
}
