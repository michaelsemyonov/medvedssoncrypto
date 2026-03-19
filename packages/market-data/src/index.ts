import type { Candle, Timeframe } from '@medvedsson/shared';
import { normalizeSymbol, sleep, symbolToExchangeMarket, timeframeToMs } from '@medvedsson/shared';

type ExchangeName = 'bybit' | 'binance';

type AdapterConfig = {
  exchange: ExchangeName;
  timeoutMs: number;
  rateLimitMs: number;
};

type LoggerLike = {
  debug: (payload: unknown, message?: string) => void;
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

const defaultLogger: LoggerLike = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

export class MarketDataAdapter {
  private readonly config: AdapterConfig;
  private readonly logger: LoggerLike;
  private lastRequestAt = 0;

  constructor(config: AdapterConfig, logger: LoggerLike = defaultLogger) {
    this.config = config;
    this.logger = logger;
  }

  private async respectRateLimit(): Promise<void> {
    const waitFor = this.config.rateLimitMs - (Date.now() - this.lastRequestAt);

    if (waitFor > 0) {
      await sleep(waitFor);
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.respectRateLimit();
        this.lastRequestAt = Date.now();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            accept: 'application/json'
          }
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${url}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        this.logger.warn({ attempt, url, error }, 'Market data fetch attempt failed.');
        await sleep(250 * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Unknown market data fetch error.');
  }

  async fetchRecentCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const normalized = normalizeSymbol(symbol);

    if (this.config.exchange === 'bybit') {
      return this.fetchBybitCandles(normalized, timeframe, limit);
    }

    return this.fetchBinanceCandles(normalized, timeframe, limit);
  }

  private async fetchBybitCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const market = symbolToExchangeMarket(symbol);
    const interval = timeframe === '5m' ? '5' : timeframe;
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${market}&interval=${interval}&limit=${limit}`;
    const payload = await this.fetchJson<{
      result?: {
        list?: string[][];
      };
    }>(url);
    const list = payload.result?.list ?? [];
    const candleMs = timeframeToMs(timeframe);
    const now = Date.now();

    return list
      .map((entry) => {
        const openTime = Number(entry[0]);
        const closeTime = openTime + candleMs;

        return {
          exchange: 'bybit',
          symbol,
          timeframe,
          openTime: new Date(openTime).toISOString(),
          closeTime: new Date(closeTime).toISOString(),
          open: Number(entry[1]),
          high: Number(entry[2]),
          low: Number(entry[3]),
          close: Number(entry[4]),
          volume: Number(entry[5]),
          source: 'bybit-rest'
        } satisfies Candle;
      })
      .filter((candle) => new Date(candle.closeTime).getTime() <= now)
      .sort((left, right) => left.closeTime.localeCompare(right.closeTime));
  }

  private async fetchBinanceCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const market = symbolToExchangeMarket(symbol);
    const url = `https://api.binance.com/api/v3/klines?symbol=${market}&interval=${timeframe}&limit=${limit}`;
    const payload = await this.fetchJson<Array<[number, string, string, string, string, string, number]>>(url);
    const now = Date.now();

    return payload
      .map((entry) => ({
        exchange: 'binance',
        symbol,
        timeframe,
        openTime: new Date(entry[0]).toISOString(),
        closeTime: new Date(entry[6]).toISOString(),
        open: Number(entry[1]),
        high: Number(entry[2]),
        low: Number(entry[3]),
        close: Number(entry[4]),
        volume: Number(entry[5]),
        source: 'binance-rest'
      }))
      .filter((candle) => new Date(candle.closeTime).getTime() <= now)
      .sort((left, right) => left.closeTime.localeCompare(right.closeTime));
  }
}
