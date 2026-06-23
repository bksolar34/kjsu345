/**
 * ============================================================
 *  부광솔라 접속 국가 기반 자동 언어 전환 시스템 v4.0
 * ============================================================
 *  [번역 방식 변경: Google Translate 위젯 → translate.google.com 직접 방식]
 *
 *  ■ 이전 방식 (v3.x) 문제점:
 *    - translate.google.com/translate_a/element.js 위젯 스크립트 사용
 *    - body { top: 0 !important } CSS 와 충돌하여 번역 미작동
 *    - select.goog-te-combo 탐색 타이밍 경쟁 조건으로 간헐적 실패
 *    - Google이 위젯 방식을 점진적으로 비권장(Deprecation) 중
 *
 *  ■ 새 방식 (v4.0): translate.google.com 웹사이트 번역 직접 방식
 *    - translate.google.com/translate?sl=ko&tl=XX&u=현재URL 형태로
 *      Google 번역 서버가 페이지 전체를 프록시 번역하는 공식 웹서비스
 *    - 회수 제한 없음 (Google 번역 웹사이트와 동일한 인프라)
 *    - 위젯 스크립트·CSS 충돌·타이밍 문제 전부 해소
 *    - 번역된 URL로 location.replace() — 사용자에게는 즉시 번역된 페이지가 보임
 *    - 한국 접속 시: 현재 URL 유지 (번역 불필요)
 *    - 이미 translate.google.com 프록시를 통해 접속 중이면 중복 리다이렉트 방지
 *
 *  ■ IP 국가 감지 (다중 폴백 유지):
 *    1차 ipapi.co → 2차 ip-api.com → 3차 브라우저 언어 추정
 * ============================================================
 */

(function () {
    'use strict';

    /* ─── 국가코드 → Google 번역 언어코드 매핑 ─────────────── */
    const COUNTRY_LANG_MAP = {
        KR: null,   // 한국 — 원문 유지 (번역 안 함)

        // 영어권
        US: 'en', GB: 'en', AU: 'en', CA: 'en', NZ: 'en',
        IE: 'en', SG: 'en', ZA: 'en', IN: 'en', PH: 'en',

        // 중앙아시아
        UZ: 'uz', KZ: 'kk', KG: 'ky', TJ: 'tg', TM: 'tk',

        // 동아시아
        JP: 'ja', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-TW', MO: 'zh-TW',

        // 동남아시아
        VN: 'vi', TH: 'th', MY: 'ms', ID: 'id', MM: 'my', KH: 'km', LA: 'lo',

        // 남아시아
        BD: 'bn', PK: 'ur', LK: 'si', NP: 'ne',

        // 중동·아랍
        SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar',
        JO: 'ar', IQ: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', LY: 'ar',
        LB: 'ar', YE: 'ar', SY: 'ar',
        IL: 'iw', TR: 'tr', IR: 'fa', AF: 'ps',

        // 서유럽
        DE: 'de', AT: 'de', CH: 'de',
        FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
        ES: 'es', IT: 'it', SM: 'it', VA: 'it',
        PT: 'pt', NL: 'nl',

        // 중남미
        MX: 'es', AR: 'es', CO: 'es', PE: 'es', CL: 'es', VE: 'es',
        EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es',
        PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es',
        BR: 'pt', AO: 'pt', MZ: 'pt',

        // 동유럽·북유럽
        RU: 'ru', BY: 'ru', UA: 'uk',
        SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', IS: 'is',
        PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', GR: 'el',
        HR: 'hr', RS: 'sr', SI: 'sl', LT: 'lt', LV: 'lv', EE: 'et',
        AL: 'sq', MK: 'mk', BA: 'bs',

        // 아프리카
        KE: 'sw', TZ: 'sw', ET: 'am', NG: 'en', GH: 'en',

        // 기타
        MN: 'mn', GE: 'ka', AM: 'hy', AZ: 'az'
    };

    const STORAGE_KEY  = '_bk_geo_lang_v4';
    const REDIRECT_KEY = '_bk_translated_v4'; // 리다이렉트 중복 방지

    /* ─── 핵심 UI 즉시 번역 사전 (리다이렉트 전 헤더 등 즉각 반응) ── */
    const CORE_UI = {
        en: {
            'nav.home': 'Home', 'nav.about': 'About',
            'nav.revenue': 'Revenue Analysis', 'nav.site3d': 'Site Analysis',
            'nav.tech': 'Technology', 'nav.contact': 'Contact'
        },
        ja: {
            'nav.home': 'ホーム', 'nav.about': '会社案内',
            'nav.revenue': '収益分析', 'nav.site3d': '立地分析',
            'nav.tech': '技術·特許', 'nav.contact': 'お問い合わせ'
        },
        'zh-CN': {
            'nav.home': '首页', 'nav.about': '公司介绍',
            'nav.revenue': '収益分析', 'nav.site3d': '选址分析',
            'nav.tech': '技术专利', 'nav.contact': '咨询'
        },
        'zh-TW': {
            'nav.home': '首頁', 'nav.about': '公司介紹',
            'nav.revenue': '收益分析', 'nav.site3d': '選址分析',
            'nav.tech': '技術專利', 'nav.contact': '諮詢'
        }
    };

    /* ─── translate.google.com 프록시 접속 여부 판별 ──────────
       Google 번역 프록시를 통해 접속하면 호스트가 변경됨
       예: https://부광솔라-com.translate.goog/...?_x_tr_sl=ko&_x_tr_tl=en
    ──────────────────────────────────────────────────────────── */
    function isAlreadyTranslated() {
        return location.hostname.endsWith('.translate.goog') ||
               location.search.includes('_x_tr_tl=');
    }

    /* ─── translate.google.com 번역 URL 생성 ────────────────
       방식: https://translate.google.com/translate
               ?sl=ko          (원본 언어: 한국어)
               &tl=en          (목표 언어)
               &hl=en          (UI 언어 — Google 번역 툴바 표시 언어)
               &u=원본URL      (번역할 페이지 URL)
    ──────────────────────────────────────────────────────────── */
    function buildTranslateURL(targetLang) {
        const pageURL = encodeURIComponent(location.href);
        return `https://translate.google.com/translate?sl=ko&tl=${targetLang}&hl=${targetLang}&u=${pageURL}`;
    }

    /* ─── IP 위치 조회 (다중 API 폴백) ─────────────────────
       1차: ipapi.co   — 무료, 회수 제한 있음(월 30,000회)
       2차: ip-api.com — 무료, 분당 45회 (HTTPS 지원)
       3차: 브라우저 navigator.language 기반 추정
    ──────────────────────────────────────────────────────────── */
    async function detectCountry() {
        // 세션 캐시 (같은 탭 내 중복 조회 방지)
        try {
            const cached = sessionStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.country) return parsed;
            }
        } catch (_) {}

        // 1차: ipapi.co
        try {
            const res = await fetch('https://ipapi.co/json/', {
                cache: 'no-store',
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.country_code && !data.error) {
                    const result = { country: data.country_code, source: 'ipapi.co' };
                    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch(_) {}
                    return result;
                }
            }
        } catch (e) {
            console.warn('[I18n] ipapi.co 실패:', e.message);
        }

        // 2차: ip-api.com
        try {
            const res = await fetch('https://ip-api.com/json/?fields=status,countryCode', {
                cache: 'no-store',
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'success' && data.countryCode) {
                    const result = { country: data.countryCode, source: 'ip-api.com' };
                    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch(_) {}
                    return result;
                }
            }
        } catch (e) {
            console.warn('[I18n] ip-api.com 실패:', e.message);
        }

        // 3차: 브라우저 언어에서 국가 추정
        const navLang = (navigator.language || navigator.userLanguage || 'ko-KR');
        const parts   = navLang.split('-');
        let country;
        if (parts.length >= 2) {
            country = parts[1].toUpperCase();
        } else {
            // 단일 언어 코드 → 국가 역추정 ('ja' → 'JP' 등)
            const langToCountry = {
                ja:'JP', zh:'CN', en:'US', de:'DE', fr:'FR', es:'ES',
                it:'IT', pt:'BR', ru:'RU', ar:'SA', tr:'TR', vi:'VN',
                th:'TH', id:'ID', ms:'MY', ko:'KR', nl:'NL', sv:'SE',
                pl:'PL', uk:'UA', uz:'UZ', mn:'MN', fi:'FI', da:'DK',
                no:'NO', cs:'CZ', sk:'SK', hu:'HU', ro:'RO', bg:'BG',
                el:'GR', hr:'HR', sr:'RS', sl:'SI', lt:'LT', lv:'LV',
                et:'EE', ka:'GE', hy:'AM', az:'AZ', sw:'KE', am:'ET'
            };
            country = langToCountry[parts[0].toLowerCase()] || 'KR';
        }

        console.warn('[I18n] IP 조회 모두 실패, 브라우저 언어 기반 추정:', country);
        return { country, source: 'browser-fallback' };
    }

    /* ─── 헤더/네비 핵심 텍스트 즉시 반영 ───────────────── */
    function applyCoreUI(lang) {
        const dict = CORE_UI[lang];
        if (!dict) return;
        Object.entries(dict).forEach(([key, text]) => {
            document.querySelectorAll(`[data-i18n="${key}"]`).forEach(el => {
                el.textContent = text;
            });
        });
    }

    function updateLangLabel(text) {
        const el = document.getElementById('langLabel');
        if (el) el.textContent = text;
    }

    /* ─── 메인 초기화 ───────────────────────────────────── */
    async function init() {
        // 이미 Google 번역 프록시를 통해 접속 중이면 아무것도 하지 않음
        if (isAlreadyTranslated()) {
            console.info('[I18n] 이미 translate.google.com 프록시 경유 중 — 리다이렉트 스킵');
            return;
        }

        // 이번 세션에서 이미 리다이렉트를 시도했으면 재시도하지 않음
        // (번역 페이지에서 다시 원본으로 돌아온 경우 무한 루프 방지)
        try {
            if (sessionStorage.getItem(REDIRECT_KEY) === '1') return;
        } catch(_) {}

        const { country, source } = await detectCountry();
        console.info(`[I18n] 접속 국가: ${country} (${source})`);

        // COUNTRY_LANG_MAP에 없는 국가 → 영어 폴백
        const targetLang = Object.prototype.hasOwnProperty.call(COUNTRY_LANG_MAP, country)
            ? COUNTRY_LANG_MAP[country]
            : 'en';

        // 한국 접속이거나 원문 유지 국가 → 번역 불필요
        if (!targetLang) {
            updateLangLabel('KO');
            console.info('[I18n] 한국 접속 — 원문 유지');
            return;
        }

        updateLangLabel(country);
        applyCoreUI(targetLang);

        // translate.google.com 리다이렉트
        try { sessionStorage.setItem(REDIRECT_KEY, '1'); } catch(_) {}

        const translateURL = buildTranslateURL(targetLang);
        console.info(`[I18n] translate.google.com 리다이렉트: ${targetLang} → ${translateURL}`);

        // replace() 사용 — 뒤로가기 시 무한 루프 방지
        location.replace(translateURL);
    }

    // DOM 준비 후 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init().catch(e => console.warn('[I18n]', e)));
    } else {
        init().catch(e => console.warn('[I18n]', e));
    }

    /* ─── 외부 공개 API ─────────────────────────────────── */
    window.SolarI18n = {
        detectCountry,

        /**
         * 수동 언어 전환 (테스트·관리자용)
         * 예: SolarI18n.setLanguageManually('JP')
         */
        setLanguageManually(countryCode) {
            try {
                sessionStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(REDIRECT_KEY);
            } catch(_) {}

            const targetLang = Object.prototype.hasOwnProperty.call(COUNTRY_LANG_MAP, countryCode)
                ? COUNTRY_LANG_MAP[countryCode]
                : 'en';

            if (!targetLang) {
                console.info('[I18n] 수동 전환 → 한국어(원문)');
                return;
            }

            updateLangLabel(countryCode);
            applyCoreUI(targetLang);

            try { sessionStorage.setItem(REDIRECT_KEY, '1'); } catch(_) {}
            location.replace(buildTranslateURL(targetLang));
        },

        /** 현재 적용된 목표 언어 반환 */
        getCurrentLang() {
            try {
                const cached = sessionStorage.getItem(STORAGE_KEY);
                if (cached) {
                    const { country } = JSON.parse(cached);
                    return COUNTRY_LANG_MAP[country] || 'en';
                }
            } catch(_) {}
            return null;
        }
    };
})();
