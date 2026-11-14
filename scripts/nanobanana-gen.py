"""
insta-carousel-builder — 나노바나나 Pro(Gemini 3.0 Pro Image) 인스타 캐러셀 생성기

사용법:
    # 1. .env 에 GEMINI_API_KEY=... 추가 (.env.example 참고)
    # 2. slides.json 에 9장 프롬프트 수정 (또는 기본 예제 그대로 사용)
    # 3. 실행:
    python scripts/nanobanana-gen.py --topic my-topic
    # 오타 난 슬라이드만 재생성:
    python scripts/nanobanana-gen.py --topic my-topic --only 3,7

결과:
    output/{topic}/slide-01.png ~ slide-09.png

참고:
    - 모델: gemini-3-pro-image-preview (별칭 nano-banana-pro-preview)
    - 한글 정확도 실측: 97.8% (에이나우 2026-04-15 9장 테스트 기준)
    - 1장당 약 25초 / 9장 약 4분
    - 비용: 9장당 약 $1.2 (Pro 공식 단가, 2026-11) — Gemini API 유료 등급 필수 (이미지 모델 무료 등급 불가)
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    from google import genai
    from google.genai import types
    from PIL import Image
except ImportError as e:
    print(f"[ERROR] 의존성 누락: {e}")
    print("        pip install python-dotenv google-genai pillow")
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SLIDES_JSON = REPO_ROOT / "templates" / "slides.example.json"
TARGET_SIZE = (1080, 1350)  # 인스타 4:5 (CLAUDE.md 품질 킬라인 #1)
CROP_WARN_RATIO = 0.05  # 한 변이 5% 넘게 잘리면 경고 (가장자리 텍스트 손실 위험)


def normalize_image(blob: bytes, out_path: Path) -> dict:
    """Gemini 응답 이미지(JPEG/PNG, 임의 크기)를 1080×1350 PNG 로 변환.

    비율이 4:5 와 다르면 중앙 기준으로 넘치는 쪽만 잘라낸 뒤(cover) 리사이즈한다.
    """
    with Image.open(io.BytesIO(blob)) as im:
        src_format = im.format
        src_w, src_h = im.size
        im = im.convert("RGB")
        tw, th = TARGET_SIZE
        if src_w * th > src_h * tw:  # 원본이 더 넓음 → 좌우 크롭
            crop_w = round(src_h * tw / th)
            left = (src_w - crop_w) // 2
            box = (left, 0, left + crop_w, src_h)
        else:  # 원본이 더 높음 → 상하 크롭
            crop_h = round(src_w * th / tw)
            top = (src_h - crop_h) // 2
            box = (0, top, src_w, top + crop_h)
        cropped = im.crop(box)
        crop_ratio = 1 - (cropped.width * cropped.height) / (src_w * src_h)
        cropped.resize(TARGET_SIZE, Image.Resampling.LANCZOS).save(out_path, format="PNG", optimize=True)
    return {
        "source": f"{src_format} {src_w}x{src_h}",
        "crop_ratio": round(crop_ratio, 4),
        "upscaled": src_w < tw or src_h < th,
    }


def load_slides(slides_path: Path) -> list[dict]:
    if not slides_path.exists():
        print(f"[ERROR] slides 파일 없음: {slides_path}")
        print(f"        templates/slides.example.json 을 복사해서 수정하세요.")
        sys.exit(1)
    with slides_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    slides = data.get("slides", [])
    if len(slides) != 9:
        print(f"[WARN] 슬라이드 개수 {len(slides)} (권장: 9장 — 인스타 캐러셀 최대)")
    return slides


def render_prompt(slide: dict, common_style: str) -> str:
    return f"{common_style}\n\n{slide['prompt']}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def run_quality_check(out_dir: Path) -> int | None:
    """생성 직후 quality-check.js --dir 실행 (Bash 로 실행된 스크립트 산출물은 훅이 안 걸리므로).

    반환: quality-check 종료 코드, node 가 없으면 None.
    """
    node = shutil.which("node")
    if not node:
        print("\n[WARN] node 없음 — quality-check 생략. 직접 실행: node scripts/quality-check.js --dir", out_dir)
        return None
    sys.stdout.flush()  # 파이프로 실행될 때 node 출력이 앞질러 찍히지 않게
    r = subprocess.run([node, str(REPO_ROOT / "scripts" / "quality-check.js"), "--dir", str(out_dir)])
    return r.returncode


def run_write_readme(out_dir: Path) -> None:
    """결과 폴더 README 작성 (write-readme.js). 실패해도 생성 결과(종료 코드)에는 영향 없음."""
    node = shutil.which("node")
    if not node:
        return
    sys.stdout.flush()
    r = subprocess.run([node, str(REPO_ROOT / "scripts" / "write-readme.js"), "--dir", str(out_dir)])
    if r.returncode != 0:
        print("[WARN] README 작성 실패 — 직접 실행: node scripts/write-readme.js --dir", out_dir)


def record_run(out_dir: Path, topic: str, engine: str, run: dict, roles: list[str]) -> None:
    """output/<topic>/metadata.json 에 실행 이력 추가, output/_index.json 에 주제 요약 갱신."""
    meta_path = out_dir / "metadata.json"
    meta = read_json(meta_path, {})
    meta.update({"topic": topic, "engine": engine, "updated_at": run["finished_at"]})
    meta.setdefault("runs", []).append(run)
    write_json(meta_path, meta)

    brief = read_json(out_dir / "brief.json", {})
    index_path = out_dir.parent / "_index.json"
    index = read_json(index_path, {"carousels": []})
    entries = [e for e in index.get("carousels", []) if e.get("topic") != topic]
    entries.append({
        "topic": topic,
        "engine": engine,
        "updated_at": run["finished_at"],
        "structure": brief.get("recommended_structure"),
        "cover_hook": brief.get("recommended_cover_hook"),
        "roles": roles,
    })
    entries.sort(key=lambda e: e.get("updated_at") or "", reverse=True)
    index["carousels"] = entries
    write_json(index_path, index)


def main():
    ap = argparse.ArgumentParser(description="나노바나나 Pro 인스타 캐러셀 생성기")
    ap.add_argument("--topic", default="default", help="출력 폴더명. output/{topic}/ 에 저장")
    ap.add_argument("--slides", default=str(DEFAULT_SLIDES_JSON), help="slides.json 경로")
    ap.add_argument("--model", default="gemini-3-pro-image-preview", help="Gemini 이미지 모델 ID")
    ap.add_argument("--dry-run", action="store_true", help="API 호출 없이 프롬프트만 출력")
    ap.add_argument("--skip-check", action="store_true", help="생성 후 quality-check 자동 실행 생략")
    ap.add_argument("--only", default="", help="재생성할 슬라이드 번호 (예: 3 또는 3,7). 나머지 PNG 는 유지")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    load_dotenv(REPO_ROOT / ".env")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key and not args.dry_run:
        print("[ERROR] GEMINI_API_KEY not found in .env or environment.")
        print("        .env.example 을 복사해서 .env 를 만들고 키를 추가하세요.")
        print("        키 발급: https://aistudio.google.com/apikey")
        sys.exit(1)

    slides_path = Path(args.slides)
    data = json.loads(slides_path.read_text(encoding="utf-8"))
    common_style = data.get("common_style", "")
    slides = data.get("slides", [])

    if args.only:
        try:
            wanted = {int(x) for x in args.only.split(",") if x.strip()}
        except ValueError:
            print(f"[ERROR] --only 는 쉼표로 구분한 숫자여야 합니다: {args.only}")
            sys.exit(1)
        missing = sorted(wanted - {s["n"] for s in slides})
        if missing:
            print(f"[ERROR] slides 에 없는 번호: {missing}")
            sys.exit(1)
        slides = [s for s in slides if s["n"] in wanted]

    out_dir = REPO_ROOT / "output" / args.topic
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        print(f"[DRY RUN] {len(slides)} slides, output: {out_dir}")
        for slide in slides:
            print(f"\n--- slide-{slide['n']:02d} ({slide.get('role','?')}) ---")
            print(render_prompt(slide, common_style)[:500])
        return

    client = genai.Client(api_key=api_key)
    summary = []
    started_at = now_iso()
    quota_hint_shown = False
    t_run = time.time()

    for slide in slides:
        n = slide["n"]
        out_path = out_dir / f"slide-{n:02d}.png"
        prompt = render_prompt(slide, common_style)

        print(f"[slide-{n:02d}] generating {slide.get('role','?')}...", end=" ", flush=True)
        t0 = time.time()
        try:
            resp = client.models.generate_content(model=args.model, contents=[prompt])
            norm = None
            for part in resp.candidates[0].content.parts:
                if getattr(part, "inline_data", None) and part.inline_data.data:
                    blob = part.inline_data.data
                    if isinstance(blob, str):
                        blob = base64.b64decode(blob)
                    norm = normalize_image(blob, out_path)
                    break
            dt = time.time() - t0
            if norm:
                kb = out_path.stat().st_size / 1024
                note = f"{norm['source']} → {TARGET_SIZE[0]}x{TARGET_SIZE[1]} PNG, crop {norm['crop_ratio']:.1%}"
                print(f"OK ({dt:.1f}s, {kb:.0f}KB, {note}) -> {out_path.name}")
                if norm["crop_ratio"] > CROP_WARN_RATIO:
                    print(f"  [WARN] 4:5 비율과 차이가 커서 {norm['crop_ratio']:.1%} 잘림 — 가장자리 텍스트 확인 필요")
                summary.append((n, "OK", f"{dt:.1f}s", f"{kb:.0f}KB", norm))
            else:
                print(f"FAIL ({dt:.1f}s, no image in response)")
                summary.append((n, "FAIL_NO_IMG", f"{dt:.1f}s", "-", None))
        except Exception as e:
            dt = time.time() - t0
            print(f"ERR ({dt:.1f}s): {e}")
            if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and not quota_hint_shown:
                quota_hint_shown = True
                print("  [HINT] 429 = 한도 초과. 모든 슬라이드가 429 면 무료 등급 키일 가능성이 큼")
                print("         (이미지 모델은 무료 등급 한도 0). Tier 1 프로젝트 키인지 확인 — README '무료 등급 안내'.")
                print("         결제 없이 진행하려면 HTML 엔진(html-carousel-gen.js)을 사용하세요.")
            summary.append((n, "ERR", f"{dt:.1f}s", str(e)[:60], None))

    # 재현용 프롬프트 (--only 실행이어도 전체 slides JSON 기준)
    write_json(out_dir / "prompts.json", {"source": str(slides_path), "model": args.model, **data})
    record_run(
        out_dir,
        args.topic,
        "nanobanana",
        {
            "started_at": started_at,
            "finished_at": now_iso(),
            "duration_sec": round(time.time() - t_run, 1),
            "model": args.model,
            "only": sorted(s["n"] for s in slides) if args.only else None,
            "slides": [
                {"n": n, "status": status, "time": dt, "info": info, "image": norm}
                for n, status, dt, info, norm in summary
            ],
        },
        [s.get("role", "") for s in data.get("slides", [])],
    )

    print("\n=== SUMMARY ===")
    for n, status, dt, info, _ in summary:
        print(f"  slide-{n:02d}  {status:12}  {dt:>7}  {info}")
    print(f"\nOutput: {out_dir}")

    failed = [n for n, status, *_ in summary if status != "OK"]
    check = None if args.skip_check else run_quality_check(out_dir)
    run_write_readme(out_dir)  # quality-report.json 을 읽으므로 검사 뒤에 실행
    if failed:
        print(f"[FAIL] 생성 실패 슬라이드 {failed} → --only {','.join(map(str, failed))} 로 재시도")
    if failed or check == 1:
        sys.exit(1)


if __name__ == "__main__":
    main()
