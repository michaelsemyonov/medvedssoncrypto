import { formatDateTime } from '@/lib/datetime.ts';
import { getApiBaseUrl, getSessionToken } from '@/lib/api.ts';

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
      <div className="hero-status" aria-live="polite">
        <span
          className={
            data.runner.running
              ? 'hero-status-pill hero-status-pill-live'
              : 'hero-status-pill hero-status-pill-stopped'
          }
        >
          {data.runner.running ? 'Live' : 'Stopped'}
        </span>
        <span className="hero-status-text">Last tick {lastTick}</span>
      </div>
    );
  } catch {
    return null;
  }
}
