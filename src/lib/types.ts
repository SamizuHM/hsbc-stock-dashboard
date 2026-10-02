import { z } from 'zod';

export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    '日期無效',
  );
export const noticeSchema = z.object({
  id: z.string().max(160),
  orderId: z.string().min(1).max(100),
  timestamp: z.string().datetime({ offset: true }),
  date: daySchema,
  symbol: z.string().regex(/^[A-Z0-9.^=-]{1,24}$/),
  name: z.string().max(200).default(''),
  side: z.enum(['B', 'S']),
  quantity: z.number().finite().nonnegative(),
  price: z.number().finite().nonnegative(),
  cumulative: z.number().finite().nonnegative().nullable().default(null),
  status: z.string().max(100),
  currency: z.literal('USD').default('USD'),
  timeBasis: z.string().max(200).default('郵件通知時間，作為成交時間代理'),
});
export type Notice = z.infer<typeof noticeSchema>;
export type Bar = {
  time: string;
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedOpen?: number;
  adjustedHigh?: number;
  adjustedLow?: number;
  adjustedClose?: number;
  totalReturnClose?: number;
  splitFactor?: number;
};
export type Split = { date: string; ratio: number };
export type Session = {
  price: number;
  change: number | null;
  changePercent: number | null;
  time: string;
  label: string;
};
export type Market = {
  symbol: string;
  name: string;
  bars: Bar[];
  splits: Split[];
  quote?: Session;
  sessions?: Partial<Record<'regular' | 'pre' | 'post' | 'overnight', Session>>;
  fetchedAt?: string;
  error?: string;
};
export const cashEventSchema = z.object({
  id: z.string(),
  date: daySchema,
  type: z.enum(['deposit', 'withdrawal', 'dividend']),
  amount: z.number().finite().positive(),
  symbol: z.string().optional(),
  note: z.string().max(200).optional(),
});
export type CashEvent = z.infer<typeof cashEventSchema>;
export type Dataset = {
  version: 1;
  id: string;
  label: string;
  mode: 'demo' | 'local' | 'imported';
  notices: Notice[];
  markets: Record<string, Market>;
  initialCash: number | null;
  cashFlowsComplete: boolean;
  cashEvents: CashEvent[];
  updatedAt: string;
};
export type Preferences = {
  colorMode: 'green' | 'red';
  badgeMode: 'change' | 'price';
  badgeSession: 'auto' | 'regular' | 'pre' | 'post' | 'overnight';
  refreshSeconds: number;
  showMA: boolean;
  maPeriods: number[];
  showVolume: boolean;
  showCost: boolean;
  showTrades: boolean;
  showRSI: boolean;
  showMACD: boolean;
  showVWAP: boolean;
  showAlertLines: boolean;
  showTrade25: boolean;
  hkdRate: number;
  otherTurnover: Record<string, number>;
  benchmark: 'SPY' | 'QQQ';
  priceBasis: 'adjusted' | 'raw';
};
export const defaultPreferences: Preferences = {
  colorMode: 'green',
  badgeMode: 'change',
  badgeSession: 'auto',
  refreshSeconds: 60,
  showMA: true,
  maPeriods: [5, 20, 60],
  showVolume: true,
  showCost: true,
  showTrades: true,
  showRSI: false,
  showMACD: false,
  showVWAP: false,
  showAlertLines: false,
  showTrade25: true,
  hkdRate: 7.8,
  otherTurnover: {},
  benchmark: 'SPY',
  priceBasis: 'adjusted',
};
export type AlertRule = {
  id: string;
  symbol: string;
  kind: 'above' | 'below' | 'profit' | 'loss';
  threshold: number;
  enabled: boolean;
  triggeredAt?: string;
};
export type Interval = '1m' | '5m' | '15m' | '1d' | '1wk' | '1mo';
export const fills = (data: Dataset) =>
  data.notices
    .filter((n) => n.quantity > 0 && n.price > 0)
    .sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp) || (a.cumulative ?? 0) - (b.cumulative ?? 0),
    );
export const marketDay = (date: Date | string | number, zone = 'America/New_York') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
export const number = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const signed = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${number(v, digits)}`;
export const tone = (v: number | null | undefined) =>
  v == null || v === 0 ? 'neutral' : v > 0 ? 'positive' : 'negative';
export const identity = (n: Notice) =>
  [
    n.orderId,
    new Date(n.timestamp).toISOString(),
    n.symbol,
    n.side,
    n.quantity,
    n.price,
    n.cumulative ?? '',
    n.status,
  ].join('|');
