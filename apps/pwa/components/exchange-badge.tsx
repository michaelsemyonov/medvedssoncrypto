import { ReactNode } from 'react';

type ExchangeName = 'bybit' | 'okx' | 'binance';

type ExchangeBadgeProps = {
  exchange: string;
  compact?: boolean;
};

const EXCHANGE_META: Record<
  ExchangeName,
  {
    label: string;
    className: string;
    iconClassName?: string;
    logo: ReactNode;
  }
> = {
  bybit: {
    label: 'Bybit',
    className: 'exchange-badge-bybit',
    iconClassName: 'exchange-badge-icon-bybit',
    logo: (
      <svg
        aria-hidden="true"
        className="exchange-badge-logo-svg exchange-badge-logo-svg-bybit"
        viewBox="0 0 2500 2500"
      >
        <rect width="2500" height="2500" fill="#0b0b0f" />
        <polygon
          fill="#F7A600"
          points="1622,1408 1622,958 1713,958 1713,1408"
        />
        <path
          fill="#FFFFFF"
          d="M569,1542H375v-450h186c90,0,143,49,143,126c0,50-34,82-57,93c28,13,64,41,64,101c0,84-59,129-142,129V1542z M554,1171h-89v104h89c38,0,60-21,60-52S592,1171,554,1171L554,1171z M560,1354h-94v111h94c41,0,61-25,61-56c0-30-20-55-60-55H560z"
        />
        <polygon
          fill="#FFFFFF"
          points="986,1357 986,1542 896,1542 896,1357 757,1092 856,1092 942,1273 1027,1092 1125,1092"
        />
        <path
          fill="#FFFFFF"
          d="M1382,1542h-194v-450h186c90,0,143,49,143,126c0,50-34,82-57,93c28,13,64,41,64,101c0,84-59,129-142,129V1542z M1367,1171h-88v104h88c38,0,60-21,60-52S1405,1171,1367,1171z M1373,1354h-94v111h94c41,0,61-25,61-56C1434,1379,1414,1354,1373,1354L1373,1354z"
        />
        <polygon
          fill="#FFFFFF"
          points="2004,1170 2004,1542 1914,1542 1914,1170 1793,1170 1793,1092 2125,1092 2125,1170"
        />
      </svg>
    ),
  },
  okx: {
    label: 'OKX',
    className: 'exchange-badge-okx',
    logo: (
      <svg
        aria-hidden="true"
        className="exchange-badge-logo-svg"
        viewBox="0 0 64 64"
      >
        <rect x="4" y="4" width="18" height="18" rx="2" />
        <rect x="24" y="4" width="18" height="18" rx="2" />
        <rect x="24" y="24" width="18" height="18" rx="2" />
        <rect x="44" y="24" width="18" height="18" rx="2" />
        <rect x="4" y="44" width="18" height="18" rx="2" />
        <rect x="24" y="44" width="18" height="18" rx="2" />
        <rect x="44" y="44" width="18" height="18" rx="2" />
      </svg>
    ),
  },
  binance: {
    label: 'Binance',
    className: 'exchange-badge-binance',
    logo: (
      <svg
        aria-hidden="true"
        className="exchange-badge-logo-svg"
        viewBox="0 0 64 64"
      >
        <path d="M32 8 44 20 32 32 20 20 32 8Z" />
        <path d="M20 20 28 28 20 36 12 28 20 20Z" />
        <path d="M44 20 52 28 44 36 36 28 44 20Z" />
        <path d="M32 32 40 40 32 48 24 40 32 32Z" />
        <path d="M32 24 40 32 32 40 24 32 32 24Z" />
      </svg>
    ),
  },
};

export function ExchangeBadge({
  exchange,
  compact = false,
}: ExchangeBadgeProps) {
  const normalized = exchange.toLowerCase() as ExchangeName;
  const meta = EXCHANGE_META[normalized] ?? {
    label: exchange.toUpperCase(),
    className: 'exchange-badge-generic',
    logo: <span aria-hidden="true">{exchange.slice(0, 2).toUpperCase()}</span>,
  };

  return (
    <span className="exchange-badge">
      <span
        className={[
          'exchange-badge-icon',
          meta.className,
          meta.iconClassName ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {meta.logo}
      </span>
      {compact ? null : <span className="exchange-badge-label">{meta.label}</span>}
    </span>
  );
}
