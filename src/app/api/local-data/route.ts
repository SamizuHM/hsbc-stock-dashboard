import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import { fromLegacy } from '@/lib/importers/hsbc';
import { ZodError } from 'zod';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  // 私有檔案橋接預設關閉，僅允許同源本機請求；公開部署不設定私有路徑。
  const path = process.env.PRIVATE_DATA_FILE,
    host = request.headers.get('host') ?? '',
    origin = request.headers.get('origin'),
    site = request.headers.get('sec-fetch-site');
  if (
    !path ||
    !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) ||
    (origin && new URL(origin).host !== host) ||
    site === 'cross-site'
  )
    return NextResponse.json({ available: false }, { status: 404 });
  try {
    if ((await stat(path)).size > 30 * 1024 * 1024) throw new Error('size');
    const data = fromLegacy(JSON.parse(await readFile(path, 'utf8')), 'local');
    if (process.env.PRIVATE_PERFORMANCE_FILE) {
      const settings = JSON.parse(await readFile(process.env.PRIVATE_PERFORMANCE_FILE, 'utf8'));
      if (Number.isFinite(settings.initial_cash_usd) && settings.initial_cash_usd >= 0)
        data.initialCash = settings.initial_cash_usd;
      data.cashFlowsComplete = settings.cash_flows_complete === true;
    }
    return NextResponse.json(
      { available: true, data },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  } catch (error) {
    const detail =
      error instanceof ZodError
        ? error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}: ${i.code}`)
            .join('; ')
        : error instanceof Error && 'code' in error
          ? String(error.code)
          : error instanceof TypeError || error instanceof RangeError
            ? error.message
            : '檔案格式不符';
    return NextResponse.json(
      { available: false, error: '本機資料讀取失敗，請檢查私有路徑與檔案格式', detail },
      { status: 503 },
    );
  }
}
