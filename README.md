# insta-carousel-builder

> **Claude Code 하네스로 돌아가는 인스타 캐러셀 자동 제작 도구.**
> **듀얼 엔진**: 나노바나나 Pro(Gemini 3.0 Pro Image) + HTML/CSS+Puppeteer.

AI 이미지 도구로 인스타 캐러셀을 만들면 한글이 깨지고 AI 티가 나서 결국 수작업/외주로 돌아간다 — 는 통념을, **두 엔진 골라 쓰기**로 깨는 레포입니다.

**👀 실제 결과물 → [`docs/sample-output/`](./docs/sample-output/) (나노바나나) / [`docs/sample-html/`](./docs/sample-html/) (HTML)**

## 듀얼 엔진 비교

| 비교 | 🍌 나노바나나 (Gemini API) | 🎨 HTML/Puppeteer |
|:---|:---|:---|
| **명령어** | `python scripts/nanobanana-gen.py` | `node scripts/html-carousel-gen.js` |
| **한글 정확도** | 88~98% (비결정적) | **100% (결정적)** |
| **비용** | ~500~1000원 / 9장 | **0원** |
| **시간** | ~4분 30초 | ~30초 (캡처만) |
| **디자인 자유도** | AI 해석 (가끔 워터마크) | **100% 통제** |
| **수정 용이성** | 재생성 필요 | **한 글자도 즉시 Edit** |
| **디자인 다양성** | 매번 다름 | 템플릿 한정 |
| **Best for** | 빠른 실험 / A/B 시안 / 디자인 실험 | 광고 / 법무 / 브랜드 / 텍스트 정확성 |

→ "**상황 따라 골라 쓴다**" 가 핵심.

---

## 이게 뭐예요?

에이나우(AINOW) 내부에서 실사용 중인 인스타 캐러셀 생성 파이프라인을 오픈소스로 공개한 버전입니다.

- ✅ `.env` 에 Gemini API 키 하나 + `npx` 한 줄이면 재현 가능
- ✅ `templates/slides.example.json` 의 프롬프트 9개만 수정하면 본인 콘텐츠로 교체
- ✅ Claude Code `.claude/agents/` + `.claude/commands/` 하네스로 품질 검증까지 자동화
- ✅ 디자인 DNA(`#131316` + `#CF5C3F` + Pretendard) 유지된 채로 주제만 바뀜

---

## 빠른 시작 (Quickstart)

```bash
# 1. 레포 clone
git clone https://github.com/ainow/insta-carousel-builder.git
cd insta-carousel-builder

# 2. 의존성 설치
pip install python-dotenv google-genai
npm install  # (optional, 품질 체크 훅용)

# 3. API 키 세팅
cp .env.example .env
# .env 열어서 GEMINI_API_KEY 채우기 — https://aistudio.google.com/apikey

# 4. 기본 예제 생성 (에이나우 Claude Code 7가지 꿀팁)
python scripts/nanobanana-gen.py --topic claude-code-tips

# 5. 본인 주제로 수정
# templates/slides.example.json 을 복사해서 프롬프트 9장 수정
cp templates/slides.example.json templates/slides.my-topic.json
# 수정 후:
python scripts/nanobanana-gen.py --topic my-topic --slides templates/slides.my-topic.json
```

결과: `output/{topic}/slide-01.png ~ slide-09.png`

---

## 왜 이 레포인가? (Why)

시중의 AI 이미지 캐러셀 도구 대부분은 3가지 중 하나가 부족합니다:

| 문제 | 이 레포의 해법 |
|:---|:---|
| ❌ 한글 깨짐 | ✅ Gemini 3.0 Pro Image — 한글 네이티브 렌더링 (실측 97.8%) |
| ❌ 매번 다른 디자인 | ✅ `common_style` 고정 DNA로 9장 통일 |
| ❌ 생성 후 일일이 포토샵 | ✅ 1080×1350 PNG 바로 업로드 가능 |

---

## 구조

```
insta-carousel-builder/
├── CLAUDE.md                   # Claude Code 지시서 (에이전트 진입점)
├── .claude/
│   ├── agents/                 # 서브에이전트 (researcher / writer / reviewer)
│   └── commands/               # /carousel-new, /carousel-quality 등
├── knowledge/                  # 브랜드 팩트 / 톤 / 패턴 (커스터마이즈 포인트)
├── templates/
│   └── slides.example.json    # 9장 프롬프트 예제 (복사해서 수정)
├── scripts/
│   ├── nanobanana-gen.py      # 이미지 생성기 (Python, Gemini SDK)
│   ├── html-carousel-gen.js   # HTML → PNG 캡처 (Puppeteer)
│   ├── quality-check.js       # 구조/해상도/파일 검사 (Node.js)
│   └── hook-post-write.js     # PostToolUse 훅 → quality-check 자동 실행
├── output/                     # 생성 결과 (gitignored)
└── docs/                       # 샘플 결과물 (sample-output / sample-html)
```

---

---

## 샘플 결과 (실측, 2026-04-15)

`docs/sample-output/slide-01.png ~ slide-09.png` 가 실제 생성된 9장입니다.
주제: **"Claude Code 7가지 꿀팁"** (`templates/slides.example.json` 그대로 실행).

| 항목 | 결과 |
|:---|:---|
| 생성 성공률 | **9/9 (100%)** |
| 총 소요 시간 | 4분 28초 (24~31초/장) |
| 평균 파일 크기 | 487 KB |
| 해상도 | 1080×1350 (4:5) |
| 한글 정확도 (육안 표본) | 4장 중 3장 완벽, 1장 한글자 변형 (88%) |

### 알려진 한계

- **한글 정확도 비결정성**: 같은 프롬프트라도 세션마다 1~2글자 변형 가능 (`통` → `튱` 등). 100% 정확 보장 안 됨 → **생성 후 육안 검수 필수**
- **가끔 가짜 인스타 핸들/워터마크 추가**: Gemini 가 학습 데이터 영향으로 본 적 없는 핸들(예: `@DevOpsPro`) 을 자체 추가하는 경우 있음 → 발견 시 해당 슬라이드만 재생성
- **한글 오타 자동 감지 미구현**: 현재 OCR 기반 오타 감지 없음. `carousel-reviewer` 서브에이전트가 LLM 비전으로 점검

### 재생성 팁

오타 1~2장은 `--only` 로 해당 슬라이드만 재생성 (나머지 PNG 는 그대로 유지):

```bash
python scripts/nanobanana-gen.py --topic claude-code-tips --only 3,7
```

---

## 라이선스

MIT. 자유롭게 포크/수정/재배포. 크레딧은 환영이지만 강제 아닙니다.

---

## 만든 곳

**에이나우(AINOW)** — AI 생산자 양성 플랫폼.
- 인스타그램: [@ai.ainow](https://instagram.com/ai.ainow)
- 이 레포가 실제로 어떻게 만들어졌는지 궁금하면: [에이나우 유튜브 채널](https://youtube.com/@신영선의AI탐구)

> *"AI 이미지는 한글이 깨진다"는 통념이 2026년 현재 깨졌습니다.
> 이 레포는 그 증거입니다.*
