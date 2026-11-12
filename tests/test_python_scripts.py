"""nanobanana-gen.py / typo-check.py 단위·통합 테스트 (Gemini 호출 없음, 가짜 클라이언트 사용).

실행: python -m unittest discover -s tests
의존성: pillow (google-genai, python-dotenv 는 불필요 — sys.modules 스텁으로 대체)
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import types
import unittest
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = REPO_ROOT / "scripts"
EXAMPLE = REPO_ROOT / "templates" / "slides.example.json"


def install_stubs() -> None:
    """google.genai / dotenv 를 import 만 되도록 스텁 처리."""
    google = types.ModuleType("google")
    genai = types.ModuleType("google.genai")
    genai.types = types.ModuleType("google.genai.types")
    google.genai = genai
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *a, **k: None
    sys.modules.update({"google": google, "google.genai": genai, "google.genai.types": genai.types, "dotenv": dotenv})


def load(name: str, filename: str):
    install_stubs()
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def image_bytes(size, fmt="JPEG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (19, 19, 22)).save(buf, format=fmt)
    return buf.getvalue()


class NormalizeImageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = load("nanobanana_gen", "nanobanana-gen.py")

    def normalize(self, size, fmt="JPEG"):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "slide-01.png"
            info = self.gen.normalize_image(image_bytes(size, fmt), out)
            with Image.open(out) as im:
                return info, im.format, im.size

    def test_gemini_jpeg_becomes_1080x1350_png(self):
        info, fmt, size = self.normalize((928, 1152))
        self.assertEqual((fmt, size), ("PNG", (1080, 1350)))
        self.assertEqual(info["source"], "JPEG 928x1152")
        self.assertLess(info["crop_ratio"], 0.01)
        self.assertTrue(info["upscaled"])

    def test_square_is_center_cropped_with_large_ratio(self):
        info, _, size = self.normalize((1024, 1024), "PNG")
        self.assertEqual(size, (1080, 1350))
        self.assertAlmostEqual(info["crop_ratio"], 0.2, places=2)

    def test_tall_image_crops_top_bottom(self):
        info, _, size = self.normalize((1080, 1600))
        self.assertEqual(size, (1080, 1350))
        self.assertFalse(info["upscaled"])
        self.assertGreater(info["crop_ratio"], 0.1)


class TypoJudgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tc = load("typo_check", "typo-check.py")

    def test_expected_phrases_only_quoted_korean(self):
        prompt = 'label "TIP 01". headline: "코딩 전에 Plan Mode 먼저" and “계획 없는 코딩”.'
        self.assertEqual(self.tc.expected_phrases(prompt), ["코딩 전에 Plan Mode 먼저", "계획 없는 코딩"])

    def test_example_template_has_phrases_for_every_slide(self):
        data = json.loads(EXAMPLE.read_text(encoding="utf-8"))
        for s in data["slides"]:
            self.assertTrue(self.tc.expected_phrases(s["prompt"]), f"slide {s['n']}")

    def test_pass_ignores_whitespace_and_punctuation(self):
        slide = {"n": 1, "prompt": 'Subtitle: "저장 필수. 하나씩 적용해보세요."'}
        r = self.tc.judge(slide, ["저장 필수", "하나씩 적용해 보세요"], "")
        self.assertEqual(r["status"], "PASS", r)

    def test_typo_fails_with_closest_match(self):
        slide = {"n": 3, "prompt": 'caption: "계획 없는 코딩은 시간 낭비."'}
        r = self.tc.judge(slide, ["계획 없는 코딩튼 시간 낭비."], "")
        self.assertEqual(r["status"], "FAIL")
        self.assertEqual(r["checks"][0]["closest"], "계획없는코딩튼시간낭비")

    def test_unknown_handle_warns(self):
        slide = {"n": 8, "prompt": 'headline: "Hooks로 품질을 자동화해라"'}
        r = self.tc.judge(slide, ["Hooks로 품질을 자동화해라", "@DevOpsPro"], "{}")
        self.assertEqual(r["status"], "WARN")
        self.assertIn("@DevOpsPro", r["warnings"][0])


FAKE_GENAI = textwrap.dedent(
    """
    import io, os
    from types import SimpleNamespace as N
    from PIL import Image

    def _img():
        buf = io.BytesIO()
        Image.new("RGB", (928, 1152), (19, 19, 22)).save(buf, format="JPEG")
        return buf.getvalue()

    class _Models:
        def generate_content(self, model, contents, config=None):
            if os.environ.get("FAKE_FAIL_ROLE") and os.environ["FAKE_FAIL_ROLE"] in contents[0]:
                raise RuntimeError("429 RESOURCE_EXHAUSTED")
            return N(candidates=[N(content=N(parts=[N(inline_data=N(data=_img()))]))])

    class Client:
        def __init__(self, api_key):
            self.models = _Models()
    """
)


class NanobananaCliTest(unittest.TestCase):
    """실제 CLI 를 가짜 genai 패키지로 실행. output/ 대신 임시 REPO 복사본에서 돌림."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        for sub in ("scripts", "templates", "knowledge"):
            shutil.copytree(REPO_ROOT / sub, self.repo / sub)
        stubs = self.tmp / "stubs"
        (stubs / "google" / "genai").mkdir(parents=True)
        (stubs / "dotenv").mkdir()
        (stubs / "google" / "genai" / "__init__.py").write_text(FAKE_GENAI, encoding="utf-8")
        (stubs / "google" / "genai" / "types.py").write_text("", encoding="utf-8")
        (stubs / "dotenv" / "__init__.py").write_text("def load_dotenv(*a, **k): pass\n", encoding="utf-8")
        self.env = {**os.environ, "PYTHONPATH": str(stubs), "GEMINI_API_KEY": "test"}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def gen(self, *args, **env):
        return subprocess.run(
            [sys.executable, str(self.repo / "scripts" / "nanobanana-gen.py"), "--topic", "t", *args],
            capture_output=True, text=True, env={**self.env, **env},
        )

    @unittest.skipUnless(shutil.which("node"), "node 필요")
    def test_full_run_writes_records_and_runs_quality_check(self):
        r = self.gen()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        out = self.repo / "output" / "t"
        # 단색 테스트 이미지는 50KB 미만이라 크기 WARN 이 정상 — 해상도/포맷 FAIL 이 없어야 함
        self.assertIn("[모드] PNG 폴더 검증", r.stdout)
        self.assertNotIn("상태: FAIL", r.stdout)
        self.assertIn("1080×1350", r.stdout)
        # 생성 요약 다음에 품질 검사 출력 (출력 순서 보장)
        self.assertLess(r.stdout.index("=== SUMMARY ==="), r.stdout.index("캐러셀 품질 검사"))
        self.assertTrue((out / "quality-report.json").exists())
        meta = json.loads((out / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(len(meta["runs"][0]["slides"]), 9)
        self.assertTrue((out / "prompts.json").exists())
        # 품질 검사 뒤 README 자동 작성 (brief 가 없으면 9장 역할은 prompts.json 에서)
        self.assertLess(r.stdout.index("캐러셀 품질 검사"), r.stdout.index("README 작성"))
        readme = (out / "README.md").read_text(encoding="utf-8")
        self.assertIn("- 엔진: nanobanana", readme)
        self.assertIn("OK 9/9", readme)
        self.assertIn("출처: prompts.json", readme)
        index = json.loads((self.repo / "output" / "_index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["carousels"][0]["topic"], "t")

    def test_only_and_failure_exit_code(self):
        r = self.gen("--only", "3,7", "--skip-check", FAKE_FAIL_ROLE="TIP 06")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("[slide-03]", r.stdout)
        self.assertNotIn("[slide-01]", r.stdout)
        self.assertIn("--only 7", r.stdout)
        self.assertIn("[HINT] 429", r.stdout)

    def test_only_rejects_unknown_numbers(self):
        r = self.gen("--only", "10", "--skip-check")
        self.assertEqual(r.returncode, 1)
        self.assertIn("slides 에 없는 번호", r.stdout)


if __name__ == "__main__":
    unittest.main()
