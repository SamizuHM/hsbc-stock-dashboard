'use client';
import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUpRight, Wallet } from 'lucide-react';
import { Dataset, Preferences, marketDay, number, signed, tone } from '@/lib/types';
import { positions, monthlyTurnover, Position } from '@/lib/ledger';
import { Metric } from './ui';
export default function PortfolioView({
  data,
  prefs,
  onPrefs,
  onStock,
}: {
  data: Dataset;
  prefs: Preferences;
  onPrefs: (p: Partial<Preferences>) => void;
  onStock: (s: string) => void;
}) {
  const rows = useMemo(() => positions(data), [data]),
    [sorting, setSorting] = useState<SortingState>([{ id: 'quantity', desc: true }]),
    [month, setMonth] = useState(marketDay(Date.now(), 'Asia/Hong_Kong').slice(0, 7));
  const columns = useMemo<ColumnDef<Position>[]>(
    () => [
      {
        accessorKey: 'symbol',
        header: '股票',
        cell: (info) => (
          <button className="symbol-link" onClick={() => onStock(info.row.original.symbol)}>
            {info.row.original.symbol}
            <ArrowUpRight size={13} />
            <small>{info.row.original.name}</small>
          </button>
        ),
      },
      { accessorKey: 'quantity', header: '持股', cell: (i) => number(i.row.original.quantity, 3) },
      {
        accessorKey: 'averageCost',
        header: '平均成本',
        sortUndefined: 'last',
        cell: (i) => number(i.row.original.averageCost),
      },
      { accessorKey: 'price', header: '目前股價', cell: (i) => number(i.row.original.price) },
      {
        accessorKey: 'marketValue',
        header: '持倉市值',
        cell: (i) => number(i.row.original.marketValue),
      },
      {
        accessorKey: 'unrealized',
        header: '未實現盈虧',
        cell: (i) => (
          <span className={tone(i.row.original.unrealized)}>
            {signed(i.row.original.unrealized)}
          </span>
        ),
      },
      {
        accessorKey: 'returnPercent',
        header: '持倉報酬',
        cell: (i) => (
          <span className={tone(i.row.original.returnPercent)}>
            {i.row.original.returnPercent == null
              ? '—'
              : signed(i.row.original.returnPercent) + '%'}
          </span>
        ),
      },
      {
        accessorKey: 'realized',
        header: '已實現盈虧',
        cell: (i) => (
          <span className={tone(i.row.original.realized)}>{signed(i.row.original.realized)}</span>
        ),
      },
      {
        accessorKey: 'total',
        header: '合計盈虧',
        cell: (i) => (
          <strong className={tone(i.row.original.total)}>{signed(i.row.original.total)}</strong>
        ),
      },
    ],
    [onStock],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const total = (key: 'unrealized' | 'realized' | 'total' | 'marketValue') =>
      rows.some((r) => r[key] == null) ? null : rows.reduce((sum, r) => sum + r[key]!, 0),
    dividends = data.cashEvents
      .filter((e) => e.type === 'dividend')
      .reduce((s, e) => s + e.amount, 0),
    turnover = monthlyTurnover(data, month, prefs.hkdRate, prefs.otherTurnover[month] ?? 0);
  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">PORTFOLIO OVERVIEW</span>
          <h1>看清每一筆持倉</h1>
          <p>從整體盈虧，回到每一次決策。</p>
        </div>
        <span className="pill">{rows.filter((r) => r.quantity > 0).length} 支持倉 · USD</span>
      </div>
      <div className="metrics-grid">
        <Metric
          label="持倉市值"
          value={'$' + number(total('marketValue'))}
          note="僅股票資產，不含現金"
        />
        <Metric
          label="未實現盈虧"
          value={'$' + signed(total('unrealized'))}
          tone={tone(total('unrealized'))}
          note="目前持倉市值 − 剩餘成本"
        />
        <Metric
          label="已實現盈虧"
          value={'$' + signed(total('realized'))}
          tone={tone(total('realized'))}
          note="移動加權平均成本"
        />
        <Metric
          label="已錄入淨股息"
          value={'$' + number(dividends)}
          note={
            data.cashEvents.some((e) => e.type === 'dividend')
              ? '依实际到帳補錄'
              : '尚未補錄，不代表沒有派息'
          }
        />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>全部股票</h2>
          <span className="muted small">點欄位標題排序 · 點股票進入復盤</span>
        </div>
        <div className="table-scroll">
          <table className="portfolio-table">
            <thead>
              {table.getHeaderGroups().map((g) => (
                <tr key={g.id}>
                  {g.headers.map((h) => (
                    <th
                      key={h.id}
                      aria-sort={
                        h.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : h.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                    >
                      <button onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => (
                <tr key={r.id}>
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          已平倉股票保留已實現盈虧。合計盈虧未含股息、費用及匯兌；日盤報價可能延遲。
          {rows.some((r) => r.issues.length > 0) && (
            <span className="negative"> 部分交易無法還原，相關盈虧暫不顯示。</span>
          )}
        </div>
      </section>
      {prefs.showTrade25 && (
        <section className="panel trade25">
          <div className="panel-heading">
            <div className="title-icon">
              <Wallet size={18} />
              <h2>Trade25 月度成交額</h2>
              <span className="pill">已匯入部分 · 估算</span>
            </div>
            <input
              type="month"
              aria-label="Trade25 月份"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="trade25-body">
            <div>
              <span className="muted small">買入＋賣出 · 自然月（香港時間）</span>
              <div className="quota-number">
                HK$ {number(turnover.hkd, 0)} <small>/ 250,000</small>
              </div>
              <div className="progress-track">
                <i
                  style={{
                    width: `${Math.min(100, (turnover.hkd / 250000) * 100)}%`,
                    background:
                      turnover.hkd >= 250000
                        ? 'var(--down)'
                        : turnover.hkd > 200000
                          ? 'var(--gold)'
                          : 'var(--up)',
                  }}
                />
              </div>
              <span className={turnover.hkd >= 250000 ? 'negative' : 'muted'}>
                {turnover.hkd >= 250000
                  ? '已超出 ' + number(turnover.hkd - 250000, 0)
                  : '估算剩餘 ' + number(250000 - turnover.hkd, 0)}{' '}
                HKD · {turnover.count} 筆成交
              </span>
            </div>
            <div className="quota-details">
              <label>
                其他市場／未匯入成交額 HKD
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={prefs.otherTurnover[month] ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n >= 0 && Number.isFinite(n))
                      onPrefs({ otherTurnover: { ...prefs.otherTurnover, [month]: n } });
                  }}
                />
              </label>
              <p>
                USD {number(turnover.usd)} × {prefs.hkdRate} ＋ 其他成交額。額度涵蓋港股、美股及 A
                股，以銀行累計數字為準。
              </p>
              <a
                href="https://www.hsbc.com.hk/zh-hk/investments/products/stocks/trade25/"
                target="_blank"
                rel="noreferrer"
              >
                Trade25 官方說明 ↗
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
