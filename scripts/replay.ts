import { createDatabase } from '@medvedsson/db';
import { DryRunExecutionAdapter, evaluateRisk } from '@medvedsson/execution';
import { loadConfig, SIGNAL_TYPES, timeframeToMs } from '@medvedsson/shared';
import {
  evaluateMomentumStrategy,
  requiredCandles,
} from '@medvedsson/strategy';

const parseArgs = () => {
  const args = new Map(
    process.argv.slice(2).map((argument) => {
      const [key, value] = argument.replace(/^--/, '').split('=');
      return [key, value ?? ''];
    })
  );

  const start = args.get('start');
  const end = args.get('end');
  const symbols = args.get('symbols');

  if (!start || !end) {
    throw new Error('Replay requires --start=ISO_DATE and --end=ISO_DATE.');
  }

  return {
    start,
    end,
    symbols: symbols
      ? symbols.split(',').map((symbol) => symbol.trim().toUpperCase())
      : null,
  };
};

const main = async () => {
  const config = loadConfig();
  const args = parseArgs();
  const db = createDatabase(config.databaseUrl);
  await db.migrate();
  await db.ensureDefaultSymbols(
    config.defaultSymbols,
    config.defaultSymbolSettings
  );

  if (args.symbols) {
    await db.replaceActiveSymbols(
      config.defaultSymbolSettings.exchange,
      args.symbols,
      config.defaultSymbolSettings
    );
  }

  const symbolRows = (await db.listSymbols()).filter((symbol) => symbol.active);
  const runDefaults = symbolRows[0]
    ? {
        strategyKey: symbolRows[0].strategy_key,
        strategyVersion: symbolRows[0].strategy_version,
        timeframe: symbolRows[0].timeframe,
        dryRun: symbolRows[0].dry_run,
      }
    : {
        strategyKey: config.defaultSymbolSettings.strategyKey,
        strategyVersion: config.defaultSymbolSettings.strategyVersion,
        timeframe: config.defaultSymbolSettings.timeframe,
        dryRun: config.defaultSymbolSettings.dryRun,
      };
  const run = await db.createRun({
    name: `replay-${args.start}-${args.end}`,
    strategyKey: runDefaults.strategyKey,
    version: runDefaults.strategyVersion,
    timeframe: runDefaults.timeframe,
    dryRun: runDefaults.dryRun,
  });

  for (const symbol of symbolRows) {
    const executionAdapter = new DryRunExecutionAdapter(db, {
      fillModel: symbol.fill_model,
      positionSizingMode: symbol.position_sizing_mode,
      feeRate: symbol.fee_rate,
      slippageBps: symbol.slippage_bps,
      fixedUsdtPerTrade: symbol.fixed_usdt_per_trade,
      equityStartUsdt: symbol.equity_start_usdt,
    });
    const candles = await db.getCandlesInRange({
      exchange: symbol.exchange,
      symbol: symbol.symbol,
      timeframe: symbol.timeframe,
      startTime: args.start,
      endTime: args.end,
    });

    for (let index = 0; index < candles.length; index += 1) {
      const candle = candles[index]!;
      const history = candles.slice(0, index + 1);

      await executionAdapter.processPendingFills({
        runId: run.id,
        symbolId: symbol.id,
        openPrice: candle.open,
        openTime: candle.openTime,
      });

      const openPosition = await db.getOpenPosition(run.id, symbol.id);
      const signal = evaluateMomentumStrategy(
        history,
        {
          n: symbol.signal_n,
          k: symbol.signal_k,
          hBars: symbol.signal_h_bars,
          timeframe: symbol.timeframe,
        },
        openPosition
      );

      if (signal.signalType === SIGNAL_TYPES.NO_SIGNAL) {
        await db.recordProcessedCandle({
          runId: run.id,
          symbolId: symbol.id,
          candleCloseTime: signal.candleCloseTime,
        });
        continue;
      }

      const signalRow = await db.insertSignal({
        runId: run.id,
        symbolId: symbol.id,
        exchange: symbol.exchange,
        symbol: symbol.symbol,
        timeframe: symbol.timeframe,
        signal,
      });
      await db.recordProcessedCandle({
        runId: run.id,
        symbolId: symbol.id,
        candleCloseTime: signal.candleCloseTime,
      });
      const lastClosedPosition = await db.getLastClosedPosition(
        run.id,
        symbol.id
      );
      const cooldownRemainingBars =
        lastClosedPosition?.exit_time === null ||
        lastClosedPosition?.exit_time === undefined
          ? 0
          : Math.max(
              0,
              symbol.cooldown_bars -
                Math.floor(
                  (new Date(candle.closeTime).getTime() -
                    lastClosedPosition.exit_time.getTime()) /
                    timeframeToMs(symbol.timeframe)
                )
            );

      const decision = evaluateRisk({
        signal,
        symbolEnabled: symbol.active,
        enoughHistory:
          history.length >=
          requiredCandles({
            n: symbol.signal_n,
            k: symbol.signal_k,
            hBars: symbol.signal_h_bars,
            timeframe: symbol.timeframe,
          }),
        allowShort: symbol.allow_short,
        maxOpenPositions: symbol.max_open_positions,
        openPositionsCount: await db.getOpenPositionsCount(run.id),
        openPosition,
        cooldownRemainingBars,
        currentDrawdownPct: await db.getCurrentDrawdownPct(run.id),
        maxDailyDrawdownPct: symbol.max_daily_drawdown_pct,
        consecutiveLosses: await db.getConsecutiveLosses(run.id),
        maxConsecutiveLosses: symbol.max_consecutive_losses,
      });

      await db.updateSignalDecision(signalRow.id, decision);
      await db.insertRiskEvent({
        runId: run.id,
        signalId: signalRow.id,
        symbolId: symbol.id,
        decision,
      });

      if (decision.approved) {
        await executionAdapter.handleApprovedSignal({
          runId: run.id,
          signalId: signalRow.id,
          symbolId: symbol.id,
          signalType: signal.signalType,
          referencePrice: candle.close,
          scheduledForOpenTime: candle.closeTime,
          openPosition,
        });
      }
    }
  }

  const startingEquity = symbolRows.reduce(
    (sum, symbol) => sum + symbol.equity_start_usdt,
    0
  );
  const stats = await db.getStatsSummary(run.id, startingEquity);
  await db.stopRun(run.id);
  await db.close();
  console.log(JSON.stringify({ runId: run.id, stats }, null, 2));
};

void main();
