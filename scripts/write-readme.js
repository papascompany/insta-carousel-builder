#!/usr/bin/env node
/**
 * output/<topic>/README.md 자동 작성.
 *
 * 입력 (모두 결과 폴더 안, 없는 파일은 "기록 없음" 으로 표시):
 *   brief.json           — 주제 / 구조 / Cover 훅 / 9장 역할 (carousel-researcher)
 *   metadata.json        — 생성 이력 (두 생성기가 자동 기록)
 *   quality-report.json  — quality-check.js --dir 결과
 *   typo-report.json     — typo-check.py 결과 (나노바나나만, 선택)
 *   prompts.json         — brief 가 없을 때 9장 역할의 대체 출처 (나노바나나)
 *
 * Zero-Inference: 수치와 문구는 위 파일에 기록된 값만 옮긴다. 평균·합계·점수를 계산하거나 추정하지 않는다.
 * 같은 입력이면 같은 README 가 나온다 (작성 시각을 넣지 않음).
 *
 * 사용법:
 *   node scripts/write-readme.js --topic 2026-11-11_AIwritingtips
 *   node scripts/write-readme.js --dir output/2026-11-11_AIwritingtips
 *
 * 두 생성기가 끝날 때 자동 실행한다. typo-check 나 재검사 뒤에는 이 명령을 다시 실행해 갱신.
 */
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NONE = '기록 없음';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1]) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

/** 없거나 깨진 파일 → null */
function readJson(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const list = (v) => (Array.isArray(v) ? v : []);

/** 표 셀용: 줄바꿈 → 공백, | 이스케이프 */
function cell(v) {
  if (v === null || v === undefined || v === '') return '-';
  return String(v).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => ':---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
}

/** 9장 역할: brief 우선, 없으면 prompts.json */
function outlineRows(brief, prompts) {
  const fromBrief = list(brief?.nine_slide_outline).filter((s) => s && typeof s === 'object');
  if (fromBrief.length > 0) {
    return { source: 'brief.json', rows: fromBrief.map((s) => [s.n, s.role, s.core_message]) };
  }
  const fromPrompts = list(prompts?.slides).filter((s) => s && typeof s === 'object');
  if (fromPrompts.length > 0) {
    return { source: 'prompts.json', rows: fromPrompts.map((s) => [s.n, s.role, null]) };
  }
  return null;
}

/** 실행 1건의 결과 요약. HTML: 파일명 배열 / 나노바나나: {n, status} 배열 */
function runResult(run) {
  const slides = list(run.slides);
  if (slides.length === 0) return '-';
  if (slides.every((s) => typeof s === 'string')) return `${slides.length}장 캡처`;
  const failed = slides.filter((s) => s && s.status !== 'OK');
  const ok = `OK ${slides.length - failed.length}/${slides.length}`;
  return failed.length > 0 ? `${ok}, 실패 ${failed.map((s) => `slide-${String(s.n).padStart(2, '0')}(${s.status})`).join(', ')}` : ok;
}

function buildReadme({ folder, brief, metadata, quality, typo, prompts }) {
  const out = [];
  const title = [brief?.topic, metadata?.topic, folder].find(isText);
  const engine = metadata?.engine;
  const runs = list(metadata?.runs);
  const lastRun = runs[runs.length - 1];

  out.push(`# ${title}`, '');
  out.push('> `scripts/write-readme.js` 가 이 폴더의 JSON 기록으로 작성한 파일입니다. 직접 고치지 말고 스크립트를 다시 실행하세요.', '');

  // ── 주제
  out.push('## 주제', '');
  out.push(`- 주제: ${isText(brief?.topic) ? brief.topic : `${NONE} (brief.json 없음)`}`);
  out.push(`- 폴더: \`output/${folder}/\``);
  if (isText(brief?.researched_at)) out.push(`- 리서치 날짜: ${brief.researched_at}`);
  if (isText(brief?.target_audience)) out.push(`- 타깃: ${brief.target_audience}`);
  out.push('');

  // ── 구조
  out.push('## 구조', '');
  out.push(`- 구조: ${isText(brief?.recommended_structure) ? brief.recommended_structure : NONE}`);
  out.push(`- Outro CTA: ${isText(brief?.cta_suggestion) ? brief.cta_suggestion : NONE}`);
  out.push('');

  // ── Cover 훅
  out.push('## Cover 훅', '');
  if (isText(brief?.recommended_cover_hook)) {
    out.push(...brief.recommended_cover_hook.split('\n').map((l, i, a) => `> ${l}${i < a.length - 1 ? '  ' : ''}`));
  } else {
    out.push(NONE);
  }
  out.push('');

  // ── 9장 역할
  out.push('## 9장 역할', '');
  const outline = outlineRows(brief, prompts);
  if (outline) {
    out.push(...table(['#', '역할', '핵심 메시지'], outline.rows));
    if (outline.source !== 'brief.json') out.push('', `(출처: ${outline.source} — brief.json 없음)`);
  } else {
    out.push(NONE);
  }
  out.push('');

  // ── 생성 이력
  out.push('## 생성 이력', '');
  if (metadata) {
    out.push(`- 엔진: ${isText(engine) ? engine : NONE}`);
    if (isText(lastRun?.model)) out.push(`- 모델: ${lastRun.model}`);
    out.push(`- 마지막 갱신: ${isText(metadata.updated_at) ? metadata.updated_at : NONE}`);
    out.push('- 비용: 기록 없음 (metadata.json 은 비용을 기록하지 않음)');
    out.push('');
    if (runs.length > 0) {
      out.push(
        ...table(
          ['실행', '시작', '소요(초)', '대상', '결과'],
          runs.map((r, i) => [i + 1, r.started_at, r.duration_sec, Array.isArray(r.only) ? `slide ${r.only.join(', ')}` : '전체', runResult(r)]),
        ),
      );
    } else {
      out.push('실행 기록 없음');
    }
    if (lastRun && typeof lastRun.allow_fallback_font === 'boolean') {
      out.push('', `- 마지막 실행의 대체 폰트 허용(\`--allow-fallback-font\`): ${lastRun.allow_fallback_font ? '예 — 웹폰트가 적용되지 않았을 수 있음' : '아니오'}`);
    }
    if (lastRun && Array.isArray(lastRun.small_text_warnings)) {
      out.push(`- 마지막 실행의 모바일 가독성 경고: ${lastRun.small_text_warnings.length}건`);
      out.push(...lastRun.small_text_warnings.map((w) => `  - ${w}`));
    }
  } else {
    out.push(`${NONE} (metadata.json 없음)`);
  }
  out.push('');

  // ── 품질 결과
  out.push('## 품질 결과', '');
  out.push('### quality-check', '');
  if (quality) {
    out.push(`- 상태: **${cell(quality.status)}**`);
    if (isText(quality.checked_at)) out.push(`- 검사 시각: ${quality.checked_at}`);
    if (quality.slide_count !== undefined) out.push(`- 슬라이드 수: ${quality.slide_count}`);
    for (const e of list(quality.errors)) out.push(`- 오류: ${e}`);
    for (const w of list(quality.warnings)) out.push(`- 경고: ${w}`);
    if (list(quality.sizes).length > 0) {
      out.push('', ...table(['파일', '크기(KB)', '해상도'], quality.sizes.map((s) => [s.file, s.kb, s.px])));
    }
  } else {
    out.push(`${NONE} (quality-report.json 없음 — \`node scripts/quality-check.js --dir output/${folder}\`)`);
  }
  out.push('', '### 한글 오타 (typo-check)', '');
  if (typo) {
    out.push(`- 상태: **${cell(typo.status)}**`);
    if (isText(typo.checked_at)) out.push(`- 검사 시각: ${typo.checked_at}`);
    if (isText(typo.model)) out.push(`- 전사 모델: ${typo.model}`);
    if (list(typo.regenerate).length > 0) out.push(`- 재생성 대상: slide ${typo.regenerate.join(', ')}`);
    const flagged = list(typo.slides).filter((s) => s && (list(s.errors).length > 0 || list(s.warnings).length > 0));
    if (flagged.length > 0) {
      out.push(
        '',
        ...table(
          ['#', '상태', '내용'],
          flagged.map((s) => [s.n, s.status, [...list(s.errors), ...list(s.warnings)].join(' / ')]),
        ),
      );
    }
  } else if (engine === 'html') {
    out.push('해당 없음 (HTML 엔진은 텍스트를 그대로 렌더링하므로 typo-check 대상이 아님)');
  } else {
    out.push(`${NONE} (typo-report.json 없음 — 나노바나나 결과물이면 \`python scripts/typo-check.py --topic ${folder}\`)`);
  }
  out.push('', '### 정성 리뷰 (carousel-reviewer)', '');
  out.push('점수는 파일로 기록되지 않습니다. 리뷰 리포트는 대화 결과를 확인하세요.', '');

  // ── 업로드 전 체크리스트
  out.push('## 업로드 전 체크리스트', '');
  const todo = [];
  if (!quality) todo.push('quality-check 실행 (quality-report.json 없음)');
  else if (quality.status !== 'PASS') todo.push(`quality-check ${cell(quality.status)} 항목 해결 후 재검사`);
  if (engine !== 'html') {
    if (!typo) todo.push('typo-check 실행 (나노바나나 결과물)');
    else if (typo.status !== 'PASS') todo.push(`typo-check ${cell(typo.status)} 해결 (FAIL 은 해당 슬라이드만 재생성, ERROR 는 검사만 재실행)`);
  }
  if (lastRun?.allow_fallback_font === true) todo.push('웹폰트 적용 확인 (대체 폰트 허용 상태로 캡처됨)');
  if (list(lastRun?.small_text_warnings).length > 0) todo.push('24px 미만 텍스트 수정 후 다시 캡처');
  todo.push(
    '9장 전부 육안 검토 (오타, 미세 왜곡, 워터마크·가짜 핸들)',
    'carousel-reviewer 판정 PASS 확인',
    'Outro CTA 가 1개인지 확인',
    '수치·브랜드 표기가 knowledge/brand-facts.md 와 일치하는지 확인',
    '업로드는 수동으로 (자동 업로드 없음)',
  );
  out.push(...todo.map((t) => `- [ ] ${t}`), '');

  return out.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const dir = args.dir ? resolve(args.dir) : args.topic ? join(REPO_ROOT, 'output', args.topic) : null;
  if (!dir) {
    console.error('❌ --topic <폴더명> 또는 --dir <결과 폴더> 필수');
    process.exit(1);
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`❌ 폴더 없음: ${dir}`);
    process.exit(1);
  }

  const input = {
    folder: basename(dir),
    brief: readJson(join(dir, 'brief.json')),
    metadata: readJson(join(dir, 'metadata.json')),
    quality: readJson(join(dir, 'quality-report.json')),
    typo: readJson(join(dir, 'typo-report.json')),
    prompts: readJson(join(dir, 'prompts.json')),
  };
  if (!input.brief && !input.metadata) {
    console.error(`❌ brief.json / metadata.json 둘 다 없음: ${dir} — README 를 만들 기록이 없습니다`);
    process.exit(1);
  }

  const readmePath = join(dir, 'README.md');
  writeFileSync(readmePath, buildReadme(input));
  const missing = ['brief', 'metadata', 'quality', 'typo'].filter((k) => !input[k]);
  console.log(`📝 README 작성: ${readmePath}${missing.length > 0 ? ` (없는 기록: ${missing.join(', ')})` : ''}`);
}

main();
