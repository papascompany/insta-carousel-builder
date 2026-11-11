import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const QUALITY_CHECK = join(REPO_ROOT, 'scripts', 'quality-check.js');
export const HOOK = join(REPO_ROOT, 'scripts', 'hook-post-write.js');

export function tempDir() {
  return mkdtempSync(join(tmpdir(), 'carousel-test-'));
}

// zlib.crc32 는 Node 20.15+ 에만 있어 직접 구현 (engines: node >= 20)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** 단색 RGB PNG. padKb 만큼 tEXt 로 키워 "너무 작음" 경고를 피할 수 있음 */
export function pngBytes(width, height, padKb = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (padKb > 0) parts.push(chunk('tEXt', Buffer.alloc(padKb * 1024, 0x61)));
  parts.push(chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** 헤더만 있는 최소 JPEG (SOF0 에 크기 기록) */
export function jpegBytes(width, height, padKb = 0) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(padKb * 1024), Buffer.from([0xff, 0xd9])]);
}

/** dir/slide-01..09.png 생성. make(n) → Buffer */
export function writeSlides(dir, make) {
  mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= 9; n++) {
    writeFileSync(join(dir, `slide-${String(n).padStart(2, '0')}.png`), make(n));
  }
}

export function run(script, args, input) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf-8', input });
}
