'use client';
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Plus, Trash2, Info, TrendingUp } from 'lucide-react';
import {
  Dataset,
  Preferences,
  CashEvent,
  number,
  signed,
  tone,
  cashEventSchema,
} from '@/lib/types';
import { performance } from '@/lib/performance';
import { Drawer, Metric, Toggle } from './ui';
export default function PerformanceView({
  data,
  prefs,
  onSave,
  onPrefs,
}: {
  data: Dataset;
  prefs: Preferences;
  onSave: (d: Dataset) => void;
  onPrefs: (p: Partial<Preferences>) => void;
}) {
  const model = useMemo(() => performance(data, prefs.benchmark), [data, prefs.benchmark]),
    last = model.points.at(-1),
    [cashOpen, setCashOpen] = useState(false),
    [date, setDate] = useState(''),
    [amount, setAmount] = useState(''),
    [type, setType] = useState<CashEvent['type']>('deposit'),
    [symbol, setSymbol] = useState(''),
    [error, setError] = useState('');
  function add() {
    const result = cashEventSchema.safeParse({
      id: crypto.randomUUID(),
      date,
      type,
      amount: Number(amount),
      symbol: symbol || undefined,
    });
    if (!result.success) {
      setError('請填有效日期與大於零的美元金額');
      return;
    }
    if (
      data.cashEvents.some(
        (e) =>
          e.date === date &&
          e.amount === Number(amount) &&
          e.type === type &&
          e.symbol === (symbol || undefined),
      )
    ) {
      setError('已有相同流水，請先核對，避免重複計入');
      return;
    }
    onSave({
      ...data,
      cashEvents: [...data.cashEvents, result.data].sort((a, b) => a.date.localeCompare(b.date)),
    });
    setAmount('');
    setError('');
  }
  const axis = { stroke: '#7e93ad', fontSize: 11, tickLine: false, axisLine: false },
    tooltip = {
      background: '#172638',
      border: '1px solid #3b506b',
      borderRadius: 10,
      fontSize: 12,
      color: '#f0f4fa',
    };
  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow">PERFORMANCE & REFLECTION</span>
          <h1>主動操作，帶來了什麼？</h1>
          <p>相同本金、相同入出金，與持有指數的結果並排。</p>
        </div>
        <button onClick={() => setCashOpen(true)}>
          <Plus size={16} />
          本金與資金流水
        </button>
      </div>
      <div className="method-strip">
        <Info size={17} />
        <span>
          {model.estimated ? '估算收益率 · 資金流水尚未完整' : '已按錄入資金流調整'} · 期初{' '}
          {data.initialCash == null ? '最低所需本金估算' : '現金'} ${number(model.initial)} ·
          未計費用
        </span>
        <label>
          基準
          <select
            aria-label="收益比較基準"
            value={prefs.benchmark}
            onChange={(e) => onPrefs({ benchmark: e.target.value as 'SPY' | 'QQQ' })}
          >
            <option value="SPY">SPY · S&P 500</option>
            <option value="QQQ">QQQ · Nasdaq 100</option>
          </select>
        </label>
      </div>
      <div className="metrics-grid">
        <Metric
          label="累計投資盈虧"
          value={'$' + signed(last?.pnl)}
          tone={tone(last?.pnl)}
          note="期末淨值 − 本金 − 淨入金"
        />
        <Metric
          label="資金流調整收益率"
          value={signed(last?.account) + '%'}
          tone={tone(last?.account)}
          note={model.estimated ? '估算值，補齊入出金後重算' : '按日鏈結時間加權收益'}
        />
        <Metric
          label="最大回撤"
          value={number(model.points.length ? model.maxDrawdown : null) + '%'}
          tone="negative"
          note="收益指數從歷史高點的最大跌幅"
        />
        <Metric
          label="相對基準"
          value={signed(last?.benchmark == null ? null : last.account - last.benchmark) + ' pp'}
          tone={tone(last?.benchmark == null ? null : last.account - last.benchmark)}
          note="收益率差，以百分點表示"
        />
      </div>
      {!!model.issues.length && (
        <div className="inline-note">
          {model.issues.map((i) => (
            <p key={i}>{i}</p>
          ))}
        </div>
      )}
      <section className="panel performance-chart">
        <div className="panel-heading">
          <div className="title-icon">
            <TrendingUp size={18} />
            <h2>收益曲線</h2>
          </div>
          <div className="line-legend">
            <span>
              <i style={{ background: '#e3c18a' }} />
              我的操作
            </span>
            <span>
              <i style={{ background: '#82baff' }} />
              {prefs.benchmark} 價格回報
            </span>
          </div>
        </div>
        {model.points.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={model.points} margin={{ top: 20, right: 28, left: 5, bottom: 10 }}>
              <CartesianGrid stroke="#223246" vertical={false} />
              <XAxis dataKey="date" minTickGap={70} tickFormatter={(v) => v.slice(5)} {...axis} />
              <YAxis tickFormatter={(v) => `${v}%`} {...axis} />
              <Tooltip
                contentStyle={tooltip}
                formatter={(v, name) => [
                  number(Number(v)) + '%',
                  name === 'account' ? '我的操作' : prefs.benchmark,
                ]}
              />
              <ReferenceLine y={0} stroke="#546074" strokeDasharray="4 4" />
              <Line
                type="linear"
                dataKey="account"
                stroke="#e3c18a"
                strokeWidth={2.2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="benchmark"
                stroke="#82baff"
                strokeWidth={1.7}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">匯入完整交易並補齊行情後顯示收益曲線。</div>
        )}
      </section>
      <div className="two-panels">
        <section className="panel">
          <div className="panel-heading">
            <h2>回撤歷程</h2>
            <span className="muted small">距離自己的歷史高點</span>
          </div>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={model.points} margin={{ top: 15, right: 20, left: 5, bottom: 10 }}>
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} minTickGap={65} {...axis} />
              <YAxis tickFormatter={(v) => `${v}%`} {...axis} />
              <Tooltip
                contentStyle={tooltip}
                formatter={(v) => [number(Number(v)) + '%', '回撤']}
              />
              <Area
                dataKey="drawdown"
                type="linear"
                stroke="#ef7f93"
                fill="#ef7f9326"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>
        <section className="panel method-card">
          <h2>這些數字如何計算？</h2>
          <p>
            每日淨值 = 現金 ＋ 持股數 ×
            當日收盤價。入出金按當日開始時發生，收益率逐日鏈結，避免把入金當收益。
          </p>
          <p>
            基準把相同起始現金與後續入出金，按相同交易日開盤價買入或賣出指數
            ETF，允許模擬碎股；目前使用不含股息的價格回報。
          </p>
          <p>
            股息按銀行實際收到的美元淨額補錄，增加現金與投資盈虧。未補錄的派息不會自動猜測；含淨股息時，與價格基準有口徑差異。
          </p>
          <a
            href="https://www.investor.gov/introduction-investing/investing-basics/glossary/ex-dividend-dates-when-are-you-entitled-stock-and"
            target="_blank"
            rel="noreferrer"
          >
            了解派息與除息日 ↗
          </a>
        </section>
      </div>
      <Drawer
        open={cashOpen}
        onOpenChange={setCashOpen}
        title="本金、入出金與股息"
        description="這些資料只影響收益分析，不改變你的買賣記錄。"
      >
        <section className="settings-section">
          <h3>期初現金</h3>
          <label className="field-row">
            第一筆買入之前的美元現金
            <input
              type="number"
              min="0"
              step="any"
              placeholder="不知道，使用估算"
              value={data.initialCash ?? ''}
              onChange={(e) => {
                const n = e.target.value === '' ? null : Number(e.target.value);
                if (n == null || (Number.isFinite(n) && n >= 0))
                  onSave({ ...data, initialCash: n });
              }}
            />
          </label>
          <p className="muted small">
            不知道也可以留空，系統先估算完成交易所需的最低本金。現金不斷變化很正常：買賣自動計算，只需補記由外部轉入、轉出的錢。
          </p>
          <Toggle
            label="期初本金及全部入出金已核對"
            description="尚未補齊時，保持關閉以顯示估算標識"
            checked={data.cashFlowsComplete}
            onChange={(cashFlowsComplete) => onSave({ ...data, cashFlowsComplete })}
          />
        </section>
        <section className="settings-section">
          <h3>新增資金流水</h3>
          <div className="form-grid">
            <label>
              日期（美東歸屬日）
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              類型
              <select value={type} onChange={(e) => setType(e.target.value as CashEvent['type'])}>
                <option value="deposit">入金</option>
                <option value="withdrawal">出金</option>
                <option value="dividend">股息 · 淨到账</option>
              </select>
            </label>
            <label>
              金額 USD
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {type === 'dividend' && (
              <label>
                股票（選填）
                <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </label>
            )}
          </div>
          <button className="primary" onClick={add}>
            <Plus size={15} />
            新增流水
          </button>
          {error && <p className="negative small">{error}</p>}
          <div className="help-box">
            <strong>股息是什麼？</strong>
            <p>
              公司或 ETF 把部分收益分給股東。例如符合派息資格的 10 股，每股派 $0.50，稅前股息是
              $5。實際入帳可能先扣稅。
            </p>
            <p>
              查看匯豐現金流水中的派息，填「實際入帳的淨額」即可。除息日決定資格，入帳日決定何時計入現金；公共派息公告不能證明你的到帳金額。
            </p>
          </div>
        </section>
        <div className="cash-events">
          {data.cashEvents.map((e) => (
            <div key={e.id}>
              <span>
                <strong>
                  {e.type === 'deposit' ? '入金' : e.type === 'withdrawal' ? '出金' : '淨股息'}{' '}
                  {e.symbol}
                </strong>
                <small>{e.date}</small>
              </span>
              <b>${number(e.amount)}</b>
              <button
                className="icon-button"
                aria-label={`刪除 ${e.date} 流水`}
                onClick={() =>
                  onSave({ ...data, cashEvents: data.cashEvents.filter((x) => x.id !== e.id) })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
