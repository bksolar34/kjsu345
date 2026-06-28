# 부광솔라 블로그 크롤러 & AI 안내 시스템

## 구조

```
website/
├── backend/
│   ├── blog_crawler.py     ← 메인 크롤러 (RSS + Claude API + BeautifulSoup)
│   ├── blog_server.py      ← Flask API 서버 (크롤링 데이터 제공)
│   └── run_crawler.sh      ← 실행 스크립트
├── data/
│   └── blog_cache/
│       ├── latest.json     ← 최신 블로그 데이터 (프론트에서 직접 로드)
│       ├── latest.txt      ← 텍스트 버전 (사람이 읽기 쉬운)
│       ├── update_meta.json← 업데이트 메타데이터
│       └── blog_posts_*.json/csv/txt  ← 날짜별 보관본
└── js/
    └── ai-chat.js          ← 프론트엔드 챗봇 (BlogCache 클래스 포함)
```

## 크롤링 전략 (3단계)

| 단계 | 방법 | 성공 조건 |
|------|------|----------|
| 1단계 | RSS 직접 + CORS 프록시 | naver RSS 서버 응답 200 |
| 2단계 | Claude API web_search | API 키 필요 |
| 3단계 | 개별 포스트 상세 크롤링 | BeautifulSoup |

> 네이버 블로그는 서버 사이드 봇을 전면 차단(403)하므로
> Claude API의 web_search 도구가 가장 안정적인 수집 방법입니다.

## 빠른 시작

```bash
# 1. 의존성 설치
pip install requests beautifulsoup4 lxml flask flask-cors

# 2. 1회 크롤링 (API 키 없이)
python3 backend/blog_crawler.py

# 3. API 키 포함 크롤링 (권장 - 가장 많은 내용 수집)
ANTHROPIC_API_KEY=sk-ant-... python3 backend/blog_crawler.py

# 4. 15일 주기 자동 실행
python3 backend/blog_crawler.py --schedule

# 5. API 서버 실행 (선택)
python3 backend/blog_server.py --port 5001
```

## crontab 설정 (자동화)

```bash
# crontab -e 로 편집
# 매월 1일, 15일 오전 9시 자동 실행
0 9 1,15 * * cd /path/to/website && ANTHROPIC_API_KEY=sk-ant-... python3 backend/blog_crawler.py >> data/crawler_cron.log 2>&1
```

## 프론트엔드 연동

`js/ai-chat.js`의 `BlogCache` 클래스가 자동으로:
1. `data/blog_cache/latest.json` 로드 시도
2. 실패 시 RSS CORS 프록시 직접 파싱
3. 실패 시 Claude API web_search 직접 실행

→ 어떤 경우에도 폴백(회피) 없이 실제 데이터로 답변합니다.
