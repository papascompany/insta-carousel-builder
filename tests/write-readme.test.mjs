import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WRITE_README, tempDir, run } from './helpers.mjs';

const BRIEF = {
  topic: '테스트 주제 | 파이프 포함',
  researched_at: '2026-11-11',
  recommended_structure: 'Before/After',
  recommended_cover_hook: '첫 줄,\n둘째 줄',
  nine_slide_outline: Array.from({ length: 9 }, (_, i) => ({
    n: i + 1,
    role: i === 0 ? 'Cover' : i === 8 ? 'Outro' : `BEFORE/AFTER 0${i}`,
    core_message: `메시지 ${i + 1}`,
  })),
  cta_suggestion: '저장',
};

const HTML_META = {
  topic: 'demo',
  engine: 'html',
  updated_at: '2026-11-11T16:04:14.619Z',
  runs: [
    { started_at: '2026-11-11T15:56:06.050Z', duration_sec: 16.1, only: null, slides: Array.from({ length: 9 }, (_, i) => `slide-0${i + 1}.png`) },
    {
      started_at: '2026-11-11T16:03:58.999Z',
      duration_sec: 3.2,
      only: [3, 7],
      slides: ['slide-03.png', 'slide-07.png'],
      allow_fallback_font: false,
      small_text_warnings: ['slide-03.html: 24px 미만 텍스트 1개'],
    },
  ],
};

const QUALITY = {
  status: 'PASS',
  errors: [],
  warnings: [],
  slide_count: 9,
  sizes: [{ file: 'slide-01.png', kb: 75, px: '2160×2700' }],
  checked_at: '2026-11-11T16:04:15.000Z',
};

function outputDir(files) {
  const dir = join(tempDir(), 'output', 'demo');
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));
  }
  return dir;
}

const readme = (dir) => readFileSync(join(dir, 'README.md'), 'utf-8');

test('HTML 결과: brief·metadata·quality-report 의 값이 그대로 들어감', () => {
  const dir = outputDir({ 'brief.json': BRIEF, 'metadata.json': HTML_META, 'quality-report.json': QUALITY });
  const r = run(WRITE_README, ['--dir', dir]);
  assert.equal(r.status, 0, r.stderr);
  const md = readme(dir);
  assert.match(md, /^# 테스트 주제 \| 파이프 포함$/m);
  assert.match(md, /- 구조: Before\/After/);
  assert.match(md, /> 첫 줄, {2}\n> 둘째 줄/);
  assert.match(md, /\| 1 \| Cover \| 메시지 1 \|/);
  assert.match(md, /\| 9 \| Outro \| 메시지 9 \|/);
  assert.match(md, /- 엔진: html/);
  assert.match(md, /\| 1 \| 2026-11-11T15:56:06\.050Z \| 16\.1 \| 전체 \| 9장 캡처 \|/);
  assert.match(md, /\| 2 \| 2026-11-11T16:03:58\.999Z \| 3\.2 \| slide 3, 7 \| 2장 캡처 \|/);
  assert.match(md, /모바일 가독성 경고: 1건/);
  assert.match(md, /- 상태: \*\*PASS\*\*/);
  assert.match(md, /\| slide-01\.png \| 75 \| 2160×2700 \|/);
  assert.match(md, /해당 없음 \(HTML 엔진/);
  assert.match(md, /- \[ \] 24px 미만 텍스트 수정 후 다시 캡처/);
  assert.doesNotMatch(md, /- \[ \] typo-check/);
});

test('Zero-Inference: 입력 파일에 없는 숫자를 만들지 않고, 같은 입력이면 같은 결과', () => {
  const files = { 'brief.json': BRIEF, 'metadata.json': HTML_META, 'quality-report.json': QUALITY };
  const dir = outputDir(files);
  run(WRITE_README, ['--dir', dir]);
  const first = readme(dir);
  run(WRITE_README, ['--dir', dir]);
  assert.equal(readme(dir), first);

  // README 의 숫자 토큰은 입력 JSON 또는 고정 문구(9장 / 24px / README 자체 설명)에 있어야 함
  const source = Object.values(files).map((f) => JSON.stringify(f)).join(' ') + ' 9 24 1 2';
  const known = new Set(source.match(/\d+/g));
  const unknown = (first.match(/\d+/g) || []).filter((n) => !known.has(n));
  assert.deepEqual(unknown, []);
});

test('나노바나나 결과: 실패 슬라이드와 typo-report 반영, brief 없으면 prompts.json 역할', () => {
  const dir = outputDir({
    'metadata.json': {
      topic: 'demo',
      engine: 'nanobanana',
      updated_at: '2026-11-11T10:00:00+00:00',
      runs: [
        {
          started_at: '2026-11-11T09:55:00+00:00',
          duration_sec: 260.4,
          model: 'gemini-3-pro-image-preview',
          only: null,
          slides: [
            { n: 1, status: 'OK' },
            { n: 2, status: 'ERR' },
          ],
        },
      ],
    },
    'prompts.json': { slides: [{ n: 1, role: 'Cover' }, { n: 2, role: 'TIP 01' }] },
    'quality-report.json': { status: 'FAIL', errors: ['slide-02.png 누락'], warnings: [], slide_count: 8 },
    'typo-report.json': {
      status: 'FAIL',
      model: 'gemini-2.5-flash',
      regenerate: [3],
      slides: [
        { n: 1, status: 'PASS', errors: [], warnings: [] },
        { n: 3, status: 'FAIL', errors: ['"컨벤션" 없음'], warnings: [] },
      ],
    },
  });
  const r = run(WRITE_README, ['--dir', dir]);
  assert.equal(r.status, 0, r.stderr);
  const md = readme(dir);
  assert.match(md, /^# demo$/m);
  assert.match(md, /- 주제: 기록 없음 \(brief\.json 없음\)/);
  assert.match(md, /\| 2 \| TIP 01 \| - \|/);
  assert.match(md, /출처: prompts\.json/);
  assert.match(md, /- 모델: gemini-3-pro-image-preview/);
  assert.match(md, /OK 1\/2, 실패 slide-02\(ERR\)/);
  assert.match(md, /- 오류: slide-02\.png 누락/);
  assert.match(md, /- 재생성 대상: slide 3/);
  assert.match(md, /\| 3 \| FAIL \| "컨벤션" 없음 \|/);
  assert.match(md, /- \[ \] quality-check FAIL 항목 해결 후 재검사/);
  assert.match(md, /- \[ \] typo-check FAIL 해결/);
});

test('기록이 없는 항목은 "기록 없음", 폴더나 기록이 아예 없으면 exit 1', () => {
  const dir = outputDir({ 'brief.json': BRIEF, 'quality-report.json': '{broken' });
  const r = run(WRITE_README, ['--dir', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /없는 기록: metadata, quality, typo/);
  const md = readme(dir);
  assert.match(md, /기록 없음 \(metadata\.json 없음\)/);
  assert.match(md, /기록 없음 \(quality-report\.json 없음/);
  assert.match(md, /- \[ \] quality-check 실행/);

  const empty = outputDir({});
  assert.equal(run(WRITE_README, ['--dir', empty]).status, 1);
  assert.equal(existsSync(join(empty, 'README.md')), false);
  assert.equal(run(WRITE_README, ['--dir', join(empty, 'none')]).status, 1);
  assert.equal(run(WRITE_README, []).status, 1);
});
