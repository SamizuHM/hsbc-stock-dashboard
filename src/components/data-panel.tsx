'use client';
import { useRef, useState } from 'react';
import { Download, FileUp, ClipboardPaste, Check, Database } from 'lucide-react';
import { toast } from 'sonner';
import { Dataset, Notice, marketDay, noticeSchema, identity } from '@/lib/types';
import {
  ImportCandidate,
  fromLegacy,
  mergeNotices,
  parseFile,
  parseText,
} from '@/lib/importers/hsbc';
import { Drawer } from './ui';

export function exportJson(data: Dataset) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
  a.href = url;
  a.download = `交易記錄-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportCsv(data: Dataset) {
  const rows = [
    ['美東日期', '通知時間', '股票', '買賣', '本次股數', '價格USD', '狀態', '訂單編號'],
    ...data.notices.map((n) => [
      n.date,
      n.timestamp,
      n.symbol,
      n.side,
      n.quantity,
      n.price,
      n.status,
      n.orderId,
    ]),
  ];
  const cell = (v: unknown) =>
    `"${String(v ?? '')
      .replace(/^[=+@-]/, "' $&")
      .replace(/"/g, '""')}"`;
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = '全部交易通知.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export default function DataPanel({
  open,
  onOpenChange,
  data,
  onSave,
  localAvailable,
  onSource,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: Dataset;
  onSave: (d: Dataset) => void;
  localAvailable: boolean;
  onSource: (m: 'demo' | 'local') => Promise<void>;
}) {
  const [text, setText] = useState(''),
    [candidates, setCandidates] = useState<ImportCandidate[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [backup, setBackup] = useState<Dataset | null>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const existing = new Set(data.mode === 'demo' ? [] : data.notices.map(identity));
  function checked(c: ImportCandidate) {
    const n = { ...c.notice };
    if (n.timestamp && !Number.isNaN(Date.parse(n.timestamp))) n.date = marketDay(n.timestamp);
    const result = noticeSchema.safeParse(n);
    return result;
  }
  const valid = candidates.filter((c) => checked(c).success).length,
    duplicates = candidates.filter((c) => {
      const v = checked(c);
      return v.success && existing.has(identity(v.data));
    }).length;
  async function files(files: FileList | null) {
    if (!files?.length) return;
    if (files.length > 100 || [...files].reduce((s, f) => s + f.size, 0) > 30 * 1024 * 1024) {
      setMessage('每批最多 100 個檔案，總大小不超過 30 MB');
      return;
    }
    setBusy(true);
    setMessage('');
    const rows: ImportCandidate[] = [];
    setBackup(null);
    for (const file of [...files]) {
      try {
        if (files.length === 1 && /\.json$/i.test(file.name)) {
          const parsed = JSON.parse(await file.text());
          if (parsed.version === 1 && parsed.markets) setBackup(fromLegacy(parsed));
        }
        rows.push(...(await parseFile(file)));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : '讀取失敗');
      }
    }
    setCandidates(rows);
    setBusy(false);
  }
  function change(i: number, patch: Partial<Notice>) {
    setCandidates((rows) =>
      rows.map((r, j) => (i === j ? { ...r, notice: { ...r.notice, ...patch }, errors: [] } : r)),
    );
  }
  function confirm() {
    const accepted = candidates.map((c) => checked(c));
    if (accepted.some((r) => !r.success)) {
      setMessage('請修正所有紅色欄位，或移除無法辨識的通知');
      return;
    }
    const rows = accepted.map((r) => r.data!) as Notice[],
      base =
        data.mode === 'demo'
          ? {
              ...data,
              id: 'personal-import',
              label: '我的交易記錄',
              mode: 'imported' as const,
              notices: [],
              markets: {},
              initialCash: null,
              cashFlowsComplete: false,
              cashEvents: [],
            }
          : data,
      result = mergeNotices(base.notices, rows);
    onSave({
      ...base,
      notices: result.notices,
      ...(backup
        ? {
            markets: { ...base.markets, ...backup.markets },
            initialCash: backup.initialCash,
            cashFlowsComplete: backup.cashFlowsComplete,
            cashEvents: backup.cashEvents,
          }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    setCandidates([]);
    setText('');
    setBackup(null);
    setMessage(`新增 ${result.added} 筆；${rows.length - result.added} 筆重複已略過。`);
    toast.success(`已合併 ${result.added} 筆通知`);
  }
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="資料與匯入"
      description="解析、預覽、去重都在瀏覽器本機完成，不使用大模型。"
      wide
    >
      <div className="source-card">
        <Database size={22} />
        <div>
          <strong>{data.label}</strong>
          <small>
            {data.notices.length} 封通知 · {new Set(data.notices.map((n) => n.orderId)).size} 個訂單
            · {data.mode === 'demo' ? '全部為合成示例' : '僅存本機'}
          </small>
        </div>
        <span className="pill">{data.mode === 'demo' ? 'DEMO' : 'PRIVATE'}</span>
      </div>
      <div className="button-row">
        <button onClick={() => exportJson(data)}>
          <Download size={15} />
          完整 JSON 備份
        </button>
        <button onClick={() => exportCsv(data)}>通知 CSV</button>
        <button onClick={() => void onSource(data.mode === 'demo' ? 'local' : 'demo')}>
          {data.mode === 'demo'
            ? localAvailable
              ? '連接本機資料'
              : '恢復我的資料'
            : '查看模擬示例'}
        </button>
      </div>
      <section className="settings-section">
        <h3>批量匯入歷史郵件</h3>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".eml,.txt,.json"
          hidden
          onChange={(e) => {
            void files(e.target.files);
            e.target.value = '';
          }}
        />
        <button className="upload-area" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileUp size={27} />
          <strong>{busy ? '正在解析…' : '選擇郵件或交易備份'}</strong>
          <span>.eml 原始郵件 · .txt 正文 · .json 交易備份</span>
          <small>最多 100 個檔案 / 30 MB，每個檔案不超過 5 MB</small>
        </button>
        <details className="help">
          <summary>沒有 .eml 或 Excel 也可以匯入</summary>
          <p>
            .eml
            是郵件的原始檔案。如果郵箱提供「下載原文／另存為」，可以保存後批量選取。找不到下載入口時，直接複製交易通知正文貼到下面，不需要券商
            Excel。
          </p>
          <p>
            規則解析依賴欄位名稱，新的郵件模板可能需要手動修正。只使用「本次成交數量」，不累加每封通知中的累計量。
          </p>
        </details>
      </section>
      <section className="settings-section">
        <h3>單封通知 · 貼上正文</h3>
        <textarea
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            '訂單編號: EXAMPLE-001\n股票代碼: AAPL\n買賣方向: 買入\n本次成交數量: 2\n成交價格: 185.50\n通知時間: 2026-06-01T22:35:00+08:00'
          }
        />
        <button
          onClick={() => {
            if (!text.trim()) return;
            setBackup(null);
            setCandidates([parseText(text)]);
            setMessage('');
          }}
          disabled={!text.trim()}
        >
          <ClipboardPaste size={15} />
          解析並預覽
        </button>
      </section>
      {!!candidates.length && (
        <section className="settings-section">
          <div className="section-heading">
            <h3>
              匯入預覽 <span className="pill">{candidates.length} 封</span>
            </h3>
            <span className="muted small">
              {valid} 封可用 · {duplicates} 封與現有記錄重複
            </span>
          </div>
          {backup && (
            <p className="inline-note">
              這是完整備份：確認後還原其中的行情、本金與資金流水。原有交易會合併保留。
            </p>
          )}
          <div className="candidate-list">
            {candidates.map((c, i) => {
              const parsed = checked(c),
                valid = parsed.success;
              return (
                <details
                  key={i}
                  className={`candidate ${valid ? '' : 'invalid'}`}
                  open={!valid || candidates.length === 1}
                >
                  <summary>
                    <span>
                      {c.notice.symbol ?? '股票待填'} · {c.notice.side ?? '方向待填'}{' '}
                      {c.notice.quantity ?? '—'} 股 · {c.source}
                    </span>
                    <span className={valid ? 'positive' : 'negative'}>
                      {valid ? '可匯入' : '待修正'}
                    </span>
                  </summary>
                  <div className="candidate-fields">
                    <label>
                      股票
                      <input
                        value={c.notice.symbol ?? ''}
                        onChange={(e) => change(i, { symbol: e.target.value.toUpperCase() })}
                      />
                    </label>
                    <label>
                      買賣
                      <select
                        value={c.notice.side ?? ''}
                        onChange={(e) => change(i, { side: e.target.value as 'B' | 'S' })}
                      >
                        <option value="">請選擇</option>
                        <option value="B">B 買入</option>
                        <option value="S">S 賣出</option>
                      </select>
                    </label>
                    <label>
                      本次股數
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={c.notice.quantity ?? ''}
                        onChange={(e) =>
                          change(i, {
                            quantity: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      成交價 USD
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={c.notice.price ?? ''}
                        onChange={(e) =>
                          change(i, {
                            price: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="full">
                      通知時間（必須帶時區）
                      <input
                        placeholder="2026-06-01T22:35:00+08:00"
                        value={c.notice.timestamp ?? ''}
                        onChange={(e) => change(i, { timestamp: e.target.value })}
                      />
                    </label>
                    <label>
                      訂單編號
                      <input
                        value={c.notice.orderId ?? ''}
                        onChange={(e) => change(i, { orderId: e.target.value })}
                      />
                    </label>
                    <label>
                      通知狀態
                      <input
                        value={c.notice.status ?? ''}
                        onChange={(e) => change(i, { status: e.target.value })}
                      />
                    </label>
                  </div>
                  {!valid && (
                    <p className="negative small">
                      {c.errors.length
                        ? '待確認：' + c.errors.join('、')
                        : '請檢查必填欄位、數值、時區和 USD 幣別'}
                    </p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setCandidates((rows) => rows.filter((_, j) => i !== j))}
                  >
                    移除此通知
                  </button>
                </details>
              );
            })}
          </div>
          <button className="primary" onClick={confirm} disabled={valid !== candidates.length}>
            <Check size={16} />
            確認合併 {candidates.length} 封通知
          </button>
        </section>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
      <p className="muted small">
        匯出的備份包含個人交易，請自行保管。清除瀏覽器資料會移除本機匯入記錄，建議定期備份。已接入的本機檔案每
        60 秒檢查一次更新。
      </p>
    </Drawer>
  );
}
