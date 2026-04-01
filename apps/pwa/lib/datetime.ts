const pad = (value: number): string => String(value).padStart(2, '0');

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (
    !(value instanceof Date) &&
    typeof value !== 'string' &&
    typeof value !== 'number'
  ) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function formatDateTime(value: unknown, fallback = 'n/a'): string {
  const date = toDate(value);

  if (!date) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatTime(value: unknown, fallback = 'n/a'): string {
  const date = toDate(value);

  if (!date) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDurationBetween(
  start: unknown,
  end: unknown,
  fallback = 'n/a'
): string {
  const startDate = toDate(start);
  const endDate = toDate(end);

  if (!startDate || !endDate) {
    return fallback;
  }

  const diffMs = endDate.getTime() - startDate.getTime();

  if (diffMs <= 0) {
    return '0s';
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return seconds > 0
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}
