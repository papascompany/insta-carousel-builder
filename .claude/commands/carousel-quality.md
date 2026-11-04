---
description: 이미 생성된 캐러셀 폴더의 9장 PNG 품질 검증
argument-hint: <topic 폴더명 또는 경로>
---

사용자가 **"$ARGUMENTS"** 캐러셀 폴더의 품질 검증을 요청했습니다.

## 1. 자동 검사

```bash
node scripts/quality-check.js --dir output/$ARGUMENTS
```

출력:
- 9장 PNG 존재 여부
- 해상도 1080×1350 일치 개수
- 파일 크기 분포 (너무 작으면 깨진 이미지)
- `templates/slides.<topic>.json` 스키마 검증 (있다면)

나노바나나 결과물이면 한글 오타 검사도 실행:

```bash
python scripts/typo-check.py --topic $ARGUMENTS
```

## 2. 정성 리뷰

**`carousel-reviewer` 서브에이전트 dispatch**:

> output/$ARGUMENTS 폴더의 9장 PNG 를 10항목 채점해줘.
> 한글 오타는 typo-report.json 결과 반영 + 따옴표 밖 문구는 육안 확인.
> 총점 + 상위 3개 개선 포인트 + 판정(PASS/HOLD/FAIL).

## 3. 리포트 저장

- `output/$ARGUMENTS/quality-report.json` 자동 저장
- CEO 에게 총점 + 상위 3개 지적만 요약 보고
