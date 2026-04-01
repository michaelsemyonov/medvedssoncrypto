import { getDateKeyInTimeZone, getDayBoundsInTimeZone } from '@medvedsson/shared';

describe('timezone utilities', () => {
  it('formats the local date key in Europe/Stockholm', () => {
    expect(
      getDateKeyInTimeZone('2026-04-01T21:59:59.000Z', 'Europe/Stockholm')
    ).toBe('2026-04-01');
    expect(
      getDateKeyInTimeZone('2026-04-01T22:00:00.000Z', 'Europe/Stockholm')
    ).toBe('2026-04-02');
  });

  it('returns UTC bounds for the local day in Europe/Stockholm', () => {
    expect(
      getDayBoundsInTimeZone('2026-04-01T09:05:45.000Z', 'Europe/Stockholm')
    ).toEqual({
      dayKey: '2026-04-01',
      start: '2026-03-31T22:00:00.000Z',
      end: '2026-04-01T22:00:00.000Z',
    });
  });
});
