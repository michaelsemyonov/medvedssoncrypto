import {
  formatDateTime,
  formatDurationBetween,
  formatTime,
} from '../../apps/pwa/lib/datetime.ts';

describe('formatDateTime', () => {
  it('renders UTC timestamps as YYYY-MM-DD HH:mm in Europe/Stockholm', () => {
    expect(formatDateTime('2026-04-01T09:05:45.000Z')).toBe(
      '2026-04-01 11:05'
    );
  });

  it('returns the fallback for missing values', () => {
    expect(formatDateTime(null)).toBe('n/a');
  });

  it('returns the original string for invalid values', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('treats timezone-less timestamps as UTC before converting to Europe/Stockholm', () => {
    expect(formatDateTime('2026-04-01 09:05:45')).toBe('2026-04-01 11:05');
  });

  it('renders time values as HH:mm in Europe/Stockholm', () => {
    expect(formatTime('2026-04-01T09:05:45.000Z')).toBe('11:05');
  });

  it('formats elapsed time from the provided timestamps', () => {
    expect(
      formatDurationBetween(
        '2026-04-01T09:05:00.000Z',
        '2026-04-01T15:05:00.000Z'
      )
    ).toBe('6h 0m');
  });

  it('includes seconds when the duration is not on a minute boundary', () => {
    expect(
      formatDurationBetween(
        '2026-04-01T09:05:00.000Z',
        '2026-04-01T09:06:09.000Z'
      )
    ).toBe('1m 9s');
  });

  it('returns the fallback for missing duration values', () => {
    expect(formatDurationBetween(null, '2026-04-01T09:06:09.000Z')).toBe('n/a');
  });
});
