import { randomBytes } from 'node:crypto';

import { NotificationService } from '@medvedsson/notifications';

import { buildTestConfig, silentLogger } from '../helpers.ts';

describe('NotificationService', () => {
  it('does not look up push subscriptions for rejected signals', async () => {
    const vapidKeys = {
      publicKey: randomBytes(65).toString('base64url'),
      privateKey: randomBytes(32).toString('base64url')
    };
    const config = {
      ...buildTestConfig(),
      webPushVapidPublicKey: vapidKeys.publicKey,
      webPushVapidPrivateKey: vapidKeys.privateKey,
      webPushContact: 'mailto:test@example.com'
    };

    const db = {
      getPushSubscriptionsForEvent: vi.fn().mockResolvedValue([]),
      disablePushSubscription: vi.fn()
    };

    const service = new NotificationService(config, db as never, silentLogger);

    await service.notifySignal({
      symbol: 'BTC/USDT',
      signalType: 'LONG_ENTRY',
      signalTime: '2026-01-01T00:05:00.000Z',
      strategyVersion: '1.0.0-test',
      reason: 'Risk guard rejected the entry.',
      approved: false,
      referencePrice: 100
    });

    expect(db.getPushSubscriptionsForEvent).not.toHaveBeenCalled();
  });

  it('looks up entry subscriptions for approved entry signals', async () => {
    const vapidKeys = {
      publicKey: randomBytes(65).toString('base64url'),
      privateKey: randomBytes(32).toString('base64url')
    };
    const config = {
      ...buildTestConfig(),
      webPushVapidPublicKey: vapidKeys.publicKey,
      webPushVapidPrivateKey: vapidKeys.privateKey,
      webPushContact: 'mailto:test@example.com'
    };

    const db = {
      getPushSubscriptionsForEvent: vi.fn().mockResolvedValue([]),
      disablePushSubscription: vi.fn()
    };

    const service = new NotificationService(config, db as never, silentLogger);

    await service.notifySignal({
      symbol: 'BTC/USDT',
      signalType: 'LONG_ENTRY',
      signalTime: '2026-01-01T00:05:00.000Z',
      strategyVersion: '1.0.0-test',
      reason: 'Momentum crossed the threshold.',
      approved: true,
      referencePrice: 100
    });

    expect(db.getPushSubscriptionsForEvent).toHaveBeenCalledWith('BTC/USDT', 'entry');
  });
});
