# 부광솔라 홈페이지 — GitHub Pages 배포 가이드

## 빠른 시작

```bash
git init
git add .
git commit -m "초기 커밋"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bksolar.git
git push -u origin main
```

GitHub → Settings → Pages → Source: Deploy from branch → main → / (root)

## API 키 설정 (GitHub Secrets)

Settings → Secrets and variables → Actions → New repository secret

| Secret 이름 | 값 | 용도 |
|---|---|---|
| `GROQ_API_KEY` | Groq 콘솔에서 발급 | Llama 3.x (아시아·미국·기타) |
| `GEMINI_API_KEY` | Mistral 콘솔에서 발급 | Gemini (EU 방문자) |

### 키 발급 URL
- **Groq (Llama 3.x 무료)**: https://console.groq.com
- **Google Gemini**: https://aistudio.google.com/app/apikey

## 로컬 개발 시 API 키 설정

`js/config.local.js` 파일 생성 후 키 입력 (.gitignore에 포함됨):

```js
// js/config.local.js  ← 절대 git에 올리지 마세요
window.BK_CONFIG.LLM.GROQ_API_KEY    = 'gsk_xxxx...';
window.BK_CONFIG.LLM.GEMINI_API_KEY = 'xxxxx...';
```

index.html에 로컬 설정 로드 추가:
```html
<!-- 개발 환경에서만 사용 -->
<script src="./js/config.local.js"></script>
```

## LLM 라우팅 구조

```
방문자 접속
    │
    ├─ EU 국가 (27개국) ──→ Google Gemini (GDPR 준수)
    │                        모델: gemini-1.5-flash
    │
    └─ 아시아·미국·기타 ──→ Llama 3.x (Meta, Groq)
                             모델: llama-3.3-70b-versatile

5단계 폴백:
  1) blog.naver.com/bk_solar RSS
  2) 접속 국가 포털 검색
  3) 전세계 포털 검색
  4) Vector DB (localStorage)
  5) 내장 KB (오프라인)
```

## Vector DB

- 국가별 태양광 정책 정보를 `localStorage`에 자동 저장
- TTL: 15일 (만료 시 자동 재수집)
- 확인: 브라우저 콘솔 → `BKLLMEngine.VDB.listAll()`

## 블로그 크롤러 (15일 주기)

```bash
# API 키와 함께 실행
ANTHROPIC_API_KEY=sk-ant-... python3 backend/blog_crawler.py --force
```

## 파일 구조

```
website/
├── index.html              ← 메인 페이지
├── .nojekyll               ← Jekyll 비활성화 (필수)
├── .gitignore              ← API 키 등 업로드 방지
├── DEPLOYMENT.md           ← 이 파일
├── js/
│   ├── config.js           ← 설정 (API 키 빈 값)
│   ├── llm-engine.js       ← LLM 라우팅 + VectorDB + RSS
│   ├── ai-chat.js          ← 챗봇 UI + 대화 흐름
│   ├── i18n.js             ← 다국어 + IP 기반 국가 감지
│   └── ...
├── data/blog_cache/
│   └── latest.json         ← 블로그 캐시 (크롤러 생성)
└── backend/
    └── blog_crawler.py     ← 15일 주기 블로그 크롤러
```
