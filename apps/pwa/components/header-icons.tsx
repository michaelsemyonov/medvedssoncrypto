type IconProps = {
  className?: string | undefined;
};

function IconBase({
  children,
  className,
}: React.PropsWithChildren<IconProps>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export function DashboardIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </IconBase>
  );
}

export function SignalsIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M4 16h3l3-8 4 10 2-6h4" />
      <circle cx="4" cy="16" r="1" />
      <circle cx="20" cy="12" r="1" />
    </IconBase>
  );
}

export function PositionsIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M6 19V8" />
      <path d="M12 19V5" />
      <path d="M18 19v-9" />
      <rect x="4" y="8" width="4" height="7" rx="1.5" />
      <rect x="10" y="5" width="4" height="10" rx="1.5" />
      <rect x="16" y="10" width="4" height="5" rx="1.5" />
    </IconBase>
  );
}

export function TradesIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M7 7h10" />
      <path d="M7 12h10" />
      <path d="M7 17h10" />
      <path d="m14 4 3 3-3 3" />
      <path d="m10 20-3-3 3-3" />
    </IconBase>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1 0 2.8 2 2 0 0 1-2.8 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .7.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.7Z" />
    </IconBase>
  );
}

export function SignOutIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" />
    </IconBase>
  );
}
