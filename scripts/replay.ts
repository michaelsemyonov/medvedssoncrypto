import 'dotenv/config';

import { createDatabase } from '@medvedsson/db';
import { DryRunExecutionAdapter, evaluateRisk } from '@medvedsson/execution';
import { loadConfig, timeframeToMs } from '@medvedsson/shared';
import { evaluateMomentumStrategy, requiredCandles } from '@medvedsson/strategy';

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
    symbols: symbols ? symbols.split(',').map((symbol) => symbol.trim().toUpperCase()) : null
  };
};

const main = async () => {
  const config = loadConfig();
  const args = parseArgs();
  const db = createDatabase(config.databaseUrl);
  await db.migrate();

  const symbols = args.symbols ?? config.symbols;
  await db.replaceActiveSymbols(config.exchange, symbols);
  const symbolRows = (await db.listSymbols()).filter((symbol) => symbol.active);
  const run = await db.createRun({
    name: `replay-${args.start}-${args.end}`,
    strategyKey: config.strategyKey,
    version: config.strategyVersion,
    timeframe: config.timeframe
  });
  const executionAdapter = new DryRunExecutionAdapter(db, config.execution);

  for (const symbol of symbolRows) {
    const candles = await db.getCandlesInRange({
      exchange: config.exchange,
      symbol: symbol.symbol,
      timeframe: config.timeframe,
      startTime: args.start,
      endTime: args.end
    });

    for (let index = 0; index < candles.length; index += 1) {
      const candle = candles[index]!;
      const history = candles.slice(0, index + 1);

      await executionAdapter.processPendingFills({
        runId: run.id,
        symbolId: symbol.id,
        openPrice: candle.open,
        openTime: candle.openTime
      });

      const openPosition = await db.getOpenPosition(run.id, symbol.id);
      const signal = evaluateMomentumStrategy(history, config.signal, openPosition);
      const signalRow = await db.insertSignal({
        runId: run.id,
        symbolId: symbol.id,
        exchange: symbol.exchange,
        symbol: symbol.symbol,
        timeframe: config.timeframe,
        signal
      });
      const lastClosedPosition = await db.getLastClosedPosition(run.id, symbol.id);
      const cooldownRemainingBars =
        lastClosedPosition?.exit_time === null || lastClosedPosition?.exit_time === undefined
          ? 0
          : Math.max(
              0,
              config.cooldownBars -
                Math.floor(
                  (new Date(candle.closeTime).getTime() - lastClosedPosition.exit_time.getTime()) /
                    timeframeToMs(config.timeframe)
                )
            );

      const decision = evaluateRisk({
        signal,
        symbolEnabled: symbol.active,
        enoughHistory: history.length >= requiredCandles(config.signal),
        allowShort: config.allowShort,
        maxOpenPositions: config.maxOpenPositions,
        openPositionsCount: await db.getOpenPositionsCount(run.id),
        openPosition,
        cooldownRemainingBars,
        currentDrawdownPct: await db.getCurrentDrawdownPct(run.id),
        maxDailyDrawdownPct: config.maxDailyDrawdownPct,
        consecutiveLosses: await db.getConsecutiveLosses(run.id),
        maxConsecutiveLosses: config.maxConsecutiveLosses
      });

      await db.updateSignalDecision(signalRow.id, decision);
      await db.insertRiskEvent({
        runId: run.id,
        signalId: signalRow.id,
        symbolId: symbol.id,
        decision
      });

      if (decision.approved && signal.signalType !== 'NO_SIGNAL') {
        await executionAdapter.handleApprovedSignal({
          runId: run.id,
          signalId: signalRow.id,
          symbolId: symbol.id,
          signalType: signal.signalType,
          referencePrice: candle.close,
          scheduledForOpenTime: candle.closeTime,
          openPosition
        });
      }
    }
  }

  const stats = await db.getStatsSummary(run.id, config.execution.equityStartUsdt);
  await db.stopRun(run.id);
  await db.close();
  console.log(JSON.stringify({ runId: run.id, stats }, null, 2));
};

void main();
