import { Dataset, Market, Notice } from './types';

// 所有示例都由固定種子合成，不含任何個人交易或真實行情。
export function demoDataset(): Dataset {
  const days: string[] = [];
  for (
    let d = new Date('2026-01-05T12:00:00Z');
    days.length < 180;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  let seed = 73991;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const markets: Record<string, Market> = {};
  for (const [symbol, name, start, trend] of [
    ['AAPL', 'Apple · 模擬', 185, 0.0008],
    ['MSFT', 'Microsoft · 模擬', 405, 0.00065],
    ['NVDA', 'NVIDIA · 模擬', 112, 0.0012],
    ['SPY', 'S&P 500 ETF · 模擬', 590, 0.0004],
    ['QQQ', 'Nasdaq 100 ETF · 模擬', 505, 0.0006],
  ] as const) {
    let previous: number = start;
    const bars = days.map((time, i) => {
      const open = previous * (1 + (random() - 0.5) * 0.008),
        close = open * (1 + trend + (random() - 0.48) * 0.024 + Math.sin(i / 17) * 0.001),
        high = Math.max(open, close) * (1 + random() * 0.01),
        low = Math.min(open, close) * (1 - random() * 0.01);
      previous = close;
      return { time, open, high, low, close, volume: Math.round(12000000 + random() * 50000000) };
    });
    const last = bars.at(-1)!,
      prior = bars.at(-2)!;
    const quote = {
      price: last.close,
      change: last.close - prior.close,
      changePercent: (last.close / prior.close - 1) * 100,
      time: days.at(-1) + 'T20:00:00Z',
      label: '日盤 · 模擬',
    };
    markets[symbol] = {
      symbol,
      name,
      bars,
      splits: [],
      quote,
      sessions: {
        regular: quote,
        post: {
          ...quote,
          price: quote.price * 1.0018,
          change: quote.price * 0.0018,
          changePercent: 0.18,
          time: days.at(-1) + 'T22:00:00Z',
          label: '盤後 · 模擬',
        },
      },
      fetchedAt: days.at(-1) + 'T22:00:00Z',
    };
  }
  const notices: Notice[] = [];
  for (const [symbol, index, side, quantity] of [
    ['AAPL', 6, 'B', 18],
    ['MSFT', 10, 'B', 8],
    ['NVDA', 16, 'B', 25],
    ['AAPL', 45, 'B', 6],
    ['NVDA', 64, 'S', 8],
    ['AAPL', 87, 'S', 9],
    ['MSFT', 105, 'B', 4],
    ['NVDA', 135, 'B', 6],
    ['AAPL', 151, 'B', 4],
    ['MSFT', 165, 'S', 3],
  ] as const) {
    const b = markets[symbol].bars[index];
    notices.push({
      id: `demo-${notices.length}`,
      orderId: `DEMO-${String(notices.length + 1).padStart(4, '0')}`,
      symbol,
      name: markets[symbol].name,
      side,
      quantity,
      price: Number(b.close.toFixed(2)),
      date: b.time,
      timestamp: b.time + 'T15:00:00Z',
      cumulative: quantity,
      status: '全部執行',
      currency: 'USD',
      timeBasis: '合成示例，非真實成交',
    });
  }
  return {
    version: 1,
    id: 'demo-v1',
    label: '示例投資組合',
    mode: 'demo',
    notices,
    markets,
    initialCash: 15000,
    cashFlowsComplete: true,
    cashEvents: [
      { id: 'demo-deposit', date: days[95], type: 'deposit', amount: 2000, note: '模擬追加本金' },
    ],
    updatedAt: days.at(-1) + 'T22:00:00Z',
  };
}
