import { buildPendingOrder } from './simulation.ts';

import type { ExecutionConfig, OpenPositionContext, OrderIntent, SignalType } from '@medvedsson/shared';

export type ExecutionRequest = {
  runId: string;
  signalId: string;
  symbolId: string;
  signalType: SignalType;
  referencePrice: number;
  scheduledForOpenTime: string;
  openPosition: OpenPositionContext | null;
};

export type ExecutionResult = {
  orderCreated: boolean;
  intent: OrderIntent | null;
};

export type PendingFillRequest = {
  runId: string;
  symbolId: string;
  openPrice: number;
  openTime: string;
};

export interface ExecutionAdapter {
  processPendingFills(request: PendingFillRequest): Promise<void>;
  handleApprovedSignal(request: ExecutionRequest): Promise<ExecutionResult>;
}

export type DryRunExecutionStore = {
  createPendingOrder(params: {
    runId: string;
    signalId: string;
    symbolId: string;
    orderType: string;
    side: 'BUY' | 'SELL';
    intent: 'OPEN_POSITION' | 'CLOSE_POSITION';
    referencePrice: number;
    qty: number;
    notionalUsdt: number;
    slippageBps: number;
    feeRate: number;
    feeAmount: number;
    fillModel: string;
    positionId?: string | null;
    meta: Record<string, unknown>;
  }): Promise<{ intent: 'OPEN_POSITION' | 'CLOSE_POSITION' } | null>;
  getPendingOrdersForOpenTime(
    runId: string,
    symbolId: string,
    openTime: string
  ): Promise<Array<{ id: string }>>;
  fillPendingOrder(orderId: string, fillPrice: number, fillTime: string): Promise<void>;
};

export class DryRunExecutionAdapter implements ExecutionAdapter {
  private readonly store: DryRunExecutionStore;
  private readonly config: ExecutionConfig;

  constructor(store: DryRunExecutionStore, config: ExecutionConfig) {
    this.store = store;
    this.config = config;
  }

  async processPendingFills(request: PendingFillRequest): Promise<void> {
    const pendingOrders = await this.store.getPendingOrdersForOpenTime(
      request.runId,
      request.symbolId,
      request.openTime
    );

    for (const order of pendingOrders) {
      await this.store.fillPendingOrder(order.id, request.openPrice, request.openTime);
    }
  }

  async handleApprovedSignal(request: ExecutionRequest): Promise<ExecutionResult> {
    const orderDraft = buildPendingOrder(
      request.signalType,
      request.referencePrice,
      this.config,
      request.scheduledForOpenTime,
      request.openPosition
    );

    const order = await this.store.createPendingOrder({
      runId: request.runId,
      signalId: request.signalId,
      symbolId: request.symbolId,
      orderType: 'MARKET',
      side: orderDraft.side,
      intent: orderDraft.intent,
      referencePrice: orderDraft.referencePrice,
      qty: orderDraft.qty,
      notionalUsdt: orderDraft.notionalUsdt,
      slippageBps: orderDraft.slippageBps,
      feeRate: orderDraft.feeRate,
      feeAmount: orderDraft.feeAmount,
      fillModel: orderDraft.fillModel,
      positionId: request.openPosition?.id ?? null,
      meta: orderDraft.meta
    });

    return {
      orderCreated: order !== null,
      intent: order?.intent ?? null
    };
  }
}
