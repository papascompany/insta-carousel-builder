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
 *   node scripts/html-carousel-gen.js --topic my-topic --only 3,7
 *
 *   # 캡처 후 quality-check.js --dir 이 자동 실행됨 (생략: --skip-check)
 *   # 이어서 write-readme.js 가 output/{topic}/README.md 를 작성
 *
 * 의존성:
 *   npm install puppeteer
 *
 * 폰트:
 *   HTML 의 Pretendard CDN(@import .../pretendard/dist/web/variable/...) 요청은
 *   레포의 assets/fonts/pretendard/ (OFL-1.1) 로 대체해 서빙 → 오프라인/CDN 차단 환경에서도 동일 렌더링.
 *   캡처 전 사용 중인 웹폰트가 실제 로드됐는지 확인하고, 대체 폰트로 떨어지면 중단
 *   (--allow-fallback-font 로 무시 가능).
 *
 * 모바일 가독성:
 *   1080px 캔버스는 폰(약 390px)에서 0.36배로 축소됨. font-size < MIN_FONT_PX 텍스트는 경고.
 */
import puppeteer from 'puppeteer';
import { spawnSync } from 'node:child_process';
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

const FONT_DIR = join(REPO_ROOT, 'assets', 'fonts', 'pretendard');
// .../pretendard[@ver]/dist/web/variable/<rest> → assets/fonts/pretendard/<rest>
const PRETENDARD_URL = /\/pretendard(?:@[^/]+)?\/dist\/web\/variable\/(.+?)(?:[?#].*)?$/;
const MIN_FONT_PX = 24; // 폰에서 약 8.7px — 이보다 작으면 읽기 어려움

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

async function captureSlides({ slidesDir, outputDir, only, allowFallbackFont }) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let files = readdirSync(slidesDir)
    .filter((f) => f.endsWith('.html'))
    .sort();

  if (only) {
    const targets = only.map((n) => `slide-${String(n).padStart(2, '0')}.html`);
    const missing = targets.filter((t) => !files.includes(t));
    if (missing.length > 0) {
      console.error(`❌ ${missing.join(', ')} 없음 in ${slidesDir}`);
      process.exit(1);
    }
    files = files.filter((f) => targets.includes(f));
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
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const m = req.url().match(PRETENDARD_URL);
    const local = m && resolve(FONT_DIR, m[1]);
    if (local && local.startsWith(FONT_DIR) && existsSync(local)) {
      const type = local.endsWith('.css') ? 'text/css' : 'font/woff2';
      req.respond({ status: 200, contentType: type, body: readFileSync(local), headers: { 'Access-Control-Allow-Origin': '*' } });
    } else {
      req.continue();
    }
  });
  const warnings = [];
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

    const audit = await page.evaluate((minPx) => {
      const declared = new Map(); // family → loaded 여부
      for (const f of document.fonts) {
        const fam = f.family.replace(/^["']|["']$/g, '');
        declared.set(fam, declared.get(fam) || f.status === 'loaded');
      }
      const failedFonts = new Set();
      const small = [];
      for (const el of document.body.querySelectorAll('*')) {
        const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
        if (!text) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const first = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
        if (declared.has(first) && !declared.get(first)) failedFonts.add(first);
        const px = parseFloat(cs.fontSize);
        if (px < minPx) small.push(`${px}px "${text.slice(0, 20)}"`);
      }
      return { failedFonts: [...failedFonts], small };
    }, MIN_FONT_PX);

    if (audit.failedFonts.length > 0 && !allowFallbackFont) {
      await browser.close();
      console.error(`❌ ${file}: 웹폰트 로드 실패 → 대체 폰트로 렌더링됨: ${audit.failedFonts.join(', ')}`);
      console.error('   assets/fonts/ 에 해당 폰트를 두거나 네트워크를 확인하세요. 무시하려면 --allow-fallback-font');
      process.exit(1);
    }
    if (audit.small.length > 0) {
      warnings.push(`${file}: ${MIN_FONT_PX}px 미만 텍스트 ${audit.small.length}개 (모바일 판독 어려움) — ${audit.small.slice(0, 3).join(', ')}`);
    }

    await page.screenshot({
      path: outPath,
      type: 'png',
      clip: { x: 0, y: 0, width: CONFIG.width, height: CONFIG.height },
    });

    console.log(`  ✓ ${outName}`);
  }

  await browser.close();
  console.log(`\n완료! ${outputDir}\n`);
  if (warnings.length > 0) {
    console.log('⚠️  모바일 가독성 경고:');
    warnings.forEach((w) => console.log(`   - ${w}`));
    console.log('');
  }
  return { captured: files.map((f) => f.replace('.html', '.png')), warnings };
}

/** "3,7" → [3, 7]. 숫자가 아니면 종료 */
function parseOnly(value) {
  if (!value) return null;
  const nums = String(value).split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  if (nums.length === 0 || nums.some((n) => !Number.isInteger(n) || n < 1)) {
    console.error(`❌ --only 는 쉼표로 구분한 숫자여야 합니다: ${value}`);
    process.exit(1);
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** 캡처 직후 품질 검사 (Bash 로 실행된 스크립트 산출물은 PostToolUse 훅이 안 걸리므로) */
function runQualityCheck(outputDir) {
  const r = spawnSync(process.execPath, [join(__dirname, 'quality-check.js'), '--dir', outputDir], {
    stdio: 'inherit',
  });
  return r.status;
}

/** 결과 폴더 README 작성. 실패해도 생성 결과(종료 코드)에는 영향 없음 */
function runWriteReadme(outputDir) {
  const r = spawnSync(process.execPath, [join(__dirname, 'write-readme.js'), '--dir', outputDir], {
    stdio: 'inherit',
  });
  if (r.status !== 0) console.log('⚠️  README 작성 실패 — 직접 실행: node scripts/write-readme.js --dir', outputDir);
}

async function main() {
  const FLAGS = ['--skip-check', '--allow-fallback-font'];
  const skipCheck = process.argv.includes('--skip-check');
  const allowFallbackFont = process.argv.includes('--allow-fallback-font');
  const args = parseArgs(process.argv.filter((a) => !FLAGS.includes(a)));
  const only = parseOnly(args.only);
  const topic = args.topic || 'default';
  const slidesDir = args['slides-dir'] || join(REPO_ROOT, 'output', topic, 'slides');
  const outputDir = join(REPO_ROOT, 'output', topic);

  if (!existsSync(slidesDir)) {
    console.error(`❌ slides 폴더 없음: ${slidesDir}`);
    console.error('   docs/sample-html/ 의 9장을 복사하거나, 직접 HTML 작성 후 실행하세요.');
    process.exit(1);
  }

  const startedAt = new Date();
  const { captured, warnings } = await captureSlides({ slidesDir, outputDir, only, allowFallbackFont });
  const finishedAt = new Date();
  recordRun({
    outputDir,
    topic,
    run: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_sec: Math.round((finishedAt - startedAt) / 100) / 10,
      viewport: CONFIG,
      only,
      slides: captured,
      // reviewer 가 모바일 가독성·웹폰트 적용을 판단하는 근거
      allow_fallback_font: allowFallbackFont,
      small_text_warnings: warnings,
    },
  });

  const checkStatus = skipCheck ? 0 : runQualityCheck(outputDir);
  runWriteReadme(outputDir); // quality-report.json 을 읽으므로 검사 뒤에 실행
  if (checkStatus === 1) process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
