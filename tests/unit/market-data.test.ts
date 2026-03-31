import { MarketDataAdapter } from '@medvedsson/market-data';

import { silentLogger } from '../helpers.ts';

describe('MarketDataAdapter', () => {
  it('normalizes Binance close times to openTime plus timeframe duration', async () => {
    const openTime = Date.now() - 10 * 60 * 1000;
    const binanceCloseTime = openTime + 5 * 60 * 1000 - 1;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [openTime, '100', '101', '99', '100.5', '123', binanceCloseTime]
      ]
    });

    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MarketDataAdapter(
      {
        exchange: 'binance',
        timeoutMs: 1_000,
        rateLimitMs: 0
      },
      silentLogger
    );

    const candles = await adapter.fetchRecentCandles('BTC/USDT', '5m', 1);

    expect(candles).toHaveLength(1);
    expect(candles[0]?.openTime).toBe(new Date(openTime).toISOString());
    expect(candles[0]?.closeTime).toBe(new Date(openTime + 5 * 60 * 1000).toISOString());

    vi.unstubAllGlobals();
  });
});
