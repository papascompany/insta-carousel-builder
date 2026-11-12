#!/usr/bin/env node
/**
 * 인스타 캐러셀 품질 자동 검사.
 *
 * 4 모드:
 *   1. JSON 검증: --prompt templates/slides.<topic>.json
 *      - 9장 구조, common_style 존재, n 1~9 순차, role/prompt 필수, 금칙어
 *   2. PNG 검증: --dir output/<topic>
 *      - 9장 PNG 존재, 해상도(1080×1350 또는 정수배), 실제 포맷, 파일 크기 분포
 *   3. HTML 검증: --html output/<topic>/slides (폴더 또는 단일 파일)
 *      - 화면에 보이는 텍스트의 금칙어
 *   4. 브리프 검증: --brief output/<topic>/brief.json
 *      - nine_slide_outline 정확히 9장, n 1~9 순차, role 필수, 첫 장 Cover / 마지막 장 Outro
 *      - cta_suggestion 의 행동이 저장/공유/팔로우 중 하나만
 *      - 금칙어 (saturated_patterns 는 피할 표현을 나열하는 필드라 제외)
 *
 * 금칙어: knowledge/banned-words.json (카테고리별 배열, 앞의 "~" 는 무시)
 *
 * 사용법:
 *   node scripts/quality-check.js --prompt templates/slides.claude-code.json
 *   node scripts/quality-check.js --dir output/claude-code-tips
 *   node scripts/quality-check.js --html output/claude-code-tips/slides
 *   node scripts/quality-check.js --brief output/claude-code-tips/brief.json
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANNED_WORDS_PATH = join(REPO_ROOT, 'knowledge', 'banned-words.json');
const TARGET = { width: 1080, height: 1350 };

/** banned-words.json → [{ category, word }] */
function loadBannedWords() {
  if (!existsSync(BANNED_WORDS_PATH)) return [];
  const data = JSON.parse(readFileSync(BANNED_WORDS_PATH, 'utf-8'));
  const list = [];
  for (const [category, words] of Object.entries(data)) {
    if (!Array.isArray(words)) continue;
    for (const w of words) {
      const word = String(w).replace(/^~/, '').trim();
      if (word) list.push({ category, word });
    }
  }
  return list;
}

/** text 안의 금칙어 → ["<where>: \"word\" (category)"] */
function findBannedWords(text, where, banned) {
  return banned
    .filter(({ word }) => text.includes(word))
    .map(({ word, category }) => `${where}: 금칙어 "${word}" (${category})`);
}

/** PNG/JPEG 헤더에서 포맷과 크기 읽기. 실패 시 null */
function readImageInfo(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(64 * 1024);
    const n = readSync(fd, head, 0, head.length, 0);
    const b = head.subarray(0, n);
    if (n >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
      return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < n) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        // SOF0~SOF15 (DHT=C4, JPG=C8, DAC=CC 제외)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { format: 'jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1]) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

function checkPromptJson(path) {
  if (!existsSync(path)) {
    return { status: 'FAIL', errors: [`파일 없음: ${path}`] };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return { status: 'FAIL', errors: [`JSON 파싱 실패: ${e.message}`] };
  }

  const errors = [];
  const warnings = [];

  if (!data.common_style || data.common_style.length < 50) {
    errors.push('common_style 누락 또는 너무 짧음');
  }
  if (!Array.isArray(data.slides)) {
    errors.push('slides 배열 누락');
    return { status: 'FAIL', errors };
  }
  if (data.slides.length !== 9) {
    warnings.push(`슬라이드 ${data.slides.length}장 (권장: 9장)`);
  }

  for (let i = 0; i < data.slides.length; i++) {
    const s = data.slides[i];
    const expectedN = i + 1;
    if (s.n !== expectedN) errors.push(`slides[${i}].n 이 ${s.n} (기대: ${expectedN})`);
    if (!s.role) errors.push(`slides[${i}].role 누락`);
    if (!s.prompt || s.prompt.length < 50) errors.push(`slides[${i}].prompt 누락 또는 너무 짧음`);
  }

  const banned = loadBannedWords();
  for (const s of data.slides) {
    errors.push(...findBannedWords(s.prompt || '', `slide-${String(s.n).padStart(2, '0')}`, banned));
  }

  const coverExists = data.slides.some((s) => /cover/i.test(s.role));
  const outroExists = data.slides.some((s) => /outro|closing/i.test(s.role));
  if (!coverExists) warnings.push('Cover 슬라이드 없음 (권장)');
  if (!outroExists) warnings.push('Outro 슬라이드 없음 (권장)');

  return {
    status: errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS',
    errors,
    warnings,
    slide_count: data.slides.length,
  };
}

function checkPngDir(dir) {
  if (!existsSync(dir)) {
    return { status: 'FAIL', errors: [`폴더 없음: ${dir}`] };
  }

  const files = readdirSync(dir)
    .filter((f) => /^slide-\d{2}\.png$/.test(f))
    .sort();

  const errors = [];
  const warnings = [];
  const sizes = [];

  if (files.length !== 9) {
    errors.push(`slide-*.png ${files.length}장 (기대: 9장)`);
  }

  const expected = Array.from({ length: 9 }, (_, i) => `slide-${String(i + 1).padStart(2, '0')}.png`);
  for (const name of expected) {
    if (!files.includes(name)) errors.push(`${name} 누락`);
  }

  for (const f of files) {
    const fp = join(dir, f);
    const st = statSync(fp);
    sizes.push({ file: f, kb: Math.round(st.size / 1024) });
    if (st.size < 50 * 1024) warnings.push(`${f} 너무 작음 (${Math.round(st.size / 1024)}KB, 깨진 이미지 가능)`);
    if (st.size > 3 * 1024 * 1024) warnings.push(`${f} 너무 큼 (${Math.round(st.size / 1024)}KB)`);

    const info = readImageInfo(fp);
    if (!info) {
      errors.push(`${f} 이미지 헤더 판독 불가 (PNG/JPEG 아님 또는 손상)`);
      continue;
    }
    sizes[sizes.length - 1].px = `${info.width}×${info.height}`;
    if (info.format !== 'png') warnings.push(`${f} 실제 포맷이 ${info.format.toUpperCase()} (확장자는 .png)`);
    const scale = info.width / TARGET.width;
    if (!(Number.isInteger(scale) && scale >= 1 && info.height === TARGET.height * scale)) {
      errors.push(
        `${f} 해상도 ${info.width}×${info.height} (기대: ${TARGET.width}×${TARGET.height} 또는 정수배) — 재생성이 아니라 생성기 해상도 설정 문제`,
      );
    }
  }

  return {
    status: errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS',
    errors,
    warnings,
    slide_count: files.length,
    sizes,
  };
}

function stripHtml(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

function checkHtml(target) {
  if (!existsSync(target)) {
    return { status: 'FAIL', errors: [`경로 없음: ${target}`] };
  }
  const files = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => /^slide-\d{2}\.html$/.test(f)).sort().map((f) => join(target, f))
    : [target];
  if (files.length === 0) {
    return { status: 'FAIL', errors: [`slide-*.html 없음: ${target}`] };
  }
  const banned = loadBannedWords();
  const errors = [];
  for (const fp of files) {
    errors.push(...findBannedWords(stripHtml(readFileSync(fp, 'utf-8')), basename(fp), banned));
  }
  return { status: errors.length > 0 ? 'FAIL' : 'PASS', errors, warnings: [], slide_count: files.length };
}

const CTA_ACTIONS = [
  { name: '저장', pattern: /저장|save/i },
  { name: '공유', pattern: /공유|share/i },
  { name: '팔로우', pattern: /팔로우|팔로잉|follow/i },
];
// 금칙어를 일부러 나열하는 필드 — 금칙어 검사 제외
const BRIEF_BANNED_SKIP = new Set(['saturated_patterns']);

/** 값 안의 모든 문자열 → [{ where, text }] (최상위 skip 필드 제외) */
function collectStrings(value, where, out = []) {
  if (typeof value === 'string') out.push({ where, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${where}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, where ? `${where}.${k}` : k, out);
  }
  return out;
}

function checkBrief(path) {
  if (!existsSync(path)) {
    return { status: 'FAIL', errors: [`파일 없음: ${path}`] };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return { status: 'FAIL', errors: [`JSON 파싱 실패: ${e.message}`] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { status: 'FAIL', errors: ['brief 가 JSON 객체가 아님'] };
  }

  const errors = [];
  const warnings = [];

  const outline = data.nine_slide_outline;
  if (!Array.isArray(outline)) {
    errors.push('nine_slide_outline 배열 누락');
  } else {
    if (outline.length !== 9) errors.push(`nine_slide_outline ${outline.length}장 (기대: 정확히 9장)`);
    outline.forEach((s, i) => {
      const at = `nine_slide_outline[${i}]`;
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        errors.push(`${at} 가 객체가 아님 (n / role / core_message 필요)`);
        return;
      }
      if (s.n !== i + 1) errors.push(`${at}.n 이 ${s.n} (기대: ${i + 1})`);
      if (typeof s.role !== 'string' || !s.role.trim()) errors.push(`${at}.role 누락`);
      if (typeof s.core_message !== 'string' || !s.core_message.trim()) warnings.push(`${at}.core_message 누락`);
    });
    const roleOf = (s) => (s && typeof s === 'object' && typeof s.role === 'string' ? s.role : '');
    if (outline.length > 0) {
      const first = roleOf(outline[0]);
      const last = roleOf(outline[outline.length - 1]);
      if (!/cover|커버/i.test(first)) errors.push(`첫 장 role 이 Cover 가 아님: "${first}"`);
      if (!/outro|closing|아웃트로/i.test(last)) errors.push(`마지막 장 role 이 Outro 계열이 아님: "${last}"`);
    }
  }

  const cta = data.cta_suggestion;
  if (typeof cta !== 'string' || !cta.trim()) {
    errors.push('cta_suggestion 누락');
  } else {
    const actions = CTA_ACTIONS.filter(({ pattern }) => pattern.test(cta)).map(({ name }) => name);
    if (actions.length === 0) errors.push('cta_suggestion 에 행동 없음 (저장/공유/팔로우 중 1개 필요)');
    if (actions.length > 1) errors.push(`cta_suggestion 에 행동 ${actions.length}개 (${actions.join(', ')}) — 1개만 허용`);
  }

  const banned = loadBannedWords();
  for (const [key, value] of Object.entries(data)) {
    if (BRIEF_BANNED_SKIP.has(key)) continue;
    for (const { where, text } of collectStrings(value, key)) {
      errors.push(...findBannedWords(text, where, banned));
    }
  }

  return {
    status: errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS',
    errors,
    warnings,
    slide_count: Array.isArray(outline) ? outline.length : 0,
  };
}

function icon(s) {
  return s === 'PASS' ? '✅' : s === 'WARN' ? '⚠️ ' : '❌';
}

function main() {
  const args = parseArgs(process.argv);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 캐러셀 품질 검사');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let result;
  if (args.prompt) {
    console.log(`[모드] 프롬프트 JSON 검증: ${args.prompt}`);
    result = checkPromptJson(args.prompt);
  } else if (args.dir) {
    console.log(`[모드] PNG 폴더 검증: ${args.dir}`);
    result = checkPngDir(args.dir);
  } else if (args.html) {
    console.log(`[모드] HTML 금칙어 검증: ${args.html}`);
    result = checkHtml(args.html);
  } else if (args.brief) {
    console.log(`[모드] 브리프 검증: ${args.brief}`);
    result = checkBrief(args.brief);
  } else {
    console.error('❌ --prompt <json>, --dir <folder>, --html <folder|file>, --brief <json> 중 하나 필수');
    process.exit(1);
  }

  console.log(`\n${icon(result.status)} 상태: ${result.status}`);
  console.log(`   슬라이드 수: ${result.slide_count ?? '?'} / 9`);

  if (result.errors && result.errors.length > 0) {
    console.log('\n❌ Errors:');
    result.errors.forEach((e) => console.log(`   - ${e}`));
  }
  if (result.warnings && result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach((w) => console.log(`   - ${w}`));
  }
  if (result.sizes) {
    console.log('\n📦 파일 크기:');
    result.sizes.forEach((s) => console.log(`   ${s.file}: ${s.kb} KB${s.px ? `, ${s.px}` : ''}`));
  }

  const reportPath = args.dir ? join(args.dir, 'quality-report.json') : null;
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify({ ...result, checked_at: new Date().toISOString() }, null, 2));
    console.log(`\n📄 리포트: ${reportPath}`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(result.status === 'FAIL' ? 1 : 0);
}

main();
