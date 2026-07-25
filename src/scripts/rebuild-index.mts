/**
 * 검색 색인 전체 재구축 CLI.
 *
 *   npm run rebuild-index
 *   npx tsx src/scripts/rebuild-index.mts
 *
 * 기존 `MARKDOWN_ROOT/.mdws/search.db`를 삭제하고 처음부터 다시 구축한다.
 * `.env.local`의 환경변수(`MARKDOWN_ROOT` 등)를 읽어야 하므로
 * dotenv 없이 `--env-file` 플래그를 사용한다.
 *
 * 담당: backend-dev / Stage 3
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { register } from 'node:module';

// server-only를 빈 모듈로 대체한다 -- Next.js 런타임 밖에서 실행하기 위함.
register('data:text/javascript,export default {}', import.meta.url);

// dotenv 없이 .env.local을 수동 로드한다.
function loadEnvFile(filePath: string): void {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return; // 파일이 없으면 건너뛴다
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // 따옴표 제거
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // 이미 설정된 환경변수는 덮어쓰지 않는다
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// .env.local 로드
const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);
loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

async function main(): Promise<void> {
  const markdownRoot = process.env.MARKDOWN_ROOT;

  if (!markdownRoot) {
    console.error('MARKDOWN_ROOT 환경변수가 설정되지 않았습니다.');
    console.error('.env.local 파일을 확인하세요.');
    process.exitCode = 1;
    return;
  }

  const resolvedRoot = path.resolve(markdownRoot);
  const dbDir = path.join(resolvedRoot, '.mdws');
  const dbFile = path.join(dbDir, 'search.db');

  // 기존 DB 삭제
  if (fs.existsSync(dbFile)) {
    console.log('기존 색인 DB를 삭제합니다...');
    fs.unlinkSync(dbFile);
    // WAL/SHM 파일도 정리
    try { fs.unlinkSync(`${dbFile}-wal`); } catch { /* 없으면 무시 */ }
    try { fs.unlinkSync(`${dbFile}-shm`); } catch { /* 없으면 무시 */ }
  }

  // DB 디렉터리 생성
  fs.mkdirSync(dbDir, { recursive: true });

  // better-sqlite3, gray-matter 동적 임포트
  const Database = (await import('better-sqlite3')).default;
  const matter = (await import('gray-matter')).default;

  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      subpath,
      title,
      body,
      tags,
      tokenize='trigram'
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS docs_meta (
      subpath TEXT PRIMARY KEY,
      mtime   INTEGER NOT NULL
    );
  `);

  // 재귀 스캔
  let indexedCount = 0;
  let errorCount = 0;

  async function walk(dir: string): Promise<void> {
    let dirents;
    try {
      dirents = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue;

      const fullPath = path.join(dir, dirent.name);

      if (dirent.isDirectory()) {
        await walk(fullPath);
      } else if (
        dirent.isFile() &&
        (dirent.name.endsWith('.md') || dirent.name.endsWith('.markdown'))
      ) {
        try {
          const raw = await fsPromises.readFile(fullPath, 'utf8');
          const stat = await fsPromises.stat(fullPath);
          const parsed = matter(raw);

          const subpath = path.relative(resolvedRoot, fullPath).split(path.sep).join('/');

          const title =
            (typeof parsed.data.title === 'string' && parsed.data.title.trim()) ||
            path.basename(fullPath, path.extname(fullPath));

          const body = parsed.content;

          const tags = Array.isArray(parsed.data.tags)
            ? parsed.data.tags
                .filter((t: unknown): t is string => typeof t === 'string')
                .map((t: string) => t.trim())
                .filter(Boolean)
                .join(' ')
            : '';

          const mtime = Math.round(stat.mtimeMs);

          db.transaction(() => {
            db.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(subpath);
            db.prepare(
              'INSERT INTO docs_fts (subpath, title, body, tags) VALUES (?, ?, ?, ?)',
            ).run(subpath, title, body, tags);
            db.prepare(
              'INSERT OR REPLACE INTO docs_meta (subpath, mtime) VALUES (?, ?)',
            ).run(subpath, mtime);
          })();

          indexedCount += 1;
          if (indexedCount % 100 === 0) {
            process.stdout.write(`\r색인 진행 중... ${indexedCount}건`);
          }
        } catch (error) {
          errorCount += 1;
          console.error(`\n색인 실패: ${fullPath}`, error instanceof Error ? error.message : error);
        }
      }
    }
  }

  console.log(`MARKDOWN_ROOT: ${resolvedRoot}`);
  console.log('색인 전체 재구축을 시작합니다...\n');

  await walk(resolvedRoot);

  db.close();

  console.log(`\n\n완료: ${indexedCount}건 색인, ${errorCount}건 실패`);
  console.log(`DB 위치: ${dbFile}`);
}

main().catch((error: unknown) => {
  console.error('색인 재구축 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
