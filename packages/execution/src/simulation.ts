import type {
  ExecutionConfig,
  OpenPositionContext,
  OrderIntent,
  OrderSide,
  PositionSide,
  SignalType,
  TradePnl
} from '@medvedsson/shared';
import { getOrderIntentFromSignal, getOrderSide, getPositionSideFromSignal, round } from '@medvedsson/shared';

export type PendingOrderDraft = {
  signalType: SignalType;
  positionSide: PositionSide;
  intent: OrderIntent;
  side: OrderSide;
  referencePrice: number;
  qty: number;
  notionalUsdt: number;
  feeRate: number;
  slippageBps: number;
  feeAmount: number;
  fillModel: ExecutionConfig['fillModel'];
  meta: Record<string, unknown>;
};

export const adjustForSlippage = (
  referencePrice: number,
  side: OrderSide,
  slippageBps: number
): number => {
  const multiplier = side === 'BUY' ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
  return round(referencePrice * multiplier, 8);
};

export const calculateTradePnl = (
  positionSide: PositionSide,
  entryPrice: number,
  exitPrice: number,
  qty: number,
  entryFee: number,
  exitFee: number
): TradePnl => {
  const direction = positionSide === 'LONG' ? 1 : -1;
  const grossPnl = round((exitPrice - entryPrice) * qty * direction, 8);
  const totalFees = round(entryFee + exitFee, 8);
  const realizedPnl = round(grossPnl - totalFees, 8);
  return { realizedPnl, grossPnl, totalFees };
};

export const calculateUnrealizedPnl = (
  position: Pick<OpenPositionContext, 'side' | 'entryPrice' | 'qty' | 'entryFee'>,
  markPrice: number,
  estimatedExitFee = 0
): number => {
  const direction = position.side === 'LONG' ? 1 : -1;
  const gross = (markPrice - position.entryPrice) * position.qty * direction;
  return round(gross - position.entryFee - estimatedExitFee, 8);
};

export const buildPendingOrder = (
  signalType: SignalType,
  referencePrice: number,
  config: ExecutionConfig,
  scheduledForOpenTime: string,
  openPosition: OpenPositionContext | null
): PendingOrderDraft => {
  const intent = getOrderIntentFromSignal(signalType);
  const positionSide = getPositionSideFromSignal(signalType);

  if (!intent || !positionSide) {
    throw new Error(`Signal ${signalType} does not map to an executable order.`);
  }

  const side = getOrderSide(positionSide, intent);

  if (intent === 'OPEN_POSITION') {
    if (config.positionSizingMode !== 'fixed_usdt') {
      throw new Error('Unsupported position sizing mode.');
    }

    const fillPrice = adjustForSlippage(referencePrice, side, config.slippageBps);
    const qty = round(config.fixedUsdtPerTrade / fillPrice, 8);
    const feeAmount = round(config.fixedUsdtPerTrade * config.feeRate, 8);

    return {
      signalType,
      positionSide,
      intent,
      side,
      referencePrice,
      qty,
      notionalUsdt: config.fixedUsdtPerTrade,
      feeRate: config.feeRate,
      slippageBps: config.slippageBps,
      feeAmount,
      fillModel: config.fillModel,
      meta: {
        scheduled_for_open_time: scheduledForOpenTime
      }
    };
  }

  if (!openPosition) {
    throw new Error('Exit orders require an open position context.');
  }

  const notionalUsdt = round(openPosition.qty * referencePrice, 8);
  const feeAmount = round(notionalUsdt * config.feeRate, 8);

  return {
    signalType,
    positionSide,
    intent,
    side,
    referencePrice,
    qty: openPosition.qty,
    notionalUsdt,
    feeRate: config.feeRate,
    slippageBps: config.slippageBps,
    feeAmount,
    fillModel: config.fillModel,
    meta: {
      scheduled_for_open_time: scheduledForOpenTime,
      position_id: openPosition.id
    }
  };
};
