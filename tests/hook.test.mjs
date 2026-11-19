import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, HOOK, tempDir, pngBytes, writeSlides, run } from './helpers.mjs';

const payload = (filePath) => JSON.stringify({ tool_input: { file_path: filePath } });

test('slides.*.json 저장 → 스키마 검증, 정상이면 exit 0', () => {
  const r = run(HOOK, [], payload(join(REPO_ROOT, 'templates', 'slides.example.json')));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /프롬프트 JSON 감지/);
});

test('검사 FAIL 이면 exit 2 + stderr 로 결과 전달', () => {
  const file = join(tempDir(), 'slides.bad.json');
  writeFileSync(file, '{"slides":[{"n":1}]}');
  const r = run(HOOK, [], payload(file));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /상태: FAIL/);
});

test('output/<topic>/slides/slide-NN.html 저장 → 금칙어 검사', () => {
  const dir = join(tempDir(), 'output', 'demo', 'slides');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'slide-01.html');
  writeFileSync(file, '<p>대박</p>');
  const r = run(HOOK, [], payload(file));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /금칙어 "대박"/);
});

test('output/<topic>/brief.json 저장 → 브리프 검증 (정상 exit 0, 9장 아니면 exit 2)', () => {
  const dir = join(tempDir(), 'output', 'demo');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'brief.json');
  const brief = JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'sample-aiwriting', 'brief.json'), 'utf-8'));
  writeFileSync(file, JSON.stringify(brief));
  const ok = run(HOOK, [], payload(file));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /브리프 감지/);

  brief.nine_slide_outline.pop();
  writeFileSync(file, JSON.stringify(brief));
  const bad = run(HOOK, [], payload(file));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /nine_slide_outline 8장/);
});

test('output/ 밖의 brief.json 은 검사하지 않음', () => {
  const file = join(tempDir(), 'brief.json');
  writeFileSync(file, '{broken');
  const r = run(HOOK, [], payload(file));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('output/<topic>/slide-09.png 저장 → 폴더 전체 검증', () => {
  const dir = join(tempDir(), 'output', 'demo');
  writeSlides(dir, () => pngBytes(1080, 1350, 60));
  const r = run(HOOK, [], payload(join(dir, 'slide-09.png')));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /폴더 전체 검증/);
});

test('output/ 밖의 slide-09.png 는 검사하지 않음 (리포트 파일 미생성)', () => {
  const dir = join(tempDir(), 'docs', 'sample-output');
  writeSlides(dir, () => pngBytes(1080, 1350, 60));
  const r = run(HOOK, [], payload(join(dir, 'slide-09.png')));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(existsSync(join(dir, 'quality-report.json')), false);
});

test('관계없는 파일과 깨진 입력은 무시', () => {
  assert.equal(run(HOOK, [], payload('README.md')).status, 0);
  assert.equal(run(HOOK, [], 'not json').status, 0);
});
