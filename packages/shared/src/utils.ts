import type {
  OrderIntent,
  OrderSide,
  PositionSide,
  SignalType,
  Timeframe,
} from './types.ts';
import {
  ORDER_INTENTS,
  ORDER_SIDES,
  POSITION_SIDES,
  SIGNAL_TYPES,
} from './types.ts';

type TimeZoneDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const getDateFromInput = (value: string | Date): Date => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value.');
  }

  return date;
};

const getTimeZoneDateParts = (
  value: string | Date,
  timeZone: string
): TimeZoneDateParts => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(getDateFromInput(value));

  const readPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const rawValue = parts.find((part) => part.type === type)?.value;
    return Number(rawValue ?? 0);
  };

  return {
    year: readPart('year'),
    month: readPart('month'),
    day: readPart('day'),
    hour: readPart('hour'),
    minute: readPart('minute'),
    second: readPart('second'),
  };
};

const getTimeZoneOffsetMs = (value: Date, timeZone: string): number => {
  const parts = getTimeZoneDateParts(value, timeZone);
  const utcFromParts = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return utcFromParts - value.getTime();
};

const zonedDateTimeToUtcMs = (
  parts: Pick<TimeZoneDateParts, 'year' | 'month' | 'day'> & {
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string
): number => {
  const hour = parts.hour ?? 0;
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    second
  );
  const initialOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  const utcMs = utcGuess - initialOffset;
  const adjustedOffset = getTimeZoneOffsetMs(new Date(utcMs), timeZone);

  return adjustedOffset === initialOffset ? utcMs : utcGuess - adjustedOffset;
};

export const timeframeToMs = (timeframe: Timeframe): number => {
  if (timeframe === '5m') {
    return 5 * 60 * 1000;
  }

  if (timeframe === '15m') {
    return 15 * 60 * 1000;
  }

  throw new Error('Unsupported timeframe.');
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

export const symbolToExchangeMarket = (symbol: string): string =>
  normalizeSymbol(symbol).replace('/', '');

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const round = (value: number, decimals = 8): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export const utcDateKey = (isoTime: string): string => isoTime.slice(0, 10);

export const getDateKeyInTimeZone = (
  value: string | Date,
  timeZone: string
): string => {
  const parts = getTimeZoneDateParts(value, timeZone);

  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

export const getDayBoundsInTimeZone = (
  value: string | Date,
  timeZone: string
): { dayKey: string; start: string; end: string } => {
  const parts = getTimeZoneDateParts(value, timeZone);
  const start = zonedDateTimeToUtcMs(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
    },
    timeZone
  );
  const nextDay = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + 1)
  );
  const end = zonedDateTimeToUtcMs(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
    },
    timeZone
  );

  return {
    dayKey: getDateKeyInTimeZone(value, timeZone),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
};

export const getPositionSideFromSignal = (
  signalType: SignalType
): PositionSide | null => {
  if (
    signalType === SIGNAL_TYPES.LONG_ENTRY ||
    signalType === SIGNAL_TYPES.LONG_EXIT
  ) {
    return POSITION_SIDES.LONG;
  }

  if (
    signalType === SIGNAL_TYPES.SHORT_ENTRY ||
    signalType === SIGNAL_TYPES.SHORT_EXIT
  ) {
    return POSITION_SIDES.SHORT;
  }

  return null;
};

export const getOrderIntentFromSignal = (
  signalType: SignalType
): OrderIntent | null => {
  if (
    signalType === SIGNAL_TYPES.LONG_ENTRY ||
    signalType === SIGNAL_TYPES.SHORT_ENTRY
  ) {
    return ORDER_INTENTS.OPEN_POSITION;
  }

  if (
    signalType === SIGNAL_TYPES.LONG_EXIT ||
    signalType === SIGNAL_TYPES.SHORT_EXIT
  ) {
    return ORDER_INTENTS.CLOSE_POSITION;
  }

  return null;
};

export const getOrderSide = (
  positionSide: PositionSide,
  intent: OrderIntent
): OrderSide => {
  if (positionSide === POSITION_SIDES.LONG) {
    return intent === ORDER_INTENTS.OPEN_POSITION
      ? ORDER_SIDES.BUY
      : ORDER_SIDES.SELL;
  }

  return intent === ORDER_INTENTS.OPEN_POSITION
    ? ORDER_SIDES.SELL
    : ORDER_SIDES.BUY;
};

export const getOppositePositionSide = (side: PositionSide): PositionSide =>
  side === POSITION_SIDES.LONG ? POSITION_SIDES.SHORT : POSITION_SIDES.LONG;

export const getEntrySignalTypeForPositionSide = (
  side: PositionSide
): SignalType =>
  side === POSITION_SIDES.LONG
    ? SIGNAL_TYPES.LONG_ENTRY
    : SIGNAL_TYPES.SHORT_ENTRY;

export const getExitSignalTypeForPositionSide = (
  side: PositionSide
): SignalType =>
  side === POSITION_SIDES.LONG
    ? SIGNAL_TYPES.LONG_EXIT
    : SIGNAL_TYPES.SHORT_EXIT;
