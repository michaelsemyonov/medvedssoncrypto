const STOCKHOLM_TIME_ZONE = 'Europe/Stockholm';
const DATE_WITH_TIMEZONE_SUFFIX = /(Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const stockholmDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: STOCKHOLM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const normalizeDateInput = (value: string): string => {
  const text = value.trim();

  if (
    text.length === 0 ||
    DATE_WITH_TIMEZONE_SUFFIX.test(text)
  ) {
    return text;
  }

  if (DATE_ONLY_PATTERN.test(text)) {
    return `${text}T00:00:00.000Z`;
  }

  if (text.includes('T')) {
    return `${text}Z`;
  }

  if (text.includes(' ')) {
    return `${text.replace(' ', 'T')}Z`;
  }

  return text;
};

const getDateTimeParts = (
  date: Date
): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> => {
  const parts = stockholmDateTimeFormatter.formatToParts(date);

  return {
    year: parts.find((part) => part.type === 'year')?.value ?? '0000',
    month: parts.find((part) => part.type === 'month')?.value ?? '00',
    day: parts.find((part) => part.type === 'day')?.value ?? '00',
    hour: parts.find((part) => part.type === 'hour')?.value ?? '00',
    minute: parts.find((part) => part.type === 'minute')?.value ?? '00',
  };
};

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

  const date =
    value instanceof Date
      ? value
      : new Date(
          typeof value === 'string' ? normalizeDateInput(value) : value
        );
  return Number.isNaN(date.getTime()) ? null : date;
};

export function formatDateTime(value: unknown, fallback = 'n/a'): string {
  const date = toDate(value);

  if (!date) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  const parts = getDateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatTime(value: unknown, fallback = 'n/a'): string {
  const date = toDate(value);

  if (!date) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  const parts = getDateTimeParts(date);
  return `${parts.hour}:${parts.minute}`;
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
