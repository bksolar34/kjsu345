/* ============================================================
   부광솔라 LLM 엔진  v1.1
   ─ 국가별 라우팅: EU → Google Gemini  /  기타 → Llama 3.x (Groq)
   ─ 5단계 폴백: RSS → 국가포털 → 전세계포털 → VectorDB → 내장KB
   ─ Vector DB: 국가별 태양광 정책 저장 (localStorage 폴백)
   ─ 자동번역: 답변 언어를 방문자 언어로 자동 설정
   ============================================================ */
'use strict';

window.BKLLMEngine = (() => {

  /* ══════════════════════════════
     ① 회사 지식베이스 KB
  ══════════════════════════════ */
  const KB = `
# 부광솔라 (Bukwang Solar) 지식베이스
## 회사 정보
- 주소: 대전광역시 서구 복수중로30
- 전화: 042-584-5017 | 이메일: bk_solar@naver.com
- 블로그: https://blog.naver.com/bk_solar
## 핵심 사업
- 스마트팜 영농형 태양광: 패널 3~4m 높이, 농업+발전 동시, 수확량 80% 이상
- BESS: 충전효율 98%, PCS 97%, 방전심도 80%, 저감률 1.95%/년
- 정부 보조금: BESS 설치비 30~50% (에너지공단 보급사업)
- 특허: 영농형 구조물, 스마트팜 온실, BIPV, RTU 원격감시
## 수익 지표
- PV: 100만원/kW | SMP: 185원/kWh | REC: 75,000원/MEC
- 손익분기: 7~10년차 | 사업기간: 23년
## FAQ
- 영농 가능? → 수확량 80% 이상 유지, 반음지 작물 유리
- 보조금? → BESS 비용 30~50%, 에너지공단 공모
- ESS 배수? → 저장용량÷태양광용량 (예: 100kW×2=200kWh)
- PCS 효율? → 97% 적용
- 손익분기? → 7~10년차 (지역·보조금 따라 상이)`;

  /* ══════════════════════════════
     ② 국가 감지 (i18n.js 연동)
  ══════════════════════════════ */
  let _cachedCountry = null;
  let _cachedLang    = null;

  async function getCountryAndLang() {
    if (_cachedCountry) return { country: _cachedCountry, lang: _cachedLang };
    try {
      // i18n.js의 SolarI18n 활용
      if (window.SolarI18n) {
        const result = await SolarI18n.detectCountry();
        _cachedCountry = result?.country || 'KR';
        _cachedLang    = SolarI18n.getCurrentLang() || 'ko';
        return { country: _cachedCountry, lang: _cachedLang };
      }
      // 직접 감지
      const r = await fetch('https://ipapi.co/json/', {
        signal: AbortSignal.timeout(4000), cache: 'no-store'
      });
      const d = await r.json();
      _cachedCountry = d.country_code || 'KR';
      _cachedLang    = (navigator.language || 'ko').slice(0, 2);
      return { country: _cachedCountry, lang: _cachedLang };
    } catch (_) {
      _cachedCountry = 'KR';
      _cachedLang    = 'ko';
      return { country: 'KR', lang: 'ko' };
    }
  }

  function isEU(country) {
    return window.BK_CONFIG?.LLM?.EU_COUNTRIES?.has(country) || false;
  }

  function getLangInstruction(lang) {
    if (!lang || lang === 'ko') return '';
    const names = {
      en:'English', ja:'日本語', 'zh-CN':'中文(简体)', 'zh-TW':'中文(繁體)',
      de:'Deutsch', fr:'Français', es:'Español', pt:'Português',
      ru:'Русский', ar:'العربية', vi:'Tiếng Việt', id:'Bahasa Indonesia',
      th:'ภาษาไทย', it:'Italiano', nl:'Nederlands', pl:'Polski'
    };
    const name = names[lang] || lang;
    return `\n\n[LANGUAGE] Respond in ${name} (${lang}).`;
  }

  /* ══════════════════════════════
     ③ LLM API 호출 (Gemini / Llama)
  ══════════════════════════════ */
  async function callGemini(messages, system) {
    const key = window.BK_CONFIG?.LLM?.GEMINI_API_KEY || '';
    if (!key) throw new Error('NO_GEMINI_KEY');
    const model = window.BK_CONFIG?.LLM?.GEMINI_MODEL || 'gemini-1.5-flash';

    // Gemini API: system instruction + contents 형식
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { maxOutputTokens: 1500, temperature: 0.3 }
        }),
        signal: AbortSignal.timeout(25000)
      }
    );
    if (!resp.ok) throw new Error(`GEMINI_${resp.status}`);
    const d = await resp.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }

  async function callLlama(messages, system) {
    const key = window.BK_CONFIG?.LLM?.GROQ_API_KEY || '';
    if (!key) throw new Error('NO_GROQ_KEY');
    const model = window.BK_CONFIG?.LLM?.LLAMA_MODEL || 'llama-3.3-70b-versatile';

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          ...messages
        ],
        max_tokens: 1500,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!resp.ok) throw new Error(`GROQ_${resp.status}`);
    const d = await resp.json();
    return d.choices?.[0]?.message?.content?.trim() || '';
  }

  async function callLLM(messages, system, country) {
    if (isEU(country)) {
      try { return await callGemini(messages, system); }
      catch (e) {
        console.warn('[LLM] Gemini 실패, Llama로 폴백:', e.message);
        return await callLlama(messages, system);
      }
    } else {
      try { return await callLlama(messages, system); }
      catch (e) {
        console.warn('[LLM] Llama 실패, Gemini로 폴백:', e.message);
        return await callGemini(messages, system);
      }
    }
  }

  /* ══════════════════════════════
     ④ Vector DB (태양광 정책 저장)
  ══════════════════════════════ */
  const VDB = (() => {
    const PREFIX  = 'bksolar_vdb_';
    const TTL_MS  = (window.BK_CONFIG?.VECTOR_DB?.TTL_DAYS || 15) * 86400000;

    function _key(country, topic) {
      return `${PREFIX}${country}_${topic.slice(0, 30).replace(/\s+/g, '_')}`;
    }

    function save(country, topic, content, source) {
      try {
        localStorage.setItem(_key(country, topic), JSON.stringify({
          content, source, country, topic,
          saved_at: Date.now()
        }));
      } catch (_) {}
    }

    function get(country, topic) {
      try {
        const raw = localStorage.getItem(_key(country, topic));
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (Date.now() - d.saved_at > TTL_MS) {
          localStorage.removeItem(_key(country, topic));
          return null;
        }
        return d;
      } catch (_) { return null; }
    }

    function search(country, query) {
      const results = [];
      const q = query.toLowerCase();
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k.startsWith(PREFIX + country)) continue;
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const d = JSON.parse(raw);
          if (Date.now() - d.saved_at > TTL_MS) continue;
          if ((d.content + d.topic).toLowerCase().includes(q)) {
            results.push(d);
          }
        }
      } catch (_) {}
      return results.slice(0, 3);
    }

    function listAll() {
      const results = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k.startsWith(PREFIX)) continue;
          const d = JSON.parse(localStorage.getItem(k) || '{}');
          results.push({ country: d.country, topic: d.topic, source: d.source });
        }
      } catch (_) {}
      return results;
    }

    return { save, get, search, listAll };
  })();

  /* ══════════════════════════════
     ⑤ RSS 파싱 (단계 1)
  ══════════════════════════════ */
  let _rssCache = null;
  let _rssTs    = 0;
  const RSS_TTL = 20 * 60 * 1000;

  async function fetchRSS(query) {
    if (_rssCache && Date.now() - _rssTs < RSS_TTL) return _filterRSS(_rssCache, query);

    // 서버 캐시 우선
    try {
      const r = await fetch(
        window.BK_CONFIG?.BLOG_CACHE_PATH || './data/blog_cache/latest.json',
        { cache: 'no-cache', signal: AbortSignal.timeout(3000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.posts?.length > 0) {
          _rssCache = d.posts; _rssTs = Date.now();
          return _filterRSS(_rssCache, query);
        }
      }
    } catch (_) {}

    // CORS 프록시로 실시간 RSS
    const rssUrl = window.BK_CONFIG?.BLOG_RSS || 'https://rss.blog.naver.com/bk_solar.xml';
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(rssUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`,
      `https://rss2json.com/api.json?rss_url=${encodeURIComponent(rssUrl)}`
    ];

    for (const px of proxies) {
      try {
        const r = await fetch(px, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const text = await r.text();

        // rss2json 형식
        if (px.includes('rss2json')) {
          try {
            const j = JSON.parse(text);
            if (j.status === 'ok' && j.items?.length) {
              const posts = j.items.map(it => ({
                title: it.title || '',
                link:  it.link || '',
                description: (it.description || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 500),
                pubDate: it.pubDate || '',
                source: 'rss2json'
              }));
              _rssCache = posts; _rssTs = Date.now();
              return _filterRSS(posts, query);
            }
          } catch (_) {}
          continue;
        }

        // XML RSS 형식
        if (!text.includes('<item>')) continue;
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        const posts = [...doc.querySelectorAll('item')].slice(0, 20).map(it => ({
          title: it.querySelector('title')?.textContent?.trim() || '',
          link:  it.querySelector('link')?.textContent?.trim() || '',
          description: (it.querySelector('description')?.textContent || '')
            .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 500),
          pubDate: it.querySelector('pubDate')?.textContent?.trim() || '',
          source: 'rss_proxy'
        })).filter(p => p.title);

        if (posts.length) {
          _rssCache = posts; _rssTs = Date.now();
          return _filterRSS(posts, query);
        }
      } catch (_) { continue; }
    }
    return [];
  }

  function _filterRSS(posts, query) {
    if (!query) return posts.slice(0, 6);
    const q = query.toLowerCase();
    const r = posts.filter(p =>
      (p.title + ' ' + p.description + ' ' + (p.content || '')).toLowerCase().includes(q)
    );
    return r.length ? r.slice(0, 4) : posts.slice(0, 4);
  }

  /* ══════════════════════════════
     ⑥ 5단계 폴백 답변 엔진
  ══════════════════════════════ */
  async function getAnswer(userMsg, chatHistory) {
    const { country, lang } = await getCountryAndLang();
    const langInst = getLangInstruction(lang);
    const msgs = [...(chatHistory || []).slice(-8), { role: 'user', content: userMsg }];

    // Vector DB 관련 컨텍스트 검색
    const vdbResults = VDB.search(country, userMsg);
    let vdbCtx = '';
    if (vdbResults.length > 0) {
      vdbCtx = '\n\n## 국가별 태양광 정책 DB\n' +
        vdbResults.map(d => `[${d.country}] ${d.topic}: ${d.content.slice(0, 300)}`).join('\n');
    }

    /* ── 단계 1: RSS 블로그 캐시 ── */
    const rssPosts = await fetchRSS(userMsg);
    let rssCtx = '';
    if (rssPosts.length > 0) {
      rssCtx = '\n\n## 부광솔라 블로그 (blog.naver.com/bk_solar)\n' +
        rssPosts.slice(0, 4).map((p, i) =>
          `[${i+1}] ${p.title} (${p.pubDate})\n${p.description.slice(0, 400)}\n${p.link}`
        ).join('\n\n');
    }

    const baseSystem = `당신은 부광솔라(Bukwang Solar) AI 안내 도우미입니다.
${KB}${rssCtx}${vdbCtx}${langInst}

답변 규칙:
- 2~4문장, 구체적 수치 포함
- 블로그/DB 데이터 있으면 출처 명시
- 화면 이동: [→ESS] [→수익분석] [→입지분석] [→문의] 중 하나 추가
- 태양광 정책 정보 수집 시 VDB에 저장 (국가별)`;

    if (rssPosts.length > 0) {
      try {
        const ans = await callLLM(msgs, baseSystem, country);
        if (ans) {
          // 태양광 정책 정보 VDB 저장
          if (/(정책|보조금|규정|법률|policy|subsidy|regulation)/.test(userMsg)) {
            VDB.save(country, userMsg.slice(0, 50), ans, 'llm_generated');
          }
          return { text: ans, source: 'rss+llm', country, lang };
        }
      } catch (e) { console.warn('[LLM] 단계1 실패:', e.message); }
    }

    /* ── 단계 2: 국가 포털 검색 요청 ── */
    try {
      const countrySearch = `국가 ${country}의 태양광 관련 정보와 blog.naver.com/bk_solar 내용을 참고하여 다음 질문에 답변하세요: ${userMsg}`;
      const sys2 = baseSystem + `\n\n[검색 지시] 방문자 국가: ${country}. 해당 국가의 태양광 포털 및 정책을 우선 참고하세요.`;
      const msgs2 = [{ role: 'user', content: countrySearch }];
      const ans = await callLLM(msgs2, sys2, country);
      if (ans) {
        if (/(정책|보조금|규정|policy|subsidy)/.test(userMsg)) {
          VDB.save(country, userMsg.slice(0, 50), ans, 'country_portal');
        }
        return { text: ans, source: 'country_portal', country, lang };
      }
    } catch (e) { console.warn('[LLM] 단계2 실패:', e.message); }

    /* ── 단계 3: 전세계 포털 검색 ── */
    try {
      const sys3 = baseSystem + '\n\n[검색 지시] 전세계 태양광 관련 정보와 부광솔라 블로그를 참고하여 답변하세요.';
      const ans = await callLLM(msgs, sys3, country);
      if (ans) return { text: ans, source: 'global_search', country, lang };
    } catch (e) { console.warn('[LLM] 단계3 실패:', e.message); }

    /* ── 단계 4: KB 로컬 폴백 ── */
    return { text: localFallback(userMsg, rssPosts, lang), source: 'local_kb', country, lang };
  }

  /* ══════════════════════════════
     ⑦ 로컬 KB 폴백 (단계 4)
  ══════════════════════════════ */
  function localFallback(msg, blogPosts, lang) {
    // 블로그 캐시에서 관련 내용 우선
    if (blogPosts?.length) {
      const rel = blogPosts.find(p =>
        (p.title + p.description).toLowerCase().includes(msg.toLowerCase().slice(0, 15))
      );
      if (rel?.description?.length > 50) {
        return `블로그 포스트 "${rel.title}":\n${rel.description.slice(0, 200)}\n▶ ${rel.link || 'blog.naver.com/bk_solar'}`;
      }
    }

    const m = msg.toLowerCase();
    const answers = {
      ess:     'ESS는 태양광 전력을 저장해 필요할 때 사용하는 장치입니다.\n충전효율 98%, PCS 효율 97%, 연간 저감률 1.95%를 적용합니다. [→ESS]',
      pcs:     'PCS(전력변환장치)는 배터리↔계통 전환 장치로 부광솔라는 97% 효율을 적용합니다.',
      수익:    'NASA 실측 일사량 기반 23년 현금흐름 시뮬레이션을 제공합니다.\nSMP 185원/kWh, REC 75,000원/MEC 기준, 손익분기 7~10년차. [→수익분석]',
      보조금:  'BESS 설치비의 30~50%를 정부 보조금으로 지원받을 수 있습니다.\n한국에너지공단 신재생에너지 보급사업을 통해 신청하세요. [→문의]',
      영농:    '영농형 태양광은 3~4m 높이 패널로 농업+발전을 동시에 실현합니다.\n수확량 80% 이상 유지, REC 가중치 최대 2.0 적용. [→수익분석]',
      입지:    '3D 입지분석으로 지형·건물·일사량을 종합 분석합니다.\n분석범위, 평균일사량, 고도차, 그림자, 실효발전효율을 확인하세요. [→입지분석]',
      배수:    'ESS 배수 = 저장용량÷태양광용량입니다.\n예) 100kW × 2배수 = 200kWh 저장.',
      저감:    '배터리는 연간 1.95%씩 용량이 감소합니다. 수익분석에 자동 반영됩니다.',
      상담:    '042-584-5017 또는 bk_solar@naver.com으로 문의해주세요. [→문의]',
    };

    for (const [key, ans] of Object.entries(answers)) {
      if (m.includes(key) || m.includes(key.replace(/[가-힣]/g, ''))) return ans;
    }
    if (/(ess|battery|bess|배터리|저장)/.test(m)) return answers['ess'];
    if (/(revenue|profit|수익|투자|roi|손익)/.test(m)) return answers['수익'];
    if (/(site|입지|부지|지형|3d)/.test(m)) return answers['입지'];
    if (/(subsidy|보조금|정부|지원)/.test(m)) return answers['보조금'];
    if (/(farm|영농|농지|작물)/.test(m)) return answers['영농'];

    return '부광솔라 AI 도우미입니다.\n042-584-5017 또는 bk_solar@naver.com으로 문의하시거나 아래 메뉴를 이용해주세요.';
  }

  /* ══════════════════════════════
     공개 API
  ══════════════════════════════ */
  return {
    getAnswer,          // 5단계 폴백 답변
    getCountryAndLang,  // 국가/언어 감지
    isEU,               // EU 여부
    VDB,                // Vector DB 접근
    fetchRSS,           // RSS 직접 접근
    localFallback,      // KB 직접 호출
  };
})();
