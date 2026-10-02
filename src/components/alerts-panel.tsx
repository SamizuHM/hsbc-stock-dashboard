'use client';
import { useState } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AlertRule, number } from '@/lib/types';
import { Drawer, Toggle } from './ui';
export default function AlertsPanel({
  open,
  onOpenChange,
  symbol,
  price,
  averageCost,
  alerts,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  symbol: string;
  price: number | null;
  averageCost: number | null;
  alerts: AlertRule[];
  onChange: (a: AlertRule[]) => void;
}) {
  const [kind, setKind] = useState<AlertRule['kind']>('above'),
    [threshold, setThreshold] = useState(''),
    [error, setError] = useState('');
  const labels = {
    above: '價格上穿',
    below: '價格下穿',
    profit: '持倉浮盈達到',
    loss: '持倉浮虧達到',
  };
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="價格與成本提醒"
      description="頁面保持開啟且自動更新時生效，命中一次後暫停。"
    >
      <div className="source-card">
        <Bell size={22} />
        <div>
          <strong>{symbol}</strong>
          <small>
            現價 ${number(price)} · 平均成本 ${number(averageCost)}
          </small>
        </div>
      </div>
      <section className="settings-section">
        <div className="form-grid">
          <label>
            條件
            <select value={kind} onChange={(e) => setKind(e.target.value as AlertRule['kind'])}>
              {Object.entries(labels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            閾值 {kind === 'profit' || kind === 'loss' ? '%' : 'USD'}
            <input
              type="number"
              min="0"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
        </div>
        <button
          className="primary"
          onClick={() => {
            const n = Number(threshold);
            if (!Number.isFinite(n) || n <= 0) {
              setError('請輸入大於零的閾值');
              return;
            }
            if ((kind === 'profit' || kind === 'loss') && averageCost == null) {
              setError('沒有可還原持倉，暫不能設定成本提醒');
              return;
            }
            onChange([
              ...alerts,
              { id: crypto.randomUUID(), symbol, kind, threshold: n, enabled: true },
            ]);
            setThreshold('');
            setError('');
          }}
        >
          <Plus size={15} />
          加入提醒
        </button>
        {error && <p className="negative small">{error}</p>}
      </section>
      <h3>我的提醒</h3>
      {!alerts.length && <p className="muted">目前沒有提醒。</p>}
      {alerts.map((a) => (
        <div className="alert-row" key={a.id}>
          <Toggle
            label={`${a.symbol} · ${labels[a.kind]} ${a.threshold}${a.kind === 'profit' || a.kind === 'loss' ? '%' : ' USD'}`}
            description={
              a.triggeredAt
                ? '已命中 ' + new Date(a.triggeredAt).toLocaleString('zh-TW')
                : '使用日盤報價，資料超過 5 分鐘不觸發'
            }
            checked={a.enabled}
            onChange={(enabled) =>
              onChange(
                alerts.map((r) => (r.id === a.id ? { ...r, enabled, triggeredAt: undefined } : r)),
              )
            }
          />
          <button
            className="icon-button"
            aria-label="刪除提醒"
            onClick={() => onChange(alerts.filter((r) => r.id !== a.id))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button
        onClick={async () => {
          if (!('Notification' in window)) {
            toast.error('目前瀏覽器不支持系統通知');
            return;
          }
          const result = await Notification.requestPermission();
          toast(result === 'granted' ? '已啟用系統通知' : '將使用頁內提醒');
        }}
      >
        啟用系統通知
      </button>
      <p className="muted small">
        瀏覽器關閉或背景輪詢暫停時不發出提醒。公开行情可能延遲；這不是券商的即時預警或自動下單功能。
      </p>
    </Drawer>
  );
}
