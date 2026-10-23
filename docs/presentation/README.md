# 말줍 프로젝트 기획·제작 보고서

- [PDF 열기](maljup-project.pdf)
- [수정 가능한 PPTX 다운로드](maljup-project.pptx)
- 기준: 2026-10-23, 코드 `b65688c`, 총 32장, 16:9
- 도형·표·본문·코드는 편집 가능하며 화면 캡처는 이미지입니다. 슬라이드 발표자 노트에 출처·설명·검증 범위를 덧붙였습니다.

## 목차

| 페이지 | 내용 |
| --- | --- |
| 1–5 | 표지, 서비스 개요, 기획 의도, 사용자, 구현 범위 |
| 6–7 | 사용자 여정과 전체 사이트맵 |
| 8–14 | PC·모바일 화면, 스크립트, 형광펜, 카드·메모, 복습, 녹음 |
| 15–17 | Google Sheets, 웹 푸시 예약, 아이폰 11 설치 방법 |
| 18–21 | 컬러·디자인, 시스템 아키텍처, 데이터 구조, 제작 방법 |
| 22–26 | 핵심 코드 5개 영역과 구현 설명 |
| 27–30 | Render 배포, 보안·권한, 테스트, 운영 한계·개선 방향 |
| 31–32 | 소스 파일 안내와 발표·시연 순서 |

## 문서 재생성

문서 제작 전용 Python 패키지 `python-pptx`와 `Pillow`가 필요합니다. 앱 실행에는 추가로 설치할 필요가 없습니다.

```sh
python -m pip install python-pptx Pillow
python scripts/build-project-presentation.py
soffice --headless --convert-to pdf --outdir docs/presentation docs/presentation/maljup-project.pptx
```

PDF 변환에는 LibreOffice와 한국어 글꼴(Noto Sans CJK KR 권장)이 필요합니다. 코드·기능이 바뀌면 생성 스크립트의 설명·기준 커밋과 스크린샷도 함께 갱신하세요. PDF는 PPTX와 페이지 수·본문 텍스트 일치를 검사했습니다.

`screenshots/`에는 로컬 앱에 데모 자료를 넣어 촬영한 화면만 포함합니다. 녹음 화면의 데모 파일은 무음 WAV이며 실제 사용자 녹음·마이크 검증 자료가 아닙니다. API 키, OAuth 토큰, 푸시 연결 키는 수록하지 않았습니다.
