# 문서 (docs/)

Minesweeper — 채용 이해충돌 관계자 추출 시스템의 상세 문서 모음입니다. 프로젝트 개요·빠른 시작은 저장소
루트의 [../README.md](../README.md)를 먼저 보세요.

> 원칙: **자동 추출은 초안, 최종 판단은 사람.** 추출기는 문서에 실제로 있는 이름만 뽑고, 없으면 "없음"으로
> 둡니다(지어내지 않음). 도장·손글씨·판독난해 서명은 검토 필요 큐로 모아 사람이 확인합니다.

## 문서 지도

| 문서 | 내용 |
|---|---|
| [progress.md](./progress.md) | **진척도** — 2026-05-22 세종 미팅 요구사항 대비 구현 현황 매핑(✅/🟡/📋/⬜) |
| [improvement-plan-ocr.md](./improvement-plan-ocr.md) | 도장·손글씨 **OCR 개선계획**(실신뢰도·abstain·오추출 교차검증, pending approval) |
| [meeting-2026-05-22-sejong.md](./meeting-2026-05-22-sejong.md) | 세종국책연구단지 **미팅 정리**(요구사항 원천) |
| [architecture.md](./architecture.md) | 시스템 개요, 4단 파이프라인, 두 축 분리 원칙, 데이터 흐름, 컴포넌트 맵, 기술스택 근거 |
| [pipeline.md](./pipeline.md) | 4단 파이프라인 단계별 상세(Ingest/Type/Aggregate + 오케스트레이션), 확장 가이드 |
| [extractors.md](./extractors.md) | Stage 3 교체 가능 추출기 — stub 휴리스틱 / 온프레 VLM 클라이언트 / 프롬프트 / 역할 매핑 / Ollama 셋업 |
| [names-and-matching.md](./names-and-matching.md) | 이름 정규화(자간 정규화)·보수적 동일인 매칭 규칙·파일명/폴더 파싱 |
| [data-model.md](./data-model.md) | 7개 테이블 스키마, 관계(ER), 레코드 라이프사이클, 임베디드 DB·마이그레이션 |
| [worker.md](./worker.md) | 백그라운드 워커·작업 큐, 트랜잭션 적재, 검토 플래그 생성 |
| [api.md](./api.md) | API 라우트 레퍼런스(요청/응답/상태코드/curl 예시) |
| [ui.md](./ui.md) | 검토 UI 페이지·컴포넌트, seed-design 토큰, 검토 워크플로 |
| [security.md](./security.md) | 개인정보·보안: 온프레 우선, zip-slip/zip-bomb 방어, 인증 경계, 데이터 저장 |
| [development.md](./development.md) | 개발 환경·스크립트·테스트·확장/마이그레이션 워크플로·코딩 규칙 |
| [deployment.md](./deployment.md) | 프로덕션 배포, 환경변수 전체 레퍼런스, 온프레 VLM/GPU, 백업·이식성 |
| [model-evaluation.md](./model-evaluation.md) | (Phase 1.5) OCR/VLM 모델 선정·평가 방법론, 계층 처리, 교정 플라이휠 |
| [roadmap.md](./roadmap.md) | 현재 구현 상태, 로드맵(Phase 0/1/1.5/2), 범위, 리스크, 선결 의사결정 |

## 빠르게 찾기

- **"어떻게 동작하나?"** → [architecture.md](./architecture.md) → [pipeline.md](./pipeline.md)
- **"왜 이 이름이 합쳐졌나/안 합쳐졌나?"** → [names-and-matching.md](./names-and-matching.md)
- **"실제 모델로 돌리려면?"** → [extractors.md](./extractors.md) §Ollama, [deployment.md](./deployment.md)
- **"테이블/컬럼이 뭐가 있나?"** → [data-model.md](./data-model.md)
- **"공공기관에 배포해도 되나?"** → [security.md](./security.md)
- **"기여/확장하려면?"** → [development.md](./development.md)
