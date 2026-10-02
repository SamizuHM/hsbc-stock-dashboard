import Decimal from 'decimal.js';
import { Dataset, fills, marketDay } from './types';

export type Position = {
  symbol: string;
  name: string;
  quantity: number;
  cost: number | null;
  averageCost: number | null;
  price: number | null;
  marketValue: number | null;
  unrealized: number | null;
  realized: number | null;
  total: number | null;
  returnPercent: number | null;
  issues: string[];
  quoteTime?: string;
};
export function positions(data: Dataset): Position[] {
  const trades = fills(data),
    symbols = [...new Set(trades.map((t) => t.symbol))];
  return symbols.map((symbol) => {
    const list = trades.filter((t) => t.symbol === symbol),
      market = data.markets[symbol];
    const splits = (market?.splits ?? [])
      .filter((s) => s.date <= marketDay(Date.now()))
      .sort((a, b) => a.date.localeCompare(b.date));
    let quantity = new Decimal(0),
      cost = new Decimal(0),
      realized = new Decimal(0),
      si = 0;
    const issues: string[] = [];
    for (const trade of list) {
      while (si < splits.length && splits[si].date <= trade.date)
        quantity = quantity.mul(splits[si++].ratio);
      const qty = new Decimal(trade.quantity),
        amount = qty.mul(trade.price);
      if (trade.side === 'B') {
        quantity = quantity.add(qty);
        cost = cost.add(amount);
      } else if (qty.gt(quantity.add('0.000000001'))) {
        issues.push('賣出超過可還原持倉，請補漏單或期初持倉');
        quantity = quantity.sub(qty);
      } else {
        const released = quantity.gt(0) ? cost.mul(qty).div(quantity) : new Decimal(0);
        realized = realized.add(amount.sub(released));
        cost = cost.sub(released);
        quantity = quantity.sub(qty);
        if (quantity.abs().lt('0.000000001')) {
          quantity = new Decimal(0);
          cost = new Decimal(0);
        }
      }
    }
    while (si < splits.length) quantity = quantity.mul(splits[si++].ratio);
    const price = market?.quote?.price ?? market?.bars.at(-1)?.close ?? null,
      qty = quantity.toNumber(),
      valid = !issues.length;
    const mv = qty === 0 ? 0 : price != null ? quantity.mul(price).toNumber() : null,
      unrealized = valid && mv != null ? new Decimal(mv).sub(cost).toNumber() : null;
    return {
      symbol,
      name: list[0].name || market?.name || symbol,
      quantity: qty,
      cost: valid ? cost.toNumber() : null,
      averageCost: valid && qty > 0 ? cost.div(quantity).toNumber() : null,
      price,
      marketValue: mv,
      unrealized,
      realized: valid ? realized.toNumber() : null,
      total: valid && unrealized != null ? realized.add(unrealized).toNumber() : null,
      returnPercent:
        valid && unrealized != null && cost.gt(0)
          ? new Decimal(unrealized).div(cost).mul(100).toNumber()
          : null,
      issues,
      quoteTime: market?.quote?.time,
    };
  });
}
export function monthlyTurnover(data: Dataset, month: string, rate: number, other = 0) {
  const trades = fills(data).filter(
    (t) => marketDay(t.timestamp, 'Asia/Hong_Kong').slice(0, 7) === month,
  );
  const total = trades.reduce(
    (v, t) => v.add(new Decimal(t.quantity).mul(t.price)),
    new Decimal(0),
  );
  return {
    usd: total.toNumber(),
    hkd: total.mul(rate).add(other).toNumber(),
    count: trades.length,
    limit: 250000,
  };
}
