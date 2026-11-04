---
description: 주제 하나로 인스타 캐러셀 9장 풀세트 생성 (리서치 → 프롬프트 → 이미지 → 검증)
argument-hint: <주제/키워드>
---

사용자가 **"$ARGUMENTS"** 주제로 인스타 캐러셀을 만들어달라고 요청했습니다.

`CLAUDE.md` 의 품질 킬라인과 3-Phase Pipeline 을 따라 **9장 PNG + 검수 리포트**를 생산합니다.

---

## 0. 사전 로드 (생략 금지)

1. `knowledge/brand-facts.md` — 수치·브랜드·디자인 DNA 단일 출처
2. `knowledge/patterns/carousel-structure.md` — 9장 구조 공식
3. `knowledge/banned-words.json` — 금칙어
4. `templates/slides.example.json` — 스키마 참조

출력 폴더: `output/$(date +%Y-%m-%d)_<키워드압축>`

---

## Phase 1 — 리서치

**`carousel-researcher` 서브에이전트 dispatch**:

> "$ARGUMENTS" 주제로 인스타 캐러셀 리서치 브리프를 작성해줘.
> - 최근 이 주제 인스타 캐러셀 트렌드 (경쟁 계정 3개 분석)
> - 7가지 구조 중 이 주제에 가장 적합한 1개 선택 근거
> - 9장 outline (n, role, core_message)
> - Cover 후킹 각도 + Outro CTA
> - 결과를 `output/<폴더>/brief.json` 에 저장

---

## Phase 2 — 프롬프트 설계

**`carousel-prompt-writer` 서브에이전트 dispatch**:

> brief.json 을 읽고 Gemini 3.0 Pro Image 용 9장 프롬프트 JSON 을 작성해줘.
>
> ## 설계 원칙
> - 각 슬라이드 Prompt 는 영문 (Gemini 이미지 모델 입력)
> - common_style 은 brand-facts.md 디자인 DNA 그대로
> - 9장 전부 공통 스타일 유지
> - Cover + Outro 에 한글 렌더링 강조 마커 추가
>
> ## 출력
> - `templates/slides.<topic>.json` 에 저장 (scheme: example.json 동일)

**주의**: 저장 순간 PostToolUse 훅이 `quality-check.js --prompt templates/slides.<topic>.json` 자동 실행 — JSON 스키마 검증.

---

## Phase 3 — 이미지 생성

```bash
python scripts/nanobanana-gen.py --topic <키워드> --slides templates/slides.<topic>.json
```

실행 후:
- `output/<topic>/slide-01.png ~ slide-09.png` 생성
- 약 4분 소요, 비용 약 500~1000원
- 실패한 슬라이드가 있으면 해당 `n` 만 재실행

---

## Phase 4 — 검증

**4-1. 한글 오타 검사 (나노바나나 엔진만)**:

```bash
python scripts/typo-check.py --topic <topic>
```

- `FAIL` → 출력된 `--only N` 으로 해당 슬라이드만 재생성 후 typo-check 재실행 (최대 2회, 그래도 FAIL 이면 CEO 보고)
- `ERROR`(전사 실패) → 재생성하지 말고 typo-check 만 재실행
- 핸들/워터마크 `WARN` → 해당 슬라이드 재생성

**4-2. `carousel-reviewer` 서브에이전트 dispatch**:

> output/<topic>/ 의 9장 PNG 를 10항목 채점해줘.
> - 자동 검사: `node scripts/quality-check.js --dir output/<topic>`
> - 한글 오타: `output/<topic>/typo-report.json` 결과 반영 + 따옴표 밖 문구는 육안 확인
> - 총점 + 상위 3개 개선 포인트 + 판정 (PASS/HOLD/FAIL)
> - 직접 수정하지 말고 지적만

---

## 5. 마무리

- `output/<topic>/README.md` 자동 작성 (주제 요약 + 사용 가이드)
- `output/<topic>/metadata.json` 에 생성 메타 (비용/시간/품질점수) 기록

---

## 완료 후 CEO 에게 보고할 것

```
✅ "$ARGUMENTS" 캐러셀 9장 완성
📁 output/<topic>/

## 생성 결과
- 9/9 성공 (또는 N/9 + 실패 사유)
- 비용: 약 NNN원
- 시간: N분 N초
- 평균 파일 크기: NNN KB

## 품질 리뷰 (carousel-reviewer)
- 총점: NN/100
- 한글 오타: slide-XX (N건)
- 상위 개선 포인트 3개: [...]

## CEO 판단 필요
- 재생성 필요 슬라이드: slide-XX (이유)
- 업로드 추천: YES/NO
```
