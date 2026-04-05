const DEFAULT_API_BASE_URL = 'http://localhost:3000';

const readNonEmpty = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveApiBaseUrl = (): string =>
  (readNonEmpty(process.env.API_BASE_URL) ?? DEFAULT_API_BASE_URL).replace(
    /\/$/,
    ''
  );
