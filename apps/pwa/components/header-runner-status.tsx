import { Space } from 'antd';

import { formatDateTime } from '@/lib/datetime.ts';
import { getApiBaseUrl, getSessionToken } from '@/lib/api.ts';
import { StatusTag } from '@/components/ui-primitives.tsx';

type RunnerStatusResponse = {
  runner: {
    running: boolean;
    lastTickCompletedAt: string | null;
    lastError: string | null;
  };
};

export async function HeaderRunnerStatus() {
  const token = await getSessionToken();

  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/runner-status`, {
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as RunnerStatusResponse;
    const lastTick = data.runner.lastTickCompletedAt
      ? formatDateTime(data.runner.lastTickCompletedAt)
      : 'not yet completed';

    return (
      <Space aria-live="polite" className="hero-status" size={10}>
        <StatusTag tone={data.runner.running ? 'success' : 'danger'}>
          {data.runner.running ? 'Live' : 'Stopped'}
        </StatusTag>
        <span className="hero-status-text">Last tick {lastTick}</span>
      </Space>
    );
  } catch {
    return null;
  }
}
