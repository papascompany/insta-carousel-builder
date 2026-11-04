#!/usr/bin/env node
/**
 * PostToolUse 훅 — Write/Edit 후 자동 품질 검사.
 *
 * 설정: .claude/settings.json 의 hooks.PostToolUse 에 등록.
 *
 * 동작:
 *   - templates/slides.*.json 저장 시 → quality-check.js --prompt <파일> 자동 실행
 *   - output/<topic>/slides/slide-NN.html 저장 시 → quality-check.js --html <파일> 자동 실행
 *   - output/<topic>/slide-09.png 저장 시 → 같은 폴더에 대해 quality-check.js --dir 자동 실행
 *
 * stdin 으로 PostToolUse payload 받음 (Claude Code 훅 규약).
 * 검사 FAIL 시 exit 2 + stderr 로 결과를 돌려줘 Claude 가 경고를 보고 재생성하게 함.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUALITY_CHECK = join(dirname(fileURLToPath(import.meta.url)), 'quality-check.js');

function readStdin() {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function run(args) {
  const r = spawnSync(process.execPath, [QUALITY_CHECK, ...args], { encoding: 'utf-8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) {
    process.stdout.write(out);
    return 0;
  }
  // exit 2 의 stderr 는 Claude 에게 전달된다
  process.stderr.write(out || `[hook] quality-check 실행 실패 (status=${r.status})\n`);
  return 2;
}

function main() {
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {}

  const toolInput = payload.tool_input || {};
  const filePath = toolInput.file_path || '';
  if (!filePath) return 0;

  const fname = basename(filePath);
  const dir = dirname(filePath);

  // 1) 프롬프트 JSON 저장 시
  if (/^slides\..+\.json$/.test(fname)) {
    console.log(`\n[hook] 프롬프트 JSON 감지 → 스키마 검증`);
    return run(['--prompt', filePath]);
  }

  // 2) HTML 슬라이드 저장 시 (output/<topic>/slides/slide-NN.html) — 해당 파일 금칙어 검사
  if (/^slide-\d{2}\.html$/.test(fname) && basename(dir) === 'slides' && basename(dirname(dirname(dir))) === 'output') {
    console.log(`\n[hook] HTML 슬라이드 감지 → 금칙어 검사`);
    return run(['--html', filePath]);
  }

  // 3) 슬라이드 PNG 저장 시 — 마지막 장(slide-09)일 때만 폴더 전체 검증
  // output/ 밖(docs/sample-output 등)은 검사 리포트 파일이 생기므로 제외
  if (fname === 'slide-09.png' && basename(dirname(dir)) === 'output') {
    console.log(`\n[hook] slide-09 감지 → 폴더 전체 검증`);
    return run(['--dir', dir]);
  }

  return 0;
}

process.exit(main());
