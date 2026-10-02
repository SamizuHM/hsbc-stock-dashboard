import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fromLegacy } from '@/lib/importers/hsbc';
import { parseWorkspaceBackup } from '@/lib/backup-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  // 只有已啟用私有橋接的同源本機頁面能保存；目錄固定，請求不能指定路徑。
  if (
    !process.env.PRIVATE_DATA_FILE ||
    !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) ||
    !origin ||
    origin !== `http://${host}` ||
    site !== 'same-origin'
  ) {
    return NextResponse.json({ error: '僅已連接資料的本機頁面可保存備份' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: '備份必須是 JSON' }, { status: 415 });
  if (Number(request.headers.get('content-length')) > MAX_BYTES)
    return NextResponse.json({ error: '備份超過 30 MB' }, { status: 413 });
  // 串流計數，避免沒有 Content-Length 的請求超出記憶體限額。
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: '備份內容為空' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: '備份超過 30 MB' }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return NextResponse.json({ error: '讀取備份失敗' }, { status: 400 });
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const data = JSON.parse(text);
    if (data?.version !== 1 || !data.markets) throw new Error('format');
    fromLegacy(data);
    parseWorkspaceBackup(data.workspaceBackup);
  } catch {
    return NextResponse.json({ error: '備份格式不完整，請使用完整工作區備份' }, { status: 400 });
  }
  const directory = resolve(process.cwd(), 'private', 'browser');
  const name = `workspace-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`;
  const temporary = join(directory, `${name}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, join(directory, name));
    return NextResponse.json(
      { path: `private/browser/${name}` },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    await unlink(temporary).catch(() => undefined);
    return NextResponse.json(
      { error: '無法保存備份，請檢查 private/browser 的寫入權限' },
      { status: 500 },
    );
  }
}
