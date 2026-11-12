import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, QUALITY_CHECK, tempDir, pngBytes, jpegBytes, writeSlides, run } from './helpers.mjs';

const EXAMPLE = join(REPO_ROOT, 'templates', 'slides.example.json');

test('--prompt: 예제 slides JSON 은 PASS', () => {
  const r = run(QUALITY_CHECK, ['--prompt', EXAMPLE]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /상태: PASS/);
});

test('--prompt: 금칙어가 들어간 프롬프트는 FAIL', () => {
  const data = JSON.parse(readFileSync(EXAMPLE, 'utf-8'));
  data.slides[2].prompt += ' 텍스트: "여러분 대박 꿀팁"';
  const file = join(tempDir(), 'slides.bad.json');
  writeFileSync(file, JSON.stringify(data));
  const r = run(QUALITY_CHECK, ['--prompt', file]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /slide-03: 금칙어 "대박"/);
  assert.match(r.stdout, /slide-03: 금칙어 "여러분"/);
});

test('--prompt: n 순서가 틀리면 FAIL', () => {
  const data = JSON.parse(readFileSync(EXAMPLE, 'utf-8'));
  data.slides[0].n = 5;
  const file = join(tempDir(), 'slides.order.json');
  writeFileSync(file, JSON.stringify(data));
  const r = run(QUALITY_CHECK, ['--prompt', file]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /slides\[0\]\.n 이 5/);
});

for (const [w, h] of [
  [1080, 1350],
  [2160, 2700],
]) {
  test(`--dir: ${w}×${h} PNG 9장은 PASS`, () => {
    const dir = tempDir();
    writeSlides(dir, () => pngBytes(w, h, 60));
    const r = run(QUALITY_CHECK, ['--dir', dir]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /상태: PASS/);
    assert.ok(existsSync(join(dir, 'quality-report.json')));
  });
}

test('--dir: 4:5 정수배가 아닌 해상도는 FAIL', () => {
  const dir = tempDir();
  writeSlides(dir, () => pngBytes(1000, 1350, 60));
  const r = run(QUALITY_CHECK, ['--dir', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /해상도 1000×1350/);
});

test('--dir: 확장자 .png 인 JPEG 는 포맷 경고, 크기 판독', () => {
  const dir = tempDir();
  writeSlides(dir, () => jpegBytes(1080, 1350, 60));
  const r = run(QUALITY_CHECK, ['--dir', dir]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /상태: WARN/);
  assert.match(r.stdout, /실제 포맷이 JPEG/);
  assert.match(r.stdout, /1080×1350/);
});

test('--dir: 누락 슬라이드와 판독 불가 파일은 FAIL', () => {
  const dir = tempDir();
  writeSlides(dir, (n) => (n === 5 ? Buffer.alloc(60 * 1024) : pngBytes(1080, 1350, 60)));
  const r = run(QUALITY_CHECK, ['--dir', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /slide-05\.png 이미지 헤더 판독 불가/);
});

test('--html: 보이는 텍스트의 금칙어만 FAIL (주석/style 제외)', () => {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slide-01.html'), '<body><!-- 여러분 --><style>.a{content:"대박"}</style><h1>정상 문구</h1></body>');
  writeFileSync(join(dir, 'slide-02.html'), '<body><p>안녕하세요 레전드</p></body>');
  const r = run(QUALITY_CHECK, ['--html', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /slide-02\.html: 금칙어 "레전드"/);
  assert.doesNotMatch(r.stdout, /slide-01\.html/);
});

test('--html: 샘플 HTML 9장은 PASS', () => {
  const r = run(QUALITY_CHECK, ['--html', join(REPO_ROOT, 'docs', 'sample-html')]);
  assert.equal(r.status, 0, r.stdout);
});

function validBrief() {
  const body = Array.from({ length: 7 }, (_, i) => ({ n: i + 2, role: `TIP 0${i + 1}`, core_message: `포인트 ${i + 1}` }));
  return {
    topic: '테스트 주제',
    recommended_structure: '팁 나열',
    recommended_cover_hook: '첫 줄\n둘째 줄',
    nine_slide_outline: [
      { n: 1, role: 'Cover', core_message: '후킹' },
      ...body,
      { n: 9, role: 'Outro', core_message: '저장 유도' },
    ],
    saturated_patterns: ['"대박 꿀팁" 식 과장 표현'],
    cta_suggestion: "저장 — '다음에 꺼내 보게 저장해 두세요'",
  };
}

function runBrief(brief) {
  const file = join(tempDir(), 'brief.json');
  writeFileSync(file, typeof brief === 'string' ? brief : JSON.stringify(brief));
  return run(QUALITY_CHECK, ['--brief', file]);
}

test('--brief: 정상 브리프는 PASS (saturated_patterns 의 금칙어는 검사 제외)', () => {
  const r = runBrief(validBrief());
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /상태: PASS/);
  assert.match(r.stdout, /슬라이드 수: 9 \/ 9/);
});

test('--brief: 9장이 아니면 FAIL', () => {
  const brief = validBrief();
  brief.nine_slide_outline.splice(4, 1);
  const r = runBrief(brief);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /nine_slide_outline 8장/);
});

test('--brief: n 순서 오류, role 누락, 객체가 아닌 항목은 FAIL', () => {
  const brief = validBrief();
  brief.nine_slide_outline[2].n = 7;
  delete brief.nine_slide_outline[3].role;
  brief.nine_slide_outline[4] = '... 9장 전부';
  const r = runBrief(brief);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /nine_slide_outline\[2\]\.n 이 7 \(기대: 3\)/);
  assert.match(r.stdout, /nine_slide_outline\[3\]\.role 누락/);
  assert.match(r.stdout, /nine_slide_outline\[4\] 가 객체가 아님/);
});

test('--brief: 첫 장 Cover / 마지막 장 Outro 가 아니면 FAIL', () => {
  const brief = validBrief();
  brief.nine_slide_outline[0].role = 'TIP 00';
  brief.nine_slide_outline[8].role = 'TIP 08';
  const r = runBrief(brief);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /첫 장 role 이 Cover 가 아님: "TIP 00"/);
  assert.match(r.stdout, /마지막 장 role 이 Outro 계열이 아님: "TIP 08"/);
});

test('--brief: CTA 행동이 2개이거나 없으면 FAIL', () => {
  const two = validBrief();
  two.cta_suggestion = '저장하고 친구에게 공유';
  const r2 = runBrief(two);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /cta_suggestion 에 행동 2개 \(저장, 공유\)/);

  const none = validBrief();
  none.cta_suggestion = '댓글 남기기';
  const r0 = runBrief(none);
  assert.equal(r0.status, 1);
  assert.match(r0.stdout, /cta_suggestion 에 행동 없음/);
});

test('--brief: saturated_patterns 밖의 금칙어는 위치와 함께 FAIL', () => {
  const brief = validBrief();
  brief.nine_slide_outline[1].core_message = '레전드 활용법';
  brief.recommended_cover_hook = '여러분, 이건 꼭';
  const r = runBrief(brief);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /nine_slide_outline\[1\]\.core_message: 금칙어 "레전드"/);
  assert.match(r.stdout, /recommended_cover_hook: 금칙어 "여러분"/);
  assert.doesNotMatch(r.stdout, /saturated_patterns/);
});

test('--brief: 깨진 JSON 과 없는 파일은 FAIL', () => {
  assert.equal(runBrief('{not json').status, 1);
  assert.equal(run(QUALITY_CHECK, ['--brief', join(tempDir(), 'none.json')]).status, 1);
});
