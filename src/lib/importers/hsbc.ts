import PostalMime from 'postal-mime';
import {
  Dataset,
  Market,
  Notice,
  cashEventSchema,
  identity,
  marketDay,
  noticeSchema,
} from '../types';

type Json = Record<string, any>;
export type ImportCandidate = { source: string; notice: Partial<Notice>; errors: string[] };
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
export function fromLegacy(input: Json, mode: Dataset['mode'] = 'imported'): Dataset {
  if (input.version === 1 && Array.isArray(input.notices) && input.markets) {
    const notices = input.notices.map((n: unknown) => noticeSchema.parse(n));
    return {
      version: 1,
      id: String(input.id ?? 'imported').slice(0, 100),
      label: String(input.label ?? '匯入交易').slice(0, 100),
      mode,
      notices,
      markets: cleanMarkets(input.markets),
      initialCash: finite(input.initialCash) && input.initialCash >= 0 ? input.initialCash : null,
      cashFlowsComplete: input.cashFlowsComplete === true,
      cashEvents: (input.cashEvents ?? []).map((e: unknown) => cashEventSchema.parse(e)),
      updatedAt: new Date().toISOString(),
    };
  }
  const rows = Array.isArray(input) ? input : input.notices;
  if (!Array.isArray(rows)) throw new Error('JSON 需要 notices 陣列或本應用匯出格式');
  const notices = rows.map((r: Json) =>
    noticeSchema.parse({
      id: String(r.event_id ?? r.id ?? ''),
      orderId: String(r.order_id ?? r.orderId ?? ''),
      timestamp: r.notice_time ?? r.timestamp,
      date: r.market_date ?? r.date ?? marketDay(r.notice_time),
      symbol: r.symbol,
      name: r.instrument_name ?? r.name ?? '',
      side: r.side,
      quantity: r.fill_qty ?? r.quantity ?? 0,
      price: r.fill_price ?? r.price ?? 0,
      cumulative: r.cumulative_qty ?? r.cumulative ?? null,
      status: r.status ?? '已執行',
      currency: r.currency ?? 'USD',
      timeBasis: r.time_basis,
    }),
  );
  const markets: Record<string, Market> = {};
  for (const [symbol, value] of Object.entries(input.prices ?? {})) {
    const p = value as Json,
      m = p.meta ?? {},
      bars = (p.bars ?? []).map((b: Json) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
        adjustedOpen: b.yahoo_open,
        adjustedHigh: b.yahoo_high,
        adjustedLow: b.yahoo_low,
        adjustedClose: b.yahoo_close,
        splitFactor: b.split_factor,
      }));
    const date = m.regularMarketTime ? marketDay(m.regularMarketTime * 1000) : '',
      base = bars.filter((b: Json) => b.time < date).at(-1)?.adjustedClose,
      price = m.regularMarketPrice;
    const quote =
      finite(price) && m.regularMarketTime
        ? {
            price,
            change: base ? price - base : null,
            changePercent: base ? (price / base - 1) * 100 : null,
            time: new Date(m.regularMarketTime * 1000).toISOString(),
            label: '日盤',
          }
        : undefined;
    const sessions: Market['sessions'] = { regular: quote };
    for (const [key, v] of Object.entries(input.session_quotes?.[symbol]?.sessions ?? {})) {
      const q = v as Json;
      if (q && ['pre', 'post', 'overnight'].includes(key) && finite(q.price) && q.quote_time)
        sessions[key as 'pre' | 'post' | 'overnight'] = {
          price: q.price,
          change: q.change ?? null,
          changePercent: q.change_percent ?? null,
          time: q.quote_time,
          label: key === 'pre' ? '盤前' : key === 'post' ? '盤後' : '隔夜',
        };
    }
    markets[symbol] = {
      symbol: p.price_symbol ?? symbol,
      name: m.longName ?? m.shortName ?? symbol,
      bars,
      splits: Object.values(p.events?.splits ?? {}).map((s: any) => ({
        date: marketDay(s.date * 1000),
        ratio: Number(s.numerator) / Number(s.denominator),
      })),
      quote,
      sessions,
      fetchedAt: p.retrieved_at,
      error: p.error || undefined,
    };
  }
  return {
    version: 1,
    id: 'hsbc-local',
    label: '我的交易記錄',
    mode,
    notices,
    markets: cleanMarkets(markets),
    initialCash: null,
    cashFlowsComplete: false,
    cashEvents: [],
    updatedAt: input.summary?.generated_at ?? new Date().toISOString(),
  };
}
function cleanMarkets(input: Json): Record<string, Market> {
  const out: Record<string, Market> = {};
  for (const [symbol, value] of Object.entries(input).slice(0, 200)) {
    if (!/^[A-Z0-9.^=-]{1,24}$/.test(symbol)) continue;
    const m = value as Market;
    const bars = (m.bars ?? [])
      .slice(-20000)
      .filter(
        (b) =>
          /^\d{4}-\d{2}-\d{2}$/.test(b.time) &&
          [b.open, b.high, b.low, b.close, b.volume].every(finite) &&
          b.low > 0 &&
          b.high >= b.low &&
          b.high >= Math.max(b.open, b.close) &&
          b.low <= Math.min(b.open, b.close),
      );
    out[symbol] = {
      symbol: /^[A-Z0-9.^=-]{1,24}$/.test(m.symbol) ? m.symbol : symbol,
      name: String(m.name ?? symbol).slice(0, 200),
      bars: [...new Map(bars.map((b) => [b.time, b])).values()].sort((a, b) =>
        a.time.localeCompare(b.time),
      ),
      splits: (m.splits ?? []).filter(
        (s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && finite(s.ratio) && s.ratio > 0,
      ),
      quote:
        m.quote && finite(m.quote.price) && !Number.isNaN(Date.parse(m.quote.time))
          ? m.quote
          : undefined,
      sessions: m.sessions,
      fetchedAt: m.fetchedAt,
      error: m.error,
    };
  }
  return out;
}
export function parseText(raw: string, source = '貼上正文', mailDate?: string): ImportCandidate {
  // 模板規則只採用明確欄位；不把累計成交量當成本次成交量。
  const text = raw
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/[\u200b\u00a0]/g, ' ');
  const field = (labels: string) => {
    const value = text
      .match(
        new RegExp(
          `(?:^|\\n|\\t)[ \\t]*(?:${labels})[ \\t]*[:：]?[ \\t]*(?:\\n[ \\t]*)?([^\\n\\t]+)`,
          'im',
        ),
      )?.[1]
      ?.trim();
    return value && /^[^:：]{1,35}[:：]/.test(value) && !/^\d{4}-\d{2}-\d{2}T/.test(value)
      ? undefined
      : value;
  };
  const numeric = (value?: string) => {
    if (!value) return undefined;
    const m = value.replace(/,/g, '').match(/(?:USD|US\$|\$)?\s*([0-9]+(?:\.[0-9]+)?)/i);
    return m ? Number(m[1]) : undefined;
  };
  const symbol = field('股票代碼|股票代码|證券代號|证券代号|Stock Code|Stock Symbol|Symbol')
    ?.match(/[A-Z][A-Z0-9.^=-]{0,23}/i)?.[0]
    ?.toUpperCase();
  const direction = field(
    '買賣方向|买卖方向|買入[／/]賣出|买入[／/]卖出|交易類別|交易类别|Buy[ /]+Sell|Side',
  );
  const side =
    direction && /買|买|buy|^b$/i.test(direction)
      ? 'B'
      : direction && /賣|卖|sell|^s$/i.test(direction)
        ? 'S'
        : undefined;
  const quantity = numeric(
    field(
      '本次成交數量|本次成交数量|是次成交數量|是次已執行股數|本次已執行數量|Executed Quantity \(this execution\)|Last Executed Quantity|Filled Quantity|Quantity Executed',
    ),
  );
  const price = numeric(
    field(
      '本次成交價格|本次成交价格|成交價格|成交价格|是次成交價|執行價格|执行价格|Execution Price|Executed Price|Fill Price',
    ),
  );
  const cumulative =
    numeric(
      field('累計成交數量|累计成交数量|累計已執行數量|Cumulative Quantity|Total Executed Quantity'),
    ) ?? null;
  const rawDate =
    field(
      '通知時間|通知时间|成交時間|成交时间|交易時間|交易时间|Date and Time|Execution Time|Trade Time',
    ) ?? mailDate;
  let timestamp: string | undefined;
  if (rawDate) {
    const iso = rawDate.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/);
    if (iso && !Number.isNaN(Date.parse(iso[0]))) timestamp = new Date(iso[0]).toISOString();
    else if (mailDate === rawDate && !Number.isNaN(Date.parse(rawDate)))
      timestamp = new Date(rawDate).toISOString();
  }
  const status = field('通知狀態|通知状态|訂單狀態|订单状态|Order Status|Status') ?? '狀態待確認';
  const currencyField = field('交易貨幣|交易货币|Currency'),
    unsupportedCurrency = !!currencyField && !/USD|美元|US\$/i.test(currencyField);
  const notice: Partial<Notice> = {
    id: '',
    orderId: field(
      '訂單編號|订单编号|參考編號|参考编号|Order Number|Order No\.?|Order Reference|Reference Number',
    ),
    symbol,
    side,
    quantity,
    price,
    cumulative,
    status,
    timestamp,
    date: timestamp ? marketDay(timestamp) : undefined,
    name: field('股票名稱|股票名称|證券名稱|证券名称|Stock Name') ?? '',
    currency: unsupportedCurrency ? ('unsupported' as 'USD') : 'USD',
  };
  const errors: string[] = [];
  if (!symbol) errors.push('股票代碼');
  if (!side) errors.push('買賣方向');
  if (!notice.orderId) errors.push('訂單編號');
  if (quantity == null) errors.push('本次成交數量');
  if (price == null) errors.push('成交價');
  if (!timestamp) errors.push('含時區的通知時間');
  if (unsupportedCurrency) errors.push('目前僅支持 USD 交易');
  return { source, notice, errors };
}
export async function parseFile(file: File): Promise<ImportCandidate[]> {
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} 超過 5 MB`);
  if (/\.eml$/i.test(file.name)) {
    const email = await PostalMime.parse(await file.arrayBuffer());
    let body = email.text ?? '';
    if (!body && email.html) {
      const doc = new DOMParser().parseFromString(email.html, 'text/html');
      doc.querySelectorAll('script,style').forEach((n) => n.remove());
      doc.querySelectorAll('br,td,p,div,tr').forEach((n) => n.append('\n'));
      body = doc.body.textContent ?? '';
    }
    return [parseText(body, file.name, email.date)];
  }
  if (/\.json$/i.test(file.name)) {
    const json = JSON.parse(await file.text()),
      data = fromLegacy(json);
    return data.notices.map((notice) => ({ source: file.name, notice, errors: [] }));
  }
  if (!/\.txt$/i.test(file.name))
    throw new Error('支援 .eml、.txt、.json；.eml 是包含郵件標頭和正文的原始郵件檔');
  return [parseText(await file.text(), file.name)];
}
export function mergeNotices(existing: Notice[], incoming: Notice[]) {
  const map = new Map(existing.map((n) => [identity(n), n]));
  const before = map.size;
  for (const n of incoming) {
    const clean = noticeSchema.parse(n),
      key = identity(clean);
    if (!map.has(key)) map.set(key, { ...clean, id: clean.id || key });
  }
  return {
    notices: [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    added: map.size - before,
  };
}
