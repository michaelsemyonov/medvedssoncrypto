import type { MedvedssonDatabase } from '@medvedsson/db';
import type { AppConfig, SignalType } from '@medvedsson/shared';
import webpush from 'web-push';

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type PushEventType = 'entry' | 'exit' | 'risk_rejection' | 'runner_error';

export class NotificationService {
  private readonly db: MedvedssonDatabase;
  private readonly logger: LoggerLike;
  private readonly enabled: boolean;
  private readonly onDeliveryFailure: () => void;

  constructor(
    config: AppConfig,
    db: MedvedssonDatabase,
    logger: LoggerLike,
    onDeliveryFailure: () => void = () => undefined
  ) {
    this.db = db;
    this.logger = logger;
    this.onDeliveryFailure = onDeliveryFailure;
    this.enabled =
      Boolean(config.webPushVapidPublicKey) &&
      Boolean(config.webPushVapidPrivateKey) &&
      Boolean(config.webPushContact);

    if (this.enabled) {
      webpush.setVapidDetails(
        config.webPushContact,
        config.webPushVapidPublicKey,
        config.webPushVapidPrivateKey
      );
    }
  }

  private getEventType(signalType: SignalType, approved: boolean): PushEventType {
    if (!approved) {
      return 'risk_rejection';
    }

    if (signalType === 'LONG_ENTRY' || signalType === 'SHORT_ENTRY') {
      return 'entry';
    }

    if (signalType === 'LONG_EXIT' || signalType === 'SHORT_EXIT') {
      return 'exit';
    }

    return 'risk_rejection';
  }

  async notifySignal(params: {
    symbol: string;
    signalType: SignalType;
    signalTime: string;
    strategyVersion: string;
    reason: string;
    approved: boolean;
    referencePrice?: number;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const eventType = this.getEventType(params.signalType, params.approved);
    const subscriptions = await this.db.getPushSubscriptionsForEvent(params.symbol, eventType);

    if (subscriptions.length === 0) {
      return;
    }

    const title = `${params.symbol} ${params.signalType.replace('_', ' ')}`;
    const body = params.approved
      ? `${params.reason} Next-open dry-run execution scheduled.`
      : `Rejected: ${params.reason}`;
    const payload = JSON.stringify({
      title,
      body,
      data: {
        symbol: params.symbol,
        signalType: params.signalType,
        signalTime: params.signalTime,
        strategyVersion: params.strategyVersion,
        approved: params.approved,
        referencePrice: params.referencePrice ?? null
      }
    });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
              }
            },
            payload
          );
        } catch (error) {
          this.onDeliveryFailure();
          this.logger.error({ error, endpoint: subscription.endpoint }, 'Push delivery failed.');

          const statusCode = Number((error as { statusCode?: number })?.statusCode ?? 0);

          if (statusCode === 404 || statusCode === 410) {
            await this.db.disablePushSubscription(subscription.endpoint);
          }
        }
      })
    );
  }

  async notifyRunnerError(message: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const subscriptions = await this.db.getPushSubscriptionsForEvent('*', 'runner_error');

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
              }
            },
            JSON.stringify({
              title: 'Medvedsson runner error',
              body: message,
              data: {
                severity: 'error'
              }
            })
          );
        } catch (error) {
          this.onDeliveryFailure();
          this.logger.error({ error }, 'Runner error notification failed.');
        }
      })
    );
  }
}
