KCCS Report API - 1단계 배포본
================================

목적
----
Supabase의 public.kccs_daily_reports 테이블을 읽어
Framer KCCS 시뮬레이터가 사용할 JSON API를 제공합니다.

이번 단계에서 만드는 주소
------------------------
/api/health
/api/kccs/latest

필요한 Vercel 환경변수
---------------------
SUPABASE_URL
SUPABASE_SECRET_KEY

주의
----
SUPABASE_SECRET_KEY는 절대 코드 파일이나 Framer에 넣지 마세요.
Vercel Project > Settings > Environment Variables에만 입력하세요.

배포 후 테스트
-------------
1) https://본인프로젝트.vercel.app/api/health
   -> ok: true 가 나오면 환경변수 연결 정상

2) https://본인프로젝트.vercel.app/api/kccs/latest
   -> latest가 2026-08-07이고 history에 8/7~8/3 데이터가 나오면 정상

다음 단계
---------
한국 주식 시세 API 연동 + 한국시간 17:00 자동 확정 Cron을 추가합니다.
현재 이 배포본은 DB를 읽기만 하므로 기존 8/3~8/7 원장을 변경하지 않습니다.
