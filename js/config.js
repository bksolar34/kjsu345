/* ============================================================
   부광솔라 홈페이지 설정 파일  v2.0
   GitHub Pages 정적 배포 기준

   ★ API 키는 절대 이 파일에 직접 입력하지 마세요.
     GitHub Secrets 또는 서버사이드 프록시를 사용하세요.
     개발 환경에서만 .env 파일로 관리하세요.
   ============================================================ */
window.BK_CONFIG = {

  /* ── LLM 라우팅 ──────────────────────────────────────────
     유럽연합(EU) 방문자  → Google Gemini (EU 데이터센터 지원)
     아시아·미국·기타    → Llama 3.x (Meta, Groq Cloud)
     API 키는 GitHub Secrets → GitHub Actions → 빌드 시 주입
  ────────────────────────────────────────────────────────── */
  LLM: {
    /* Groq Cloud (Llama 3.x, 무료 티어 사용 가능)
       https://console.groq.com  에서 발급 */
    GROQ_API_KEY: '',          // Llama 3.x 담당 (아시아·미국·기타)

    /* Google Gemini API
       https://aistudio.google.com/app/apikey 에서 발급 */
    GEMINI_API_KEY: '',        // Gemini 담당 (EU 방문자)

    /* EU 국가 코드 목록 (ISO 3166-1 alpha-2) */
    EU_COUNTRIES: new Set([
      'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI',
      'FR','GR','HR','HU','IE','IT','LT','LU','LV','MT',
      'NL','PL','PT','RO','SE','SI','SK'
    ]),

    /* 모델명 */
    LLAMA_MODEL:   'llama-3.3-70b-versatile',   // Groq 제공
    GEMINI_MODEL:  'gemini-1.5-flash',            // Google Gemini
  },

  /* ── Vector DB (Chroma / localStorage 폴백) ──────────── */
  VECTOR_DB: {
    CHROMA_URL:    '',
    COLLECTION:    'bksolar_policy',
    MAX_RESULTS:   5,
    TTL_DAYS:      15,
  },

  /* ── 블로그 / 회사 정보 ─────────────────────────────── */
  BLOG_CACHE_PATH: './data/blog_cache/latest.json',
  BLOG_RSS:        'https://rss.blog.naver.com/bk_solar.xml',
  PHONE:           '042-584-5017',
  EMAIL:           'bk_solar@naver.com',
  BLOG:            'https://blog.naver.com/bk_solar',
};
