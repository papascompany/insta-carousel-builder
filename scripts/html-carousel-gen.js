#!/usr/bin/env node
/**
 * insta-carousel-builder — HTML/Puppeteer 캐러셀 생성기
 *
 * slides 폴더의 *.html 파일을 1080×1350 (2x 레티나) PNG로 일괄 캡처.
 * 한글 100% 정확, 비용 0원, 결정적 결과.
 *
 * 사용법:
 *   # 1. templates/html-templates/ 또는 docs/sample-html/ 의 HTML 9장을 복사
 *   #    output/{topic}/slides/ 에 두기 (또는 직접 작성)
 *   # 2. 실행:
 *   node scripts/html-carousel-gen.js --topic my-topic
 *
 *   # 단일 슬라이드만 캡처:
 *   node scripts/html-carousel-gen.js --topic my-topic --only 3
 *
 * 의존성:
 *   npm install puppeteer
 *
 * 폰트:
 *   Pretendard 시스템 설치 권장 (없으면 CDN으로 폴백되지만 첫 로드 느림)
 *   Linux: https://github.com/orioncactus/pretendard 릴리즈 참조
 */
import puppeteer from 'puppeteer';
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1]) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

const CONFIG = {
  width: 1080,
  height: 1350,
  deviceScaleFactor: 2,
};

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

/** output/<topic>/metadata.json 에 실행 이력 추가, output/_index.json 에 주제 요약 갱신 */
function recordRun({ outputDir, topic, run }) {
  const metaPath = join(outputDir, 'metadata.json');
  const meta = readJson(metaPath, {});
  Object.assign(meta, { topic, engine: 'html', updated_at: run.finished_at });
  meta.runs = [...(meta.runs || []), run];
  writeJson(metaPath, meta);

  const brief = readJson(join(outputDir, 'brief.json'), {});
  const roles = Array.isArray(brief.nine_slide_outline)
    ? brief.nine_slide_outline.filter((s) => s && typeof s === 'object').map((s) => s.role || '')
    : null;
  const indexPath = join(dirname(outputDir), '_index.json');
  const index = readJson(indexPath, { carousels: [] });
  const entries = (index.carousels || []).filter((e) => e.topic !== topic);
  entries.push({
    topic,
    engine: 'html',
    updated_at: run.finished_at,
    structure: brief.recommended_structure ?? null,
    cover_hook: brief.recommended_cover_hook ?? null,
    roles,
  });
  entries.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  writeJson(indexPath, { ...index, carousels: entries });
}

async function captureSlides({ slidesDir, outputDir, only }) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let files = readdirSync(slidesDir)
    .filter((f) => f.endsWith('.html'))
    .sort();

  if (only) {
    const target = `slide-${String(only).padStart(2, '0')}.html`;
    files = files.filter((f) => f === target);
    if (files.length === 0) {
      console.error(`❌ ${target} 없음 in ${slidesDir}`);
      process.exit(1);
    }
  }

  if (files.length === 0) {
    console.error(`❌ ${slidesDir} 에 HTML 파일이 없습니다.`);
    process.exit(1);
  }

  console.log(`\n${files.length}개 슬라이드 캡처 시작 (${slidesDir})\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: CONFIG.width,
    height: CONFIG.height,
    deviceScaleFactor: CONFIG.deviceScaleFactor,
  });

  for (const file of files) {
    const filePath = resolve(slidesDir, file);
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
    const outName = file.replace('.html', '.png');
    const outPath = join(outputDir, outName);

    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    await page.screenshot({
      path: outPath,
      type: 'png',
      clip: { x: 0, y: 0, width: CONFIG.width, height: CONFIG.height },
    });

    console.log(`  ✓ ${outName}`);
  }

  await browser.close();
  console.log(`\n완료! ${outputDir}\n`);
  return files.map((f) => f.replace('.html', '.png'));
}

async function main() {
  const args = parseArgs(process.argv);
  const topic = args.topic || 'default';
  const slidesDir = args['slides-dir'] || join(REPO_ROOT, 'output', topic, 'slides');
  const outputDir = join(REPO_ROOT, 'output', topic);

  if (!existsSync(slidesDir)) {
    console.error(`❌ slides 폴더 없음: ${slidesDir}`);
    console.error('   docs/sample-html/ 의 9장을 복사하거나, 직접 HTML 작성 후 실행하세요.');
    process.exit(1);
  }

  const startedAt = new Date();
  const captured = await captureSlides({ slidesDir, outputDir, only: args.only });
  const finishedAt = new Date();
  recordRun({
    outputDir,
    topic,
    run: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_sec: Math.round((finishedAt - startedAt) / 100) / 10,
      viewport: CONFIG,
      only: args.only ? Number(args.only) : null,
      slides: captured,
    },
  });
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
