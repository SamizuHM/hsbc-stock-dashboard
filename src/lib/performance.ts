import { Dataset, fills } from './types';

export type PerformancePoint = {
  date: string;
  equity: number;
  pnl: number;
  account: number;
  benchmark: number | null;
  drawdown: number;
  benchmarkDrawdown: number | null;
  cash: number;
};
export function performance(data: Dataset, benchmarkSymbol: string) {
  const trades = fills(data),
    first = trades[0]?.date;
  if (!first)
    return {
      points: [] as PerformancePoint[],
      initial: 0,
      estimated: true,
      issues: ['還沒有成交記錄'],
      maxDrawdown: 0,
    };
  const cashEvents = data.cashEvents
    .filter((e) => e.date >= first)
    .sort((a, b) => a.date.localeCompare(b.date));
  const symbols = [...new Set(trades.map((t) => t.symbol))],
    issues: string[] = [];
  // 最低本金只用作估算，並非真實投入資本。沒有價格時不合成淨值。
  let spent = 0,
    required = 0,
    flowIndex = 0;
  for (const trade of trades) {
    while (flowIndex < cashEvents.length && cashEvents[flowIndex].date <= trade.date) {
      const event = cashEvents[flowIndex++];
      spent -= event.amount * (event.type === 'withdrawal' ? -1 : 1);
      required = Math.max(required, spent);
    }
    spent += (trade.side === 'B' ? 1 : -1) * trade.quantity * trade.price;
    required = Math.max(required, spent);
  }
  const initial = data.initialCash ?? required,
    estimated = data.initialCash == null || !data.cashFlowsComplete;
  if (initial <= 0 && !cashEvents.some((e) => e.date <= first && e.type === 'deposit'))
    return {
      points: [] as PerformancePoint[],
      initial,
      estimated: true,
      issues: ['本金不足，請補錄期初現金及資金流水'],
      maxDrawdown: 0,
    };
  const benchmark = data.markets[benchmarkSymbol],
    allDays = [
      ...new Set(
        [...symbols, benchmarkSymbol].flatMap((s) =>
          (data.markets[s]?.bars ?? []).filter((b) => b.time >= first).map((b) => b.time),
        ),
      ),
    ].sort();
  const lastTrade = trades.at(-1)?.date ?? first;
  if (data.cashEvents.some((e) => e.date < first))
    issues.push('首筆成交之前的流水未計入，請將其反映在「首筆買入之前的期初現金」中');
  if (!allDays.length || allDays.at(-1)! < lastTrade)
    issues.push('部分成交日之後的歷史行情尚未補齊');
  const firstBenchmark = benchmark?.bars.find((b) => b.time >= first)?.time;
  const benchmarkCovered = firstBenchmark === allDays[0];
  if (firstBenchmark && !benchmarkCovered) issues.push('基準未覆蓋收益起點，暫不顯示比較曲線');
  const barMaps = new Map(
    [...symbols, benchmarkSymbol].map((s) => [
      s,
      new Map((data.markets[s]?.bars ?? []).map((b) => [b.time, b])),
    ]),
  );
  const quantity: Record<string, number> = {},
    lastPrice: Record<string, number> = {},
    applied = new Set<string>();
  let cash = initial,
    previous = initial,
    index = 1,
    peak = 1,
    bmShares = 0,
    bmCash = initial,
    bmPrevious = initial,
    bmIndex = 1,
    bmPeak = 1,
    bmStarted = false,
    netFlows = 0,
    ti = 0,
    ci = 0,
    minimumCash = initial,
    invalid = false,
    bmInvalid = !benchmarkCovered;
  const points: PerformancePoint[] = [];
  for (const day of allDays) {
    let flow = 0;
    while (ci < cashEvents.length && cashEvents[ci].date <= day) {
      const e = cashEvents[ci++],
        amount = e.amount * (e.type === 'withdrawal' ? -1 : 1);
      cash += amount;
      if (e.type !== 'dividend') flow += amount;
    }
    netFlows += flow;
    bmCash += flow;
    minimumCash = Math.min(minimumCash, cash);
    for (const s of symbols)
      for (const split of data.markets[s]?.splits ?? []) {
        const key = `${s}:${split.date}`;
        if (split.date <= day && !applied.has(key)) {
          quantity[s] = (quantity[s] ?? 0) * split.ratio;
          applied.add(key);
        }
      }
    while (ti < trades.length && trades[ti].date <= day) {
      const t = trades[ti++],
        direction = t.side === 'B' ? 1 : -1;
      quantity[t.symbol] = (quantity[t.symbol] ?? 0) + direction * t.quantity;
      cash -= direction * t.quantity * t.price;
      if (quantity[t.symbol] < -1e-8) {
        invalid = true;
        issues.push(`${t.symbol} 持倉無法還原，請補漏單`);
      }
      minimumCash = Math.min(minimumCash, cash);
    }
    let equity = cash,
      covered = true;
    for (const s of symbols) {
      const b = barMaps.get(s)?.get(day);
      if (b) lastPrice[s] = b.close;
      const qty = quantity[s] ?? 0;
      if (qty > 1e-8 && !lastPrice[s]) covered = false;
      else equity += qty * (lastPrice[s] ?? 0);
    }
    const bmBar = barMaps.get(benchmarkSymbol)?.get(day);
    if (bmBar) {
      const open = bmBar.adjustedOpen ?? bmBar.open;
      if (open > 0) {
        bmShares += bmCash / open;
        bmCash = 0;
        bmStarted = true;
      }
      if (bmShares < 0) bmInvalid = true;
    }
    const bmClose = bmBar?.adjustedClose ?? bmBar?.close;
    if (bmClose != null) lastPrice['__benchmark'] = bmClose;
    const bmEquity = bmShares * (lastPrice['__benchmark'] ?? 0) + bmCash;
    if (!covered) {
      invalid = true;
      issues.push(`${day} 缺少持倉價格，收益曲線暫不可計算`);
      continue;
    }
    if (previous + flow <= 0) {
      invalid = true;
      issues.push('資金流水使收益率分母不為正，請核對');
      continue;
    }
    index *= equity / (previous + flow);
    peak = Math.max(peak, index);
    if (bmPrevious + flow > 0) bmIndex *= bmEquity / (bmPrevious + flow);
    else bmInvalid = true;
    bmPeak = Math.max(bmPeak, bmIndex);
    points.push({
      date: day,
      equity,
      pnl: equity - initial - netFlows,
      account: (index - 1) * 100,
      benchmark: bmStarted && !bmInvalid ? (bmIndex - 1) * 100 : null,
      drawdown: (index / peak - 1) * 100,
      benchmarkDrawdown: bmStarted && !bmInvalid ? (bmIndex / bmPeak - 1) * 100 : null,
      cash,
    });
    previous = equity;
    bmPrevious = bmEquity;
  }
  if (minimumCash < -0.01)
    issues.push(`記錄推算的現金曾為負數（最低 $${minimumCash.toFixed(2)}），可能缺少入金`);
  if (!benchmark?.bars.length) issues.push('基準歷史行情尚未取得');
  if (cashEvents.some((e) => e.type === 'dividend'))
    issues.push('帳戶包含已補錄淨股息；基準為價格回報，未含股息，兩者口徑有差異');
  return {
    points: invalid ? [] : points,
    initial,
    estimated: estimated || minimumCash < -0.01 || data.cashEvents.some((e) => e.date < first),
    issues: [...new Set(issues)],
    maxDrawdown: Math.min(0, ...points.map((p) => p.drawdown)),
    minimumCash,
  };
}
