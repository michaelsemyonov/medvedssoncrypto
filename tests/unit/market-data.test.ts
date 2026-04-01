import { MarketDataAdapter } from '@medvedsson/market-data';

import { silentLogger } from '../helpers.ts';

describe('MarketDataAdapter', () => {
  it('normalizes Binance close times to openTime plus timeframe duration', async () => {
    const openTime = Date.now() - 10 * 60 * 1000;
    const binanceCloseTime = openTime + 5 * 60 * 1000 - 1;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [openTime, '100', '101', '99', '100.5', '123', binanceCloseTime],
      ],
    });

    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MarketDataAdapter(
      {
        exchange: 'binance',
        timeoutMs: 1_000,
        rateLimitMs: 0,
      },
      silentLogger
    );

    const candles = await adapter.fetchRecentCandles('BTC/USDT', '5m', 1);

    expect(candles).toHaveLength(1);
    expect(candles[0]?.openTime).toBe(new Date(openTime).toISOString());
    expect(candles[0]?.closeTime).toBe(
      new Date(openTime + 5 * 60 * 1000).toISOString()
    );

    vi.unstubAllGlobals();
  });

  it('supports 15m candles when normalizing exchange close times', async () => {
    const openTime = Date.now() - 30 * 60 * 1000;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [openTime, '100', '104', '99', '103', '456', openTime + 899_999],
      ],
    });

    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MarketDataAdapter(
      {
        exchange: 'binance',
        timeoutMs: 1_000,
        rateLimitMs: 0,
      },
      silentLogger
    );

    const candles = await adapter.fetchRecentCandles('BTC/USDT', '15m', 1);

    expect(candles).toHaveLength(1);
    expect(candles[0]?.openTime).toBe(new Date(openTime).toISOString());
    expect(candles[0]?.closeTime).toBe(
      new Date(openTime + 15 * 60 * 1000).toISOString()
    );

    vi.unstubAllGlobals();
  });

  it('uses the expected 15m interval when requesting Bybit candles', async () => {
    const openTime = Date.now() - 30 * 60 * 1000;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          list: [[String(openTime), '100', '104', '99', '103', '456']],
        },
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MarketDataAdapter(
      {
        exchange: 'bybit',
        timeoutMs: 1_000,
        rateLimitMs: 0,
      },
      silentLogger
    );

    await adapter.fetchRecentCandles('BTC/USDT', '15m', 1);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('interval=15&limit=1'),
      expect.any(Object)
    );

    vi.unstubAllGlobals();
  });

  it('supports OKX spot candles', async () => {
    const openTime = Date.now() - 10 * 60 * 1000;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          [String(openTime), '100', '101', '99', '100.5', '123', '0', '0', '1'],
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MarketDataAdapter(
      {
        exchange: 'okx',
        timeoutMs: 1_000,
        rateLimitMs: 0,
      },
      silentLogger
    );

    const candles = await adapter.fetchRecentCandles('BTC/USDT', '5m', 1);

    expect(candles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('instId=BTC-USDT&bar=5m&limit=1'),
      expect.any(Object)
    );

    vi.unstubAllGlobals();
  });
});
