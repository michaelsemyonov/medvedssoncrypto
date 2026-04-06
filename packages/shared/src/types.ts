export const SIGNAL_TYPES = {
  LONG_ENTRY: 'LONG_ENTRY',
  SHORT_ENTRY: 'SHORT_ENTRY',
  LONG_EXIT: 'LONG_EXIT',
  SHORT_EXIT: 'SHORT_EXIT',
  NO_SIGNAL: 'NO_SIGNAL',
} as const;

export type SignalType = (typeof SIGNAL_TYPES)[keyof typeof SIGNAL_TYPES];

export const POSITION_SIDES = {
  LONG: 'LONG',
  SHORT: 'SHORT',
} as const;

export type PositionSide = (typeof POSITION_SIDES)[keyof typeof POSITION_SIDES];

export const POSITION_STATUSES = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;

export type PositionStatus =
  (typeof POSITION_STATUSES)[keyof typeof POSITION_STATUSES];

export const ORDER_STATUSES = {
  PENDING: 'PENDING',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const ORDER_INTENTS = {
  OPEN_POSITION: 'OPEN_POSITION',
  CLOSE_POSITION: 'CLOSE_POSITION',
} as const;

export type OrderIntent = (typeof ORDER_INTENTS)[keyof typeof ORDER_INTENTS];

export const ORDER_SIDES = {
  BUY: 'BUY',
  SELL: 'SELL',
} as const;

export type OrderSide = (typeof ORDER_SIDES)[keyof typeof ORDER_SIDES];

export const EXCHANGES = {
  BYBIT: 'bybit',
  BINANCE: 'binance',
  OKX: 'okx',
} as const;

export type ExchangeName = (typeof EXCHANGES)[keyof typeof EXCHANGES];

export const BROKERS = {
  BYBIT: 'bybit',
  OKX: 'okx',
} as const;

export type BrokerName = (typeof BROKERS)[keyof typeof BROKERS];

export type Timeframe = '1m' | '5m' | '15m';

export type Candle = {
  exchange: string;
  symbol: string;
  timeframe: Timeframe;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
};

export type StrategyParams = {
  n: number;
  k: number;
  hBars: number;
  timeframe: Timeframe;
};

export type FormulaInputs = {
  r_t: number | null;
  B_t: number | null;
  N: number;
  k: number;
  H: number;
  threshold: number | null;
  comparison: 'LONG' | 'SHORT' | 'NONE' | 'EXIT';
};

export type StrategySignal = {
  signalType: SignalType;
  candleCloseTime: string;
  signalStrength: number | null;
  formulaInputs: FormulaInputs;
  indicators: Record<string, number | null>;
  features: Record<string, unknown>;
  reason: string;
};

export type OpenPositionContext = {
  id: string;
  side: PositionSide;
  entryTime: string;
  entryPrice: number;
  qty: number;
  notionalUsdt: number;
  entryFee: number;
  broker: BrokerName;
  isCounterPosition: boolean;
};

export type RiskDecision = {
  approved: boolean;
  rejectionCode: string | null;
  rejectionReason: string | null;
  snapshot: Record<string, unknown>;
};

export type RiskInput = {
  signal: StrategySignal;
  symbolEnabled: boolean;
  enoughHistory: boolean;
  allowShort: boolean;
  maxOpenPositions: number;
  openPositionsCount: number;
  openPosition: OpenPositionContext | null;
  cooldownRemainingBars: number;
  currentDrawdownPct: number;
  maxDailyDrawdownPct: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
};

export type FillModel = 'next_open';

export type PositionSizingMode = 'fixed_usdt';

export type ExecutionConfig = {
  fillModel: FillModel;
  positionSizingMode: PositionSizingMode;
  feeRate: number;
  slippageBps: number;
  fixedUsdtPerTrade: number;
  equityStartUsdt: number;
};

export type AuthConfig = {
  adminPassword: string;
  sessionSecret: string;
  sessionTtlHours: number;
};

export type SymbolRuntimeSettings = {
  exchange: ExchangeName;
  exchangeTimeoutMs: number;
  exchangeRateLimitMs: number;
  positionBroker: BrokerName;
  counterPositionBroker: BrokerName;
  timeframe: Timeframe;
  dryRun: boolean;
  allowShort: boolean;
  strategyKey: string;
  strategyVersion: string;
  signal: StrategyParams;
  execution: ExecutionConfig;
  maxOpenPositions: number;
  cooldownBars: number;
  stopLossPct: number;
  maxDailyDrawdownPct: number;
  maxConsecutiveLosses: number;
  pollIntervalMs: number;
  trailingProfile: 'conservative' | 'balanced' | 'aggressive' | 'custom';
  trailingEnabled: boolean;
  trailingActivationProfitPct: number;
  trailingGivebackRatio: number;
  trailingGivebackMinPct: number;
  trailingGivebackMaxPct: number;
  trailingMinLockedProfitPct: number;
};

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  exchange: ExchangeName;
  exchangeTimeoutMs: number;
  exchangeRateLimitMs: number;
  positionBroker: BrokerName;
  counterPositionBroker: BrokerName;
  timeframe: Timeframe;
  symbols: string[];
  dryRun: boolean;
  allowShort: boolean;
  strategyKey: string;
  strategyVersion: string;
  signal: StrategyParams;
  execution: ExecutionConfig;
  maxOpenPositions: number;
  cooldownBars: number;
  stopLossPct: number;
  maxDailyDrawdownPct: number;
  maxConsecutiveLosses: number;
  pollIntervalMs: number;
  trailingProfile: 'conservative' | 'balanced' | 'aggressive' | 'custom';
  trailingEnabled: boolean;
  trailingActivationProfitPct: number;
  trailingGivebackRatio: number;
  trailingGivebackMinPct: number;
  trailingGivebackMaxPct: number;
  trailingMinLockedProfitPct: number;
  defaultSymbols: string[];
  defaultSymbolSettings: SymbolRuntimeSettings;
  enableCandleStorage: boolean;
  runnerAutostart: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  auth: AuthConfig;
  webPushVapidPublicKey: string;
  webPushVapidPrivateKey: string;
  webPushContact: string;
};

export type SessionPayload = {
  sub: 'admin';
  iat: number;
  exp: number;
  version: 1;
};

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
  eventFilters: string[] | null;
  userLabel: string | null;
};

export type TradePnl = {
  realizedPnl: number;
  grossPnl: number;
  totalFees: number;
};
