import { buildTestConfig } from '../helpers.ts';
import { createFakeDatabase } from '../fake-db.ts';

describe('database integration', () => {
  it('keeps signal inserts idempotent through the repository contract', async () => {
    const db = createFakeDatabase();
    const config = buildTestConfig();

    await db.migrate();
    const run = await db.startRun(config);
    const [symbol] = await db.replaceActiveSymbols(config.exchange, config.symbols);

    const first = await db.insertSignal({
      runId: run.id,
      symbolId: symbol!.id,
      exchange: config.exchange,
      symbol: symbol!.symbol,
      timeframe: config.timeframe,
      signal: {
        signalType: 'NO_SIGNAL',
        candleCloseTime: '2026-01-01T00:05:00.000Z',
        signalStrength: null,
        formulaInputs: {
          r_t: 0,
          B_t: 0,
          N: 96,
          k: 5,
          H: 72,
          threshold: 0,
          comparison: 'NONE'
        },
        indicators: {
          return: 0,
          baselineMoveMagnitude: 0
        },
        features: {},
        reason: 'No edge.'
      }
    });

    const second = await db.insertSignal({
      runId: run.id,
      symbolId: symbol!.id,
      exchange: config.exchange,
      symbol: symbol!.symbol,
      timeframe: config.timeframe,
      signal: {
        signalType: 'NO_SIGNAL',
        candleCloseTime: '2026-01-01T00:05:00.000Z',
        signalStrength: null,
        formulaInputs: {
          r_t: 0,
          B_t: 0,
          N: 96,
          k: 5,
          H: 72,
          threshold: 0,
          comparison: 'NONE'
        },
        indicators: {
          return: 0,
          baselineMoveMagnitude: 0
        },
        features: {},
        reason: 'No edge.'
      }
    });

    expect(first.id).toBe(second.id);
    expect((await db.getRecentSignals()).length).toBe(1);
    await db.close();
  });
});
