import { Tag } from 'antd';

type EyebrowProps = {
  children: React.ReactNode;
};

type StatusTone = 'default' | 'danger' | 'success' | 'warning';

type StatusTagProps = {
  children: React.ReactNode;
  tone?: StatusTone;
};

export function Eyebrow({ children }: EyebrowProps) {
  return <div className="eyebrow">{children}</div>;
}

export function StatusTag({ children, tone = 'default' }: StatusTagProps) {
  return (
    <Tag
      bordered={false}
      className={['status-tag', `status-tag-${tone}`].join(' ')}
    >
      {children}
    </Tag>
  );
}
