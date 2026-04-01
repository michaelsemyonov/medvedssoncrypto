import { formatDateTime } from '../../apps/pwa/lib/datetime.ts';

describe('formatDateTime', () => {
  it('renders timestamps as YYYY-MM-DD HH:mm', () => {
    expect(formatDateTime(new Date(2026, 3, 1, 9, 5, 45))).toBe(
      '2026-04-01 09:05'
    );
  });

  it('returns the fallback for missing values', () => {
    expect(formatDateTime(null)).toBe('n/a');
  });

  it('returns the original string for invalid values', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
