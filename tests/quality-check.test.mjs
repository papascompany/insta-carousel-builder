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
