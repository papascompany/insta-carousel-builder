# insta-carousel-builder — Claude Code 지시서

> 이 프로젝트는 Claude Code에서 직접 실행하는 인스타 캐러셀 자동 제작 도구입니다.
> 팀원이 "이 주제로 캐러셀 만들어줘"라고 요청하면 **리서치 → 9장 프롬프트 설계 → 나노바나나 Pro 생성 → 품질 검증**까지 수행합니다.

---

## 즉시 실행 원칙

사용자가 아래처럼 요청하면 `/carousel-new <주제>` 파이프라인을 실행합니다:

- "바이브코딩으로 캐러셀 만들어줘"
- "AI 글쓰기 7가지 꿀팁으로 인스타 카드뉴스 써줘"
- "챗GPT 프롬프트 주제로 캐러셀 9장 만들자"

수동 호출: `/carousel-quality` (단계별 실행은 해당 서브에이전트 / 스크립트를 직접 호출)

---

## 🔀 듀얼 엔진 — 어느 쪽으로 갈 것인가

이 레포는 **두 가지 이미지 생성 엔진**을 지원합니다. 사용자 요청 의도에 따라 자동 판단:

| 엔진 | 트리거 키워드 | 스크립트 | 서브에이전트 |
|:---|:---|:---|:---|
| 🍌 **나노바나나** | "AI 이미지", "빠르게", "실험", "다양한 시안" | `nanobanana-gen.py` | `carousel-prompt-writer` (JSON) |
| 🎨 **HTML/Puppeteer** | "정확하게", "광고", "법무", "한 글자 수정", "0원" | `html-carousel-gen.js` | `carousel-html-writer` (HTML) |

**자동 판단 안 될 때 — CEO에게 1줄 질문**:
> "🍌 나노바나나(Gemini, 빠른 실험) vs 🎨 HTML(정확/0원) 중 어느 엔진?"

**CEO가 명시 안 하면 기본값**: HTML/Puppeteer (정확도 우선).

나노바나나 실행 시 `429`/한도 0 오류가 나면 재시도하지 말고 CEO 에게 "Gemini API 무료 등급 — 유료 전환 필요 (README 무료 등급 안내)" 로 보고하고 HTML 엔진을 제안.

### 엔진별 Phase 3 분기

```
Phase 3a (나노바나나):
  python scripts/nanobanana-gen.py --topic <키워드> --slides templates/slides.<topic>.json

Phase 3b (HTML):
  # 1. carousel-html-writer 가 output/<topic>/slides/slide-01~09.html 작성
  # 2. node scripts/html-carousel-gen.js --topic <keyword>
```



---

## 기본 산출물 — 9장 풀세트

**모든 캐러셀 요청은 기본적으로 9장 세트를 생산합니다:**
- Cover 1장 + 본문 7장 (예: TIP 01~07) + Outro 1장
- 각 슬라이드는 `templates/slides.*.json` 의 프롬프트로 정의

9장이 아닌 개수 지정은 사용자가 명시한 경우만 수용.

---

## 품질 킬라인 (9장 각각에 적용)

| # | 기준 | 허용 범위 |
|:---:|:---|:---|
| 1 | **해상도** | 1080×1350 (4:5 인스타 권장) |
| 2 | **한글 렌더링** | 오타 없어야 함 (나노바나나: `scripts/typo-check.py` — Gemini 비전 전사 + 스크립트 판정) |
| 3 | **디자인 DNA 일관성** | 9장 배경색/폰트/액센트 컬러 통일 |
| 4 | **Cover 후킹** | 3초 내 스크롤 멈춤 가능한 헤드라인 |
| 5 | **1장당 정보 밀도** | 한 슬라이드 = 한 포인트 (여러 개 = 혼란) |
| 6 | **CTA 슬라이드** | Outro 에 저장/공유/팔로우 중 **1개만** |
| 7 | **금칙어** | `knowledge/banned-words.json` 참조 |
| 8 | **톤** | 친근한 전문가. "안녕하세요 오늘은" 같은 filler 금지 |

→ `scripts/quality-check.js` 가 생성 직후 자동 검사 (구조/개수/해상도·실제 포맷/파일 크기/금칙어 — HTML 트랙은 `--html` 로 금칙어 검사, 리서치 브리프는 `--brief` 로 9장 구조·CTA 1개·금칙어 검사). 오타 발견 시 해당 슬라이드만 `--only N` 으로 재생성.

---

## 작성 전 반드시 Read (생략 금지)

**매 작업마다**:
1. `knowledge/brand-facts.md` — 수치/브랜드 SSOT (이 파일 외 숫자 금지)
2. `knowledge/patterns/carousel-structure.md` — 9장 구조 공식
3. `templates/slides.example.json` — 프롬프트 템플릿
4. `output/_index.json` (있다면) — 최근 패턴 → 의도적으로 다른 구조 선택

**상황별 추가 Read**:
- 주제 리서치: `knowledge/reference/` (있다면)
- 톤 잡기: `knowledge/tone/` (있다면)

---

## 3-Phase Pipeline (carousel-new 풀 파이프라인)

```
Phase 1 [리서치/기획]  → carousel-researcher 서브에이전트 dispatch
                          주제 요약, 9장 구조 초안, hook 후보 생성
                          → scripts/quality-check.js --brief output/{topic}/brief.json (FAIL 이면 Phase 2 진입 금지)
Phase 2 [설계]        → 나노바나나: carousel-prompt-writer → templates/slides.{topic}.json
                          HTML(기본): carousel-html-writer → output/{topic}/slides/slide-01~09.html
Phase 3 [생성]        → 나노바나나: scripts/nanobanana-gen.py (Gemini 이미지 → 1080×1350 PNG)
                          HTML: scripts/html-carousel-gen.js (Puppeteer 캡처, 로컬 Pretendard,
                                폰트 로드 실패 시 중단, 24px 미만 텍스트 경고)
Phase 4 [품질 검증]    → scripts/quality-check.js (두 생성기가 끝날 때 자동 실행, 생성 실패·FAIL 시 exit 1)
                          → scripts/typo-check.py --topic <topic> (나노바나나만)
                            FAIL 슬라이드만 --only 로 재생성 → typo-check 재실행
                          → carousel-reviewer 서브에이전트 10항목 정성 채점
                          → scripts/write-readme.js --topic <topic> (생성기가 자동 실행, typo-check·재검사 뒤에는 다시 실행)
```

**서브에이전트 원칙**:
- 작성자(writer)와 검증자(reviewer) 분리 — 자기채점 편향 방지
- 메인 Claude는 오케스트레이터, 프롬프트는 writer 가 씀
- 파일 수정은 reviewer 가 아닌 메인/writer 가 함

---

## 출력 구조

```
output/{topic}/
├── slide-01.png ~ slide-09.png   # 1080×1350 PNG 9장
├── prompts.json                  # 사용된 프롬프트 (재현용, 나노바나나 엔진이 자동 기록)
├── metadata.json                 # 실행 이력: 시간/모델/슬라이드별 결과 (두 엔진 자동 기록, 비용은 미기록)
├── quality-report.json           # quality-check.js --dir 결과
└── README.md                     # 주제/구조/Cover 훅/9장 역할/생성 이력/품질 결과/업로드 체크리스트
                                  #   (두 생성기가 scripts/write-readme.js 로 자동 작성, 갱신: node scripts/write-readme.js --topic <topic>)

output/_index.json                # 주제별 최근 엔진/구조/Cover 훅/역할 목록 (생성기가 자동 갱신)
```

**명명 규칙**: `{YYYY-MM-DD}_{주제압축}` (공백 제거, 특수문자 금지)

---

## Zero-Inference 원칙

- 수치는 반드시 `brand-facts.md` 에서만 인용
- 이미지 생성 결과의 한글 오타 판정은 **스크립트가 수행** (LLM 판단 금지)
  - `typo-check.py`: Gemini 는 보이는 글자를 고치지 않고 전사만, 프롬프트 따옴표 안 한글 문구와의 일치 판정은 스크립트
  - 전사 실패(`ERROR`)는 오타가 아님 → 재생성하지 말고 검사만 재실행
- 스크립트 경고 발생 시 무시하지 말고 재생성

---

## 환경 설정

`.env` 파일 (git 추적 금지):
```
GEMINI_API_KEY=AIza...         # 나노바나나 엔진 사용 시만 필수 — 유료 등급(Tier 1+) 프로젝트 키여야 함 (이미지 모델은 무료 등급 불가)
GEMINI_OCR_MODEL=               # (옵션) typo-check 전사 모델, 기본 gemini-2.5-flash
ANTHROPIC_API_KEY=              # (옵션) reviewer 서브에이전트 API 호출용
```

### 의존성

```bash
# 나노바나나 엔진
pip install python-dotenv google-genai pillow

# HTML/Puppeteer 엔진
npm install   # puppeteer 자동 설치
```

- Python ≥ 3.10 (나노바나나)
- Node.js ≥ 20 (HTML/Puppeteer + 품질 체크 훅)
- (선택) Pretendard 폰트 시스템 설치 — HTML 트랙 한글 렌더링 품질 향상

---

## 주의사항

- 생성된 이미지는 **반드시 육안 검토 후 업로드** — AI 이미지 특유의 미세 왜곡 가능
- 자동 업로드 없음 (의도적 배제 — 인스타 알고리즘 패턴 탐지 회피)
- 하루 1~2 캐러셀 권장 (과도한 업로드 역효과)
- 9장 중 오타가 1~2장 나올 수 있음 (97.8% 실측치 = 9장당 0.2장 기대오류) → 해당 슬라이드만 재생성

---

## 참고

- **엔진**: `gemini-3-pro-image-preview` (별칭 `nano-banana-pro-preview`)
- **실측**: 9/9 성공, 4분 20초, 한글 97.8% (에이나우 2026-04-15)
- **원본 이관**: 에이나우 내부 `nanobanana-carousel` Skill 의 오픈소스 버전
