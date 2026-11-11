"""
insta-carousel-builder — 한글 오타 검사 (Gemini 비전 전사 + 스크립트 판정)

역할 분리 (CLAUDE.md Zero-Inference: 오타 판정은 스크립트가 수행):
    1. Gemini 비전: 슬라이드 PNG 의 보이는 텍스트를 "고치지 말고 그대로" 전사만 한다.
    2. 이 스크립트: 프롬프트의 따옴표 안 한글 문구(기대 텍스트)가 전사 결과에
       글자 그대로 있는지 결정적으로 비교한다.

사용법:
    python scripts/typo-check.py --topic my-topic
    python scripts/typo-check.py --topic my-topic --only 3,7
    python scripts/typo-check.py --topic my-topic --slides templates/slides.my-topic.json

기대 텍스트 출처: 기본 output/<topic>/prompts.json (nanobanana-gen.py 가 기록), 없으면 --slides.
결과: output/<topic>/typo-report.json, 오타 있으면 exit 1 + 재생성용 --only 목록 출력.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# 전사 전용 모델. 이미지 생성 모델과 별개이며 GEMINI_OCR_MODEL 로 교체 가능
DEFAULT_OCR_MODEL = os.getenv("GEMINI_OCR_MODEL", "gemini-2.5-flash")

HANGUL = re.compile(r"[가-힣]")
QUOTED = re.compile(r'"([^"]+)"|“([^”]+)”')
HANDLE = re.compile(r"@[A-Za-z0-9_.]{2,}")

OCR_PROMPT = """You are an OCR engine. Transcribe ALL text visible in this image exactly as rendered,
character by character, line by line, top to bottom.
- Do NOT correct spelling, typos, or malformed Korean syllables. If a glyph looks like "튱", write "튱".
- Do NOT translate, summarize, or add text that is not visible.
Return JSON: {"lines": ["line 1", "line 2", ...]}"""


def normalize(text: str) -> str:
    """비교용: 한글/영문/숫자만 남기고 소문자화 (공백·줄바꿈·문장부호 차이 무시)."""
    return "".join(ch for ch in text.lower() if ch.isalnum())


def expected_phrases(prompt: str) -> list[str]:
    """프롬프트의 따옴표 안 문구 중 한글이 포함된 것 = 이미지에 그대로 찍혀야 할 텍스트."""
    phrases = []
    for m in QUOTED.finditer(prompt):
        phrase = (m.group(1) or m.group(2) or "").strip()
        if HANGUL.search(phrase) and phrase not in phrases:
            phrases.append(phrase)
    return phrases


def closest(needle: str, haystack: str) -> str:
    """전사문에서 기대 문구와 가장 비슷한 같은 길이 구간 (오타 위치 표시용)."""
    if not haystack:
        return ""
    n = len(needle)
    best, best_ratio = "", 0.0
    for i in range(max(1, len(haystack) - n + 1)):
        cand = haystack[i : i + n]
        r = difflib.SequenceMatcher(None, needle, cand).ratio()
        if r > best_ratio:
            best, best_ratio = cand, r
    return best


def judge(slide: dict, lines: list[str], all_prompts: str) -> dict:
    """스크립트 판정: 기대 문구가 전사문에 글자 그대로 있는지."""
    transcript = "\n".join(lines)
    norm_t = normalize(transcript)
    checks, errors = [], []
    for phrase in expected_phrases(slide.get("prompt", "")):
        norm_p = normalize(phrase)
        ok = norm_p in norm_t
        found = None if ok else closest(norm_p, norm_t)
        checks.append({"expected": phrase, "ok": ok, "closest": found})
        if not ok:
            errors.append(f'"{phrase}" 불일치 (전사 근접: "{found}")')
    # 프롬프트에 없는 @핸들 = Gemini 가 임의로 넣은 워터마크/핸들
    warnings = [
        f"프롬프트에 없는 핸들 {h}"
        for h in sorted(set(HANDLE.findall(transcript)))
        if h not in all_prompts
    ]
    if not checks:
        warnings.append("따옴표로 지정된 한글 문구 없음 — 검사 대상 없음")
    return {
        "n": slide["n"],
        "status": "FAIL" if errors else "WARN" if warnings else "PASS",
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "transcript": lines,
    }


def transcribe(client, types, model: str, image_path: Path) -> list[str]:
    resp = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=image_path.read_bytes(), mime_type="image/png"),
            OCR_PROMPT,
        ],
        config=types.GenerateContentConfig(temperature=0, response_mime_type="application/json"),
    )
    data = json.loads(resp.text)
    lines = data.get("lines") if isinstance(data, dict) else data
    if not isinstance(lines, list):
        raise ValueError(f"전사 응답 형식 오류: {resp.text[:120]}")
    return [str(x) for x in lines]


def main() -> int:
    ap = argparse.ArgumentParser(description="한글 오타 검사 (Gemini 비전 전사 + 스크립트 판정)")
    ap.add_argument("--topic", required=True, help="output/{topic}/ 의 slide-NN.png 검사")
    ap.add_argument("--slides", default="", help="기대 텍스트용 slides JSON (기본: output/{topic}/prompts.json)")
    ap.add_argument("--only", default="", help="검사할 슬라이드 번호 (예: 3,7)")
    ap.add_argument("--model", default=DEFAULT_OCR_MODEL, help="전사용 Gemini 모델 ID")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    out_dir = REPO_ROOT / "output" / args.topic
    slides_path = Path(args.slides) if args.slides else out_dir / "prompts.json"
    if not slides_path.exists():
        print(f"[ERROR] 기대 텍스트 파일 없음: {slides_path}")
        print("        nanobanana-gen.py 로 생성했거나 --slides templates/slides.<topic>.json 을 지정하세요.")
        return 2
    data = json.loads(slides_path.read_text(encoding="utf-8"))
    slides = data.get("slides", [])
    if args.only:
        try:
            wanted = {int(x) for x in args.only.split(",") if x.strip()}
        except ValueError:
            print(f"[ERROR] --only 는 쉼표로 구분한 숫자여야 합니다: {args.only}")
            return 2
        slides = [s for s in slides if s["n"] in wanted]

    try:
        from dotenv import load_dotenv
        from google import genai
        from google.genai import types
    except ImportError as e:
        print(f"[ERROR] 의존성 누락: {e}")
        print("        pip install python-dotenv google-genai pillow")
        return 2
    load_dotenv(REPO_ROOT / ".env")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[ERROR] GEMINI_API_KEY not found in .env or environment.")
        return 2
    client = genai.Client(api_key=api_key)

    all_prompts = json.dumps(data, ensure_ascii=False)
    results = []
    for slide in slides:
        n = slide["n"]
        img = out_dir / f"slide-{n:02d}.png"
        if not img.exists():
            results.append({"n": n, "status": "FAIL", "errors": [f"{img.name} 없음"], "warnings": [], "checks": []})
            print(f"[slide-{n:02d}] FAIL  파일 없음")
            continue
        try:
            lines = transcribe(client, types, args.model, img)
        except Exception as e:  # 전사 실패는 오타와 구분 (재생성 대상 아님)
            results.append({"n": n, "status": "ERROR", "errors": [f"전사 실패: {e}"], "warnings": [], "checks": []})
            print(f"[slide-{n:02d}] ERROR 전사 실패: {str(e)[:80]}")
            continue
        r = judge(slide, lines, all_prompts)
        results.append(r)
        print(f"[slide-{n:02d}] {r['status']:5} {len(r['checks'])}개 문구 검사")
        for msg in r["errors"]:
            print(f"    ❌ {msg}")
        for msg in r["warnings"]:
            print(f"    ⚠️  {msg}")

    typo = [r["n"] for r in results if r["status"] == "FAIL"]
    failed_ocr = [r["n"] for r in results if r["status"] == "ERROR"]
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": args.model,
        "source": str(slides_path),
        "status": "FAIL" if typo else "ERROR" if failed_ocr else "PASS",
        "regenerate": typo,
        "slides": results,
    }
    (out_dir / "typo-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"\n상태: {report['status']}  (리포트: {out_dir / 'typo-report.json'})")
    if typo:
        only = ",".join(map(str, typo))
        print(f"재생성: python scripts/nanobanana-gen.py --topic {args.topic} --only {only}")
    if failed_ocr:
        print(f"전사 실패 슬라이드 {failed_ocr} — 재생성하지 말고 검사만 다시 실행")
    return 1 if typo or failed_ocr else 0


if __name__ == "__main__":
    sys.exit(main())
