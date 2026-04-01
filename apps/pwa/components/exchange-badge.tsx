type ExchangeName = 'bybit' | 'okx' | 'binance';

type ExchangeBadgeProps = {
  exchange: string;
  compact?: boolean;
};

const EXCHANGE_META: Record<
  ExchangeName,
  {
    label: string;
    short: string;
    className: string;
  }
> = {
  bybit: {
    label: 'Bybit',
    short: 'BY',
    className: 'exchange-badge-bybit',
  },
  okx: {
    label: 'OKX',
    short: 'OK',
    className: 'exchange-badge-okx',
  },
  binance: {
    label: 'Binance',
    short: 'BN',
    className: 'exchange-badge-binance',
  },
};

export function ExchangeBadge({
  exchange,
  compact = false,
}: ExchangeBadgeProps) {
  const normalized = exchange.toLowerCase() as ExchangeName;
  const meta = EXCHANGE_META[normalized] ?? {
    label: exchange.toUpperCase(),
    short: exchange.slice(0, 2).toUpperCase(),
    className: 'exchange-badge-generic',
  };

  return (
    <span className="exchange-badge">
      <span className={`exchange-badge-icon ${meta.className}`}>
        {meta.short}
      </span>
      {compact ? null : <span className="exchange-badge-label">{meta.label}</span>}
    </span>
  );
}
