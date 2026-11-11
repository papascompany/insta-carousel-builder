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
| **비용** | 9장당 약 $1.2 (Pro) / 약 $0.6 (Flash) — **유료 등급 필수** | **0원** (API 키 불필요) |
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

## 💳 Gemini API 무료 등급 안내

**나노바나나 엔진(이미지 생성)은 Gemini API 무료 등급에서 사용할 수 없습니다.** 결제 계정이 연결된 프로젝트(Tier 1 이상)의 API 키가 필요합니다. 무료 등급 프로젝트에서 호출하면 한도 0 으로 `429` 오류가 납니다.

| 기능 | 무료 등급 | 비고 |
|:---|:---:|:---|
| 🍌 나노바나나 생성 (`gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`) | ❌ | 이미지 모델은 유료 전용 |
| 🎨 HTML/Puppeteer 생성 | ✅ | Gemini 미사용 |
| `quality-check.js` (구조·해상도·금칙어) | ✅ | 로컬 실행 |
| `typo-check.py` (한글 오타) | ✅ | 텍스트 모델(Flash 계열) 사용 — 모델별 무료 여부는 공식 가격표 확인 |

**공식 단가 (2026-11 기준, 이미지 1장)**: Pro 1K/2K 약 $0.134 · 4K 약 $0.24 / Flash 1K 약 $0.067. 9장 기준 Pro 약 $1.2, Flash 약 $0.6 (재생성·오타 검사 비용 별도). 가격과 무료 범위는 자주 바뀌므로 사용 전 [공식 가격표](https://ai.google.dev/gemini-api/docs/pricing) 를 확인하세요.

**유료 등급 전환 체크리스트**
1. Google Cloud 콘솔 → 결제 계정을 무료 체험판에서 유료로 업그레이드하고 결제 수단 인증
2. AI Studio 에서 **그 결제 계정에 연결된 프로젝트**로 API 키 발급 (연결 안 된 프로젝트의 키는 계속 무료 등급)
3. AI Studio 결제 화면에서 등급이 Tier 1 로 표시되는지 확인
4. 1장만 시험 생성: `python scripts/nanobanana-gen.py --topic test --only 1`

> GCP 크레딧(예: Google Developer Program 크레딧)이 있어도 등급이 무료이면 API 호출에 쓰이지 않습니다. 크레딧 적용 범위는 Cloud 콘솔 → 결제 → 크레딧에서 확인하세요.

**결제 없이 시작하려면 HTML 엔진**을 쓰세요: `docs/sample-html/` 9장을 `output/<topic>/slides/` 에 복사 후 `node scripts/html-carousel-gen.js --topic <topic>`.

---

## 빠른 시작 (Quickstart)

```bash
# 1. 레포 clone
git clone https://github.com/ainow/insta-carousel-builder.git
cd insta-carousel-builder

# 2. 의존성 설치
pip install python-dotenv google-genai pillow
npm install  # (optional, 품질 체크 훅용)

# 3. API 키 세팅 (나노바나나는 유료 등급 키 필요 — 위 "무료 등급 안내" 참고)
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
│   ├── typo-check.py          # 한글 오타 검사 (Gemini 비전 전사 + 스크립트 판정)
│   └── hook-post-write.js     # PostToolUse 훅 → Claude 가 직접 쓴 JSON/HTML 저장 시 quality-check
├── tests/                      # node --test + unittest (Gemini 호출 없음)
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
| 평균 파일 크기 | 1162 KB (PNG) — Gemini 원본 JPEG 기준 487 KB |
| 해상도 | 1080×1350 (4:5) — Gemini 원본 928×1152 JPEG 를 `nanobanana-gen.py` 정규화(중앙 크롭 0.65% + 리사이즈)로 변환 |
| 한글 정확도 (육안 표본) | 4장 중 3장 완벽, 1장 한글자 변형 (88%) |

### 알려진 한계

- **한글 정확도 비결정성**: 같은 프롬프트라도 세션마다 1~2글자 변형 가능 (`통` → `튱` 등). 100% 정확 보장 안 됨 → **생성 후 육안 검수 필수**
- **출력 크기 보정**: Gemini 응답(예: 928×1152 JPEG)은 중앙 크롭 후 1080×1350 PNG 로 자동 변환. 4:5 와 비율 차이가 커서 5% 넘게 잘리면 경고 출력
- **가끔 가짜 인스타 핸들/워터마크 추가**: Gemini 가 학습 데이터 영향으로 본 적 없는 핸들(예: `@DevOpsPro`) 을 자체 추가하는 경우 있음 → 발견 시 해당 슬라이드만 재생성
- **한글 오타 자동 감지**: `python scripts/typo-check.py --topic <topic>` — Gemini 비전이 글자를 그대로 전사하고, 프롬프트의 따옴표 안 한글 문구와 일치하는지 스크립트가 판정. 따옴표로 지정하지 않은 문구는 검사 대상이 아님

### 재생성 팁

오타 1~2장은 `--only` 로 해당 슬라이드만 재생성 (나머지 PNG 는 그대로 유지):

```bash
python scripts/nanobanana-gen.py --topic claude-code-tips --only 3,7
```

---

## 개발 / 테스트

```bash
npm test   # quality-check·훅 (Node) + 이미지 정규화·오타 판정·생성기 CLI (Python, pillow 필요)
```

- 테스트는 Gemini / Puppeteer 를 호출하지 않습니다 (가짜 클라이언트). GitHub Actions 가 PR 마다 실행합니다.
- 두 생성기는 끝날 때 `quality-check.js --dir` 를 자동 실행합니다 (`--skip-check` 로 생략). 생성 실패나 검사 FAIL 이면 exit 1.
- `--only` 는 두 생성기 모두 `3,7` 처럼 쉼표 구분.

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
