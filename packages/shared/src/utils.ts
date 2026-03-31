import type { OrderIntent, OrderSide, PositionSide, SignalType, Timeframe } from './types.ts';
import { ORDER_INTENTS, ORDER_SIDES, POSITION_SIDES, SIGNAL_TYPES } from './types.ts';

export const timeframeToMs = (timeframe: Timeframe): number => {
  if (timeframe !== '5m') {
    throw new Error('Unsupported timeframe.');
  }

  return 5 * 60 * 1000;
};

export const parseSymbols = (value: string): string[] =>
  value
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

export const normalizeSymbol = (symbol: string): string => {
  const cleaned = symbol.replace('-', '/').replace(/\s+/g, '').toUpperCase();

  if (!cleaned.includes('/')) {
    if (cleaned.endsWith('USDT')) {
      return `${cleaned.slice(0, -4)}/USDT`;
    }

    throw new Error(`Unable to normalize symbol: ${symbol}`);
  }

  const [base, quote] = cleaned.split('/');

  if (!base || !quote) {
    throw new Error(`Unable to normalize symbol: ${symbol}`);
  }

  return `${base}/${quote}`;
};

export const symbolToExchangeMarket = (symbol: string): string => normalizeSymbol(symbol).replace('/', '');

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const round = (value: number, decimals = 8): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export const utcDateKey = (isoTime: string): string => isoTime.slice(0, 10);

export const getPositionSideFromSignal = (signalType: SignalType): PositionSide | null => {
  if (signalType === SIGNAL_TYPES.LONG_ENTRY || signalType === SIGNAL_TYPES.LONG_EXIT) {
    return POSITION_SIDES.LONG;
  }

  if (signalType === SIGNAL_TYPES.SHORT_ENTRY || signalType === SIGNAL_TYPES.SHORT_EXIT) {
    return POSITION_SIDES.SHORT;
  }

  return null;
};

export const getOrderIntentFromSignal = (signalType: SignalType): OrderIntent | null => {
  if (signalType === SIGNAL_TYPES.LONG_ENTRY || signalType === SIGNAL_TYPES.SHORT_ENTRY) {
    return ORDER_INTENTS.OPEN_POSITION;
  }

  if (signalType === SIGNAL_TYPES.LONG_EXIT || signalType === SIGNAL_TYPES.SHORT_EXIT) {
    return ORDER_INTENTS.CLOSE_POSITION;
  }

  return null;
};

export const getOrderSide = (positionSide: PositionSide, intent: OrderIntent): OrderSide => {
  if (positionSide === POSITION_SIDES.LONG) {
    return intent === ORDER_INTENTS.OPEN_POSITION ? ORDER_SIDES.BUY : ORDER_SIDES.SELL;
  }

  return intent === ORDER_INTENTS.OPEN_POSITION ? ORDER_SIDES.SELL : ORDER_SIDES.BUY;
};
