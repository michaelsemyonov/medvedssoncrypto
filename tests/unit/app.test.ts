import { selectStatsRun } from '../../apps/api/src/app.ts';

describe('selectStatsRun', () => {
  it('prefers the active run when one exists', () => {
    const activeRun = { id: 'active' };
    const latestStoppedRun = { id: 'stopped' };

    expect(selectStatsRun(activeRun, [latestStoppedRun])).toEqual(activeRun);
  });

  it('falls back to the latest available run when no run is active', () => {
    const latestStoppedRun = { id: 'latest' };
    const olderStoppedRun = { id: 'older' };

    expect(selectStatsRun(null, [latestStoppedRun, olderStoppedRun])).toEqual(
      latestStoppedRun
    );
  });

  it('returns null when there are no runs at all', () => {
    expect(selectStatsRun(null, [])).toBeNull();
  });
});
