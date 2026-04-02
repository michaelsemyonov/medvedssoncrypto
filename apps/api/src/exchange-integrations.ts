import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

import type { BrokerName } from '@medvedsson/shared';
import { normalizeSymbol, round, symbolToExchangeMarket } from '@medvedsson/shared';

const BYBIT_BASE_URL = 'https://api.bybit.com';
const OKX_BASE_URL = 'https://www.okx.com';
const BYBIT_RECV_WINDOW = '5000';

export type ManagedExchange = BrokerName;

export type DecryptedExchangeCredentials = {
  exchange: ManagedExchange;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string | null;
};

export type ManagedExchangePosition = {
  exchange: ManagedExchange;
  externalPositionId: string;
  instrumentId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  markPrice: number | null;
  notionalUsdt: number;
  unrealizedPnl: number | null;
  stopLossPrice: number | null;
  openedAt: string | null;
  meta: Record<string, unknown>;
};

type RequestOptions = {
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};

type BybitResponse<T> = {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
};

type OkxResponse<T> = {
  code: string;
  msg: string;
  data: T;
};

const hashSecret = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

const serializeEncryptedValue = (value: {
  iv: string;
  tag: string;
  ciphertext: string;
}): string => JSON.stringify(value);

const deserializeEncryptedValue = (value: string) =>
  JSON.parse(value) as { iv: string; tag: string; ciphertext: string };

const requestJson = async <T>(
  url: string,
  init: RequestInit
): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Exchange request failed with HTTP ${response.status}.`);
  }

  return response.json() as Promise<T>;
};

const buildQueryString = (
  query: Record<string, string | undefined> = {}
): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }

  return params.toString();
};

const parseOptionalNumber = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    value === '0' ||
    value === 0
  ) {
    return value === 0 || value === '0' ? 0 : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseNonZeroNumber = (value: unknown): number | null => {
  const parsed = parseOptionalNumber(value);

  if (parsed === null || parsed === 0) {
    return null;
  }

  return parsed;
};

const readString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return fallback;
};

const normalizeOkxInstrumentSymbol = (instrumentId: string): string => {
  const parts = instrumentId.split('-');

  if (parts.length >= 2) {
    return normalizeSymbol(`${parts[0]}/${parts[1]}`);
  }

  return normalizeSymbol(instrumentId);
};

const maskApiKey = (apiKey: string): string => {
  const trimmed = apiKey.trim();

  if (trimmed.length <= 9) {
    return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 5)}***${trimmed.slice(-4)}`;
};

export const encryptSecret = (value: string, secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', hashSecret(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  return serializeEncryptedValue({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  });
};

export const decryptSecret = (value: string, secret: string): string => {
  const payload = deserializeEncryptedValue(value);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    hashSecret(secret),
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

export const buildMaskedExchangeAccount = (params: {
  exchange: ManagedExchange;
  apiKeyMask: string | null;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasApiPassphrase: boolean;
  lastValidatedAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
}) => ({
  exchange: params.exchange,
  apiKeyMask: params.apiKeyMask,
  hasApiKey: params.hasApiKey,
  hasApiSecret: params.hasApiSecret,
  hasApiPassphrase: params.hasApiPassphrase,
  lastValidatedAt: params.lastValidatedAt?.toISOString() ?? null,
  lastSyncAt: params.lastSyncAt?.toISOString() ?? null,
  lastSyncError: params.lastSyncError,
});

export const buildCredentialUpdate = (params: {
  exchange: ManagedExchange;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  existing: {
    api_key_ciphertext: string | null;
    api_secret_ciphertext: string | null;
    api_passphrase_ciphertext: string | null;
    has_api_key: boolean;
    has_api_secret: boolean;
    has_api_passphrase: boolean;
  } | null;
  encryptionSecret: string;
}) => {
  const nextApiKey =
    params.apiKey.trim() !== ''
      ? params.apiKey.trim()
      : params.existing?.api_key_ciphertext
        ? decryptSecret(
            params.existing.api_key_ciphertext,
            params.encryptionSecret
          )
        : '';
  const nextApiSecret =
    params.apiSecret.trim() !== ''
      ? params.apiSecret.trim()
      : params.existing?.api_secret_ciphertext
        ? decryptSecret(
            params.existing.api_secret_ciphertext,
            params.encryptionSecret
          )
        : '';
  const nextApiPassphrase =
    params.exchange === 'okx'
      ? params.apiPassphrase.trim() !== ''
        ? params.apiPassphrase.trim()
        : params.existing?.api_passphrase_ciphertext
          ? decryptSecret(
              params.existing.api_passphrase_ciphertext,
              params.encryptionSecret
            )
          : ''
      : '';

  if (!nextApiKey || !nextApiSecret) {
    throw new Error('API key and API secret are required.');
  }

  if (params.exchange === 'okx' && !nextApiPassphrase) {
    throw new Error('OKX passphrase is required.');
  }

  return {
    apiKeyCiphertext: encryptSecret(nextApiKey, params.encryptionSecret),
    apiSecretCiphertext: encryptSecret(nextApiSecret, params.encryptionSecret),
    apiPassphraseCiphertext:
      params.exchange === 'okx'
        ? encryptSecret(nextApiPassphrase, params.encryptionSecret)
        : null,
    apiKeyMask: maskApiKey(nextApiKey),
    hasApiKey: true,
    hasApiSecret: true,
    hasApiPassphrase: params.exchange === 'okx',
    decrypted: {
      exchange: params.exchange,
      apiKey: nextApiKey,
      apiSecret: nextApiSecret,
      apiPassphrase: params.exchange === 'okx' ? nextApiPassphrase : null,
    } satisfies DecryptedExchangeCredentials,
  };
};

class BybitExchangeClient {
  constructor(private readonly credentials: DecryptedExchangeCredentials) {}

  private async request<T>(options: RequestOptions): Promise<BybitResponse<T>> {
    const method = options.method ?? 'GET';
    const queryString = buildQueryString(options.query);
    const path = queryString ? `${options.path}?${queryString}` : options.path;
    const body = options.body ? JSON.stringify(options.body) : '';
    const timestamp = Date.now().toString();
    const signaturePayload =
      method === 'GET'
        ? `${timestamp}${this.credentials.apiKey}${BYBIT_RECV_WINDOW}${queryString}`
        : `${timestamp}${this.credentials.apiKey}${BYBIT_RECV_WINDOW}${body}`;
    const signature = createHmac('sha256', this.credentials.apiSecret)
      .update(signaturePayload)
      .digest('hex');

    const response = await requestJson<BybitResponse<T>>(
      `${BYBIT_BASE_URL}${path}`,
      (() => {
        const init: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'medvedsson-crypto/1.0',
            'X-BAPI-API-KEY': this.credentials.apiKey,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-SIGN': signature,
            'X-BAPI-RECV-WINDOW': BYBIT_RECV_WINDOW,
            'X-Referer': 'medvedsson-crypto',
          },
        };

        if (method === 'POST') {
          init.body = body;
        }

        return init;
      })()
    );

    if (response.retCode !== 0) {
      throw new Error(`Bybit error ${response.retCode}: ${response.retMsg}`);
    }

    return response;
  }

  async validate(): Promise<void> {
    const timeResponse = await requestJson<{
      result?: { timeNano?: string; timeSecond?: string };
      time?: number;
    }>(`${BYBIT_BASE_URL}/v5/market/time`, {
      method: 'GET',
    });
    const serverTimeMs =
      timeResponse.time ??
      (timeResponse.result?.timeSecond
        ? Number(timeResponse.result.timeSecond) * 1000
        : null);

    if (serverTimeMs && Math.abs(Date.now() - serverTimeMs) > 5_000) {
      throw new Error(
        'Local clock differs from Bybit server time by more than 5 seconds.'
      );
    }

    await this.request({
      path: '/v5/account/wallet-balance',
      query: {
        accountType: 'UNIFIED',
      },
    });
  }

  async listOpenPositions(): Promise<ManagedExchangePosition[]> {
    const response = await this.request<{
      list?: Array<Record<string, unknown>>;
    }>({
      path: '/v5/position/list',
      query: {
        category: 'linear',
        settleCoin: 'USDT',
      },
    });
    const positions = response.result.list ?? [];

    const mapped = positions.map((rawPosition): ManagedExchangePosition | null => {
        const qty = Math.abs(Number(rawPosition.size ?? 0));

        if (!Number.isFinite(qty) || qty <= 0) {
          return null;
        }

        const instrumentId = readString(rawPosition.symbol);
        const side = readString(rawPosition.side).toLowerCase() === 'sell'
          ? 'SHORT'
          : 'LONG';
        const entryPrice = Number(rawPosition.avgPrice ?? 0);
        const markPrice = parseNonZeroNumber(rawPosition.markPrice);
        const stopLossPrice = parseNonZeroNumber(rawPosition.stopLoss);
        const notionalUsdt =
          parseNonZeroNumber(rawPosition.positionValue) ??
          round(qty * (markPrice ?? entryPrice), 8);

        if (!instrumentId || !Number.isFinite(entryPrice) || entryPrice <= 0) {
          return null;
        }

        return {
          exchange: 'bybit' as const,
          externalPositionId: `${instrumentId}:${readString(rawPosition.positionIdx, '0')}`,
          instrumentId,
          symbol: normalizeSymbol(instrumentId),
          side,
          qty,
          entryPrice,
          markPrice,
          notionalUsdt,
          unrealizedPnl: parseOptionalNumber(rawPosition.unrealisedPnl),
          stopLossPrice,
          openedAt: null,
          meta: {
            category: 'linear',
            positionIdx: Number(rawPosition.positionIdx ?? 0),
            side: readString(rawPosition.side),
          },
        } satisfies ManagedExchangePosition;
      });

    return mapped.filter(
      (position): position is ManagedExchangePosition => position !== null
    );
  }

  async applyStopLoss(
    position: ManagedExchangePosition,
    stopLossPrice: number
  ): Promise<void> {
    await this.request({
      method: 'POST',
      path: '/v5/position/trading-stop',
      body: {
        category: 'linear',
        symbol: position.instrumentId || symbolToExchangeMarket(position.symbol),
        stopLoss: String(stopLossPrice),
        tpslMode: 'Full',
        positionIdx: Number(position.meta.positionIdx ?? 0),
      },
    });
  }
}

class OkxExchangeClient {
  constructor(private readonly credentials: DecryptedExchangeCredentials) {}

  private async request<T>(options: RequestOptions): Promise<OkxResponse<T>> {
    const method = options.method ?? 'GET';
    const queryString = buildQueryString(options.query);
    const path = queryString ? `${options.path}?${queryString}` : options.path;
    const body = options.body ? JSON.stringify(options.body) : '';
    const timestamp = new Date().toISOString();
    const signature = createHmac('sha256', this.credentials.apiSecret)
      .update(`${timestamp}${method}${path}${body}`)
      .digest('base64');

    const response = await requestJson<OkxResponse<T>>(
      `${OKX_BASE_URL}${path}`,
      (() => {
        const init: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'OK-ACCESS-KEY': this.credentials.apiKey,
            'OK-ACCESS-SIGN': signature,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': this.credentials.apiPassphrase ?? '',
          },
        };

        if (method === 'POST') {
          init.body = body;
        }

        return init;
      })()
    );

    if (response.code !== '0') {
      throw new Error(`OKX error ${response.code}: ${response.msg || 'Unknown error'}`);
    }

    return response;
  }

  async validate(): Promise<void> {
    await this.request({
      path: '/api/v5/account/balance',
      query: {
        ccy: 'USDT',
      },
    });
  }

  async listOpenPositions(): Promise<ManagedExchangePosition[]> {
    const response = await this.request<Array<Record<string, unknown>>>({
      path: '/api/v5/account/positions',
      query: {
        instType: 'SWAP',
      },
    });

    const mapped = response.data.map(
      (rawPosition): ManagedExchangePosition | null => {
        const rawPos = Number(rawPosition.pos ?? 0);
        const qty = Math.abs(rawPos);

        if (!Number.isFinite(qty) || qty <= 0) {
          return null;
        }

        const posSide = readString(rawPosition.posSide, 'net');
        const side =
          posSide === 'short' || (posSide === 'net' && rawPos < 0)
            ? 'SHORT'
            : 'LONG';
        const instrumentId = readString(rawPosition.instId);
        const entryPrice = Number(rawPosition.avgPx ?? 0);
        const stopOrder =
          Array.isArray(rawPosition.closeOrderAlgo) &&
          rawPosition.closeOrderAlgo.length > 0
            ? (rawPosition.closeOrderAlgo[0] as Record<string, unknown>)
            : null;

        if (!instrumentId || !Number.isFinite(entryPrice) || entryPrice <= 0) {
          return null;
        }

        return {
          exchange: 'okx' as const,
          externalPositionId: readString(
            rawPosition.posId,
            `${instrumentId}:${posSide}`
          ),
          instrumentId,
          symbol: normalizeOkxInstrumentSymbol(instrumentId),
          side,
          qty,
          entryPrice,
          markPrice: parseNonZeroNumber(rawPosition.markPx),
          notionalUsdt:
            parseNonZeroNumber(rawPosition.notionalUsd) ??
            round(qty * entryPrice, 8),
          unrealizedPnl: parseOptionalNumber(rawPosition.upl),
          stopLossPrice: stopOrder ? parseNonZeroNumber(stopOrder.slTriggerPx) : null,
          openedAt:
            typeof rawPosition.cTime === 'string' && rawPosition.cTime !== ''
              ? new Date(Number(rawPosition.cTime)).toISOString()
              : null,
          meta: {
            algoId:
              stopOrder && typeof stopOrder.algoId === 'string'
                ? stopOrder.algoId
                : null,
            closeOrderAlgo: Array.isArray(rawPosition.closeOrderAlgo)
              ? rawPosition.closeOrderAlgo
              : [],
            instType: readString(rawPosition.instType, 'SWAP'),
            mgnMode: readString(rawPosition.mgnMode, 'cross'),
            posSide,
          },
        } satisfies ManagedExchangePosition;
      }
    );

    return mapped.filter(
      (position): position is ManagedExchangePosition => position !== null
    );
  }

  async applyStopLoss(
    position: ManagedExchangePosition,
    stopLossPrice: number
  ): Promise<void> {
    const existingAlgoId =
      typeof position.meta.algoId === 'string' && position.meta.algoId !== ''
        ? position.meta.algoId
        : null;

    if (existingAlgoId) {
      await this.request({
        method: 'POST',
        path: '/api/v5/trade/amend-algos',
        body: {
          algoId: existingAlgoId,
          instId: position.instrumentId,
          newSlTriggerPx: String(stopLossPrice),
          newSlOrdPx: '-1',
          newSlTriggerPxType: 'mark',
        },
      });
      return;
    }

    await this.request({
      method: 'POST',
      path: '/api/v5/trade/order-algo',
      body: {
        instId: position.instrumentId,
        tdMode: readString(position.meta.mgnMode, 'cross'),
        side: position.side === 'LONG' ? 'sell' : 'buy',
        posSide: readString(position.meta.posSide, 'net'),
        ordType: 'conditional',
        sz: String(position.qty),
        closeFraction: '1',
        slTriggerPx: String(stopLossPrice),
        slOrdPx: '-1',
        slTriggerPxType: 'mark',
      },
    });
  }
}

export const createExchangeClient = (
  credentials: DecryptedExchangeCredentials
) => {
  if (credentials.exchange === 'bybit') {
    return new BybitExchangeClient(credentials);
  }

  return new OkxExchangeClient(credentials);
};
