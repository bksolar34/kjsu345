/**
 * ============================================================
 *  부광솔라 접속 국가 기반 자동 언어 전환 시스템 v5.0
 *  · 전세계 모든 국가 → Google Translate 프록시 번역
 *  · IP 감지 3단계 폴백: ipapi.co → ip-api.com → 브라우저 언어
 *  · 한국(KR) 접속 시 원문 유지
 *  · translate.google.com 프록시 중복 진입 방지
 * ============================================================
 */
(function () {
    'use strict';

    /* ── 국가코드 → Google Translate 언어코드 ────────────────────
       Google Translate 지원 언어 전체 커버 (2024 기준 134개 언어)
       매핑 없는 국가는 자동으로 영어(en) 폴백
    ────────────────────────────────────────────────────────── */
    const COUNTRY_LANG_MAP = {
        // ── 한국 (원문) ──────────────────────────────────────────
        KR: null,

        // ── 동아시아 ─────────────────────────────────────────────
        JP: 'ja',
        CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-TW', MO: 'zh-TW',
        MN: 'mn',

        // ── 동남아시아 ───────────────────────────────────────────
        VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', PH: 'tl',
        MM: 'my', KH: 'km', LA: 'lo', TL: 'pt', BN: 'ms',

        // ── 남아시아 ─────────────────────────────────────────────
        IN: 'hi', BD: 'bn', PK: 'ur', LK: 'si', NP: 'ne',
        BT: 'dz', MV: 'dv',

        // ── 중앙아시아 ───────────────────────────────────────────
        UZ: 'uz', KZ: 'kk', KG: 'ky', TJ: 'tg', TM: 'tk',
        AF: 'ps',

        // ── 중동·아랍 ────────────────────────────────────────────
        SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar',
        BH: 'ar', OM: 'ar', JO: 'ar', IQ: 'ar', YE: 'ar',
        SY: 'ar', LB: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar',
        LY: 'ar', SD: 'ar', MR: 'ar', SO: 'so', DJ: 'ar',
        KM: 'ar', IL: 'iw', TR: 'tr', IR: 'fa', CY: 'el',

        // ── 코카서스 ─────────────────────────────────────────────
        GE: 'ka', AM: 'hy', AZ: 'az',

        // ── 서유럽 ───────────────────────────────────────────────
        GB: 'en', IE: 'en', MT: 'mt',
        DE: 'de', AT: 'de', CH: 'de', LI: 'de', LU: 'lb',
        FR: 'fr', BE: 'fr', MC: 'fr', AD: 'ca',
        ES: 'es', PT: 'pt',
        IT: 'it', SM: 'it', VA: 'it',
        NL: 'nl',

        // ── 북유럽 ───────────────────────────────────────────────
        SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', IS: 'is',
        EE: 'et', LV: 'lv', LT: 'lt',

        // ── 동유럽 ───────────────────────────────────────────────
        PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu',
        RO: 'ro', BG: 'bg', GR: 'el',
        HR: 'hr', RS: 'sr', SI: 'sl', BA: 'bs',
        ME: 'sr', MK: 'mk', AL: 'sq', XK: 'sq',
        RU: 'ru', UA: 'uk', BY: 'be', MD: 'ro',

        // ── 발트·핀우그릭 ────────────────────────────────────────

        // ── 영어권 (영어 공용) ───────────────────────────────────
        US: 'en', AU: 'en', CA: 'en', NZ: 'en', SG: 'en',
        ZA: 'en', NG: 'en', GH: 'en', KE: 'sw', TZ: 'sw',
        UG: 'sw', RW: 'rw', ZW: 'en', ZM: 'en', BW: 'en',
        NA: 'af', LS: 'st', SZ: 'en',

        // ── 중남미 ───────────────────────────────────────────────
        MX: 'es', AR: 'es', CO: 'es', PE: 'es', CL: 'es',
        VE: 'es', EC: 'es', BO: 'es', PY: 'es', UY: 'es',
        DO: 'es', CU: 'es', GT: 'es', HN: 'es', SV: 'es',
        NI: 'es', CR: 'es', PA: 'es',
        PR: 'es', JM: 'en', HT: 'ht', TT: 'en', BB: 'en',
        GY: 'en', SR: 'nl', BZ: 'en',
        BR: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt', GW: 'pt',
        ST: 'pt', GQ: 'es',

        // ── 아프리카 ─────────────────────────────────────────────
        ET: 'am', ER: 'ti', SS: 'en',
        CM: 'fr', CI: 'fr', SN: 'fr', ML: 'fr', BF: 'fr',
        NE: 'fr', TD: 'fr', CD: 'fr', CG: 'fr', CF: 'fr',
        GA: 'fr', TG: 'fr', BJ: 'fr', GN: 'fr', MG: 'mg',
        TN: 'ar', LY: 'ar',
        MU: 'fr', SC: 'fr', RE: 'fr', YT: 'fr',

        // ── 오세아니아 ───────────────────────────────────────────
        FJ: 'en', PG: 'en', SB: 'en', VU: 'fr', WS: 'sm',
        TO: 'to', KI: 'en', FM: 'en', MH: 'en', PW: 'en',
        NR: 'en', TV: 'en', CK: 'en', NU: 'en',

        // ── 태평양 섬 ────────────────────────────────────────────
        PF: 'fr', NC: 'fr', WF: 'fr',

        // ── 카리브해 ─────────────────────────────────────────────
        GP: 'fr', MQ: 'fr', GF: 'fr', PM: 'fr', MF: 'fr',
        BL: 'fr', AW: 'nl', CW: 'nl', SX: 'nl', BQ: 'nl',

        // ── 기타 영토 ────────────────────────────────────────────
        GI: 'en', FO: 'da', GL: 'kl', AX: 'sv',
        SJ: 'no', IM: 'en', JE: 'en', GG: 'en',
        TF: 'fr', IO: 'en', SH: 'en', FK: 'en', GS: 'en'
    };

    const STORAGE_KEY  = '_bk_geo_lang_v5';
    const REDIRECT_KEY = '_bk_translated_v5';

    /* ── 핵심 UI 즉시 번역 사전 (네비게이션 — 헤더 즉각 반응용) ── */
    const CORE_UI = {
        en:      { 'nav.home':'Home',       'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Revenue Analysis', 'nav.site3d':'Site Analysis',  'nav.tech':'Technology',    'nav.contact':'Contact'      },
        ja:      { 'nav.home':'ホーム',       'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'収益分析',          'nav.site3d':'立地分析',        'nav.tech':'技術·特許',      'nav.contact':'お問い合わせ'   },
        'zh-CN': { 'nav.home':'首页',         'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'收益分析',          'nav.site3d':'选址分析',        'nav.tech':'技术专利',       'nav.contact':'咨询'          },
        'zh-TW': { 'nav.home':'首頁',         'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'收益分析',          'nav.site3d':'選址分析',        'nav.tech':'技術專利',       'nav.contact':'諮詢'          },
        de:      { 'nav.home':'Startseite',  'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Ertragsanalyse',   'nav.site3d':'Standortanalyse','nav.tech':'Technologie',   'nav.contact':'Kontakt'      },
        fr:      { 'nav.home':'Accueil',     'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Analyse revenus',  'nav.site3d':'Analyse site',   'nav.tech':'Technologie',   'nav.contact':'Contact'      },
        es:      { 'nav.home':'Inicio',      'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Análisis ingresos','nav.site3d':'Análisis sitio', 'nav.tech':'Tecnología',    'nav.contact':'Contacto'     },
        pt:      { 'nav.home':'Início',      'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Análise receita',  'nav.site3d':'Análise local',  'nav.tech':'Tecnologia',    'nav.contact':'Contato'      },
        ru:      { 'nav.home':'Главная',     'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Анализ доходов',   'nav.site3d':'Анализ участка', 'nav.tech':'Технологии',    'nav.contact':'Контакт'      },
        ar:      { 'nav.home':'الرئيسية',    'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'تحليل الإيرادات',  'nav.site3d':'تحليل الموقع',  'nav.tech':'التكنولوجيا',   'nav.contact':'اتصل بنا'     },
        vi:      { 'nav.home':'Trang chủ',   'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Phân tích doanh thu','nav.site3d':'Phân tích địa điểm','nav.tech':'Công nghệ','nav.contact':'Liên hệ'     },
        id:      { 'nav.home':'Beranda',     'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Analisis Pendapatan','nav.site3d':'Analisis Lokasi','nav.tech':'Teknologi',   'nav.contact':'Kontak'       },
        th:      { 'nav.home':'หน้าแรก',     'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'วิเคราะห์รายได้',   'nav.site3d':'วิเคราะห์พื้นที่','nav.tech':'เทคโนโลยี', 'nav.contact':'ติดต่อ'        },
        tr:      { 'nav.home':'Ana Sayfa',   'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Gelir Analizi',    'nav.site3d':'Saha Analizi',   'nav.tech':'Teknoloji',     'nav.contact':'İletişim'     },
        pl:      { 'nav.home':'Strona główna','nav.ess':'ESS (EMS/BMS)','nav.revenue':'Analiza przychodów','nav.site3d':'Analiza terenu','nav.tech':'Technologia',   'nav.contact':'Kontakt'      },
        uk:      { 'nav.home':'Головна',     'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'Аналіз доходів',   'nav.site3d':'Аналіз ділянки', 'nav.tech':'Технології',    'nav.contact':'Контакт'      },
        hi:      { 'nav.home':'होम',          'nav.ess':'ESS (EMS/BMS)', 'nav.revenue':'राजस्व विश्लेषण',   'nav.site3d':'साइट विश्लेषण', 'nav.tech':'प्रौद्योगिकी', 'nav.contact':'संपर्क'        }
    };

    /* ── Google 번역 프록시 경유 여부 판별 ────────────────────── */
    function isAlreadyTranslated() {
        return location.hostname.endsWith('.translate.goog') ||
               location.search.includes('_x_tr_tl=');
    }

    function buildTranslateURL(targetLang) {
        const pageURL = encodeURIComponent(location.href);
        return `https://translate.google.com/translate?sl=ko&tl=${targetLang}&hl=${targetLang}&u=${pageURL}`;
    }

    /* ── IP 국가 감지 (3단계 폴백) ───────────────────────────── */
    async function detectCountry() {
        try {
            const cached = sessionStorage.getItem(STORAGE_KEY);
            if (cached) { const p = JSON.parse(cached); if (p?.country) return p; }
        } catch (_) {}

        // 1차: ipapi.co
        try {
            const res = await fetch('https://ipapi.co/json/', { cache:'no-store', signal:AbortSignal.timeout(4000) });
            if (res.ok) {
                const d = await res.json();
                if (d.country_code && !d.error) {
                    const r = { country: d.country_code, source: 'ipapi.co' };
                    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch(_){}
                    return r;
                }
            }
        } catch (e) { console.warn('[I18n] ipapi.co 실패:', e.message); }

        // 2차: ip-api.com
        try {
            const res = await fetch('https://ip-api.com/json/?fields=status,countryCode', { cache:'no-store', signal:AbortSignal.timeout(4000) });
            if (res.ok) {
                const d = await res.json();
                if (d.status === 'success' && d.countryCode) {
                    const r = { country: d.countryCode, source: 'ip-api.com' };
                    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch(_){}
                    return r;
                }
            }
        } catch (e) { console.warn('[I18n] ip-api.com 실패:', e.message); }

        // 3차: 브라우저 언어 추정
        const navLang = navigator.language || navigator.userLanguage || 'ko-KR';
        const parts   = navLang.split('-');
        let country;
        if (parts.length >= 2) {
            country = parts[1].toUpperCase();
        } else {
            const langToCountry = {
                ja:'JP', zh:'CN', en:'US', de:'DE', fr:'FR', es:'ES', it:'IT',
                pt:'BR', ru:'RU', ar:'SA', tr:'TR', vi:'VN', th:'TH', id:'ID',
                ms:'MY', ko:'KR', nl:'NL', sv:'SE', pl:'PL', uk:'UA', uz:'UZ',
                mn:'MN', fi:'FI', da:'DK', no:'NO', cs:'CZ', sk:'SK', hu:'HU',
                ro:'RO', bg:'BG', el:'GR', hr:'HR', sr:'RS', sl:'SI', lt:'LT',
                lv:'LV', et:'EE', ka:'GE', hy:'AM', az:'AZ', sw:'KE', am:'ET',
                hi:'IN', bn:'BD', ur:'PK', fa:'IR', iw:'IL', tl:'PH', km:'KH'
            };
            country = langToCountry[parts[0].toLowerCase()] || 'US';
        }
        console.warn('[I18n] IP 조회 실패 → 브라우저 언어 추정:', country);
        return { country, source: 'browser-fallback' };
    }

    /* ── 핵심 UI 즉시 반영 ────────────────────────────────────── */
    function applyCoreUI(lang) {
        const dict = CORE_UI[lang];
        if (!dict) return;
        Object.entries(dict).forEach(([key, text]) => {
            document.querySelectorAll(`[data-i18n="${key}"]`).forEach(el => { el.textContent = text; });
        });
    }

    function updateLangLabel(text) {
        const el = document.getElementById('langLabel');
        if (!el) return;
        el.textContent = (text && /^[A-Z]{2,3}$/.test(text)) ? '.' + text.toLowerCase() : text;
    }

    /* ── 메인 초기화 ──────────────────────────────────────────── */
    async function init() {
        if (isAlreadyTranslated()) {
            console.info('[I18n] translate.goog 프록시 경유 중 — 스킵');
            return;
        }
        try { if (sessionStorage.getItem(REDIRECT_KEY) === '1') return; } catch(_) {}

        const { country, source } = await detectCountry();
        console.info(`[I18n] 접속 국가: ${country} (${source})`);

        // 매핑 없는 국가 → 영어 폴백
        const targetLang = Object.prototype.hasOwnProperty.call(COUNTRY_LANG_MAP, country)
            ? COUNTRY_LANG_MAP[country]
            : 'en';

        if (!targetLang) {
            updateLangLabel('KR');
            console.info('[I18n] 한국 접속 — 원문 유지');
            return;
        }

        updateLangLabel(country);
        applyCoreUI(targetLang);

        try { sessionStorage.setItem(REDIRECT_KEY, '1'); } catch(_) {}
        const url = buildTranslateURL(targetLang);
        console.info(`[I18n] 번역 리다이렉트: ${targetLang} → ${url}`);
        location.replace(url);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init().catch(e => console.warn('[I18n]', e)));
    } else {
        init().catch(e => console.warn('[I18n]', e));
    }

    /* ── 외부 API ────────────────────────────────────────────── */
    window.SolarI18n = {
        detectCountry,
        setLanguageManually(countryCode) {
            try {
                sessionStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(REDIRECT_KEY);
            } catch(_) {}
            const targetLang = Object.prototype.hasOwnProperty.call(COUNTRY_LANG_MAP, countryCode)
                ? COUNTRY_LANG_MAP[countryCode] : 'en';
            if (!targetLang) { console.info('[I18n] 수동 → 한국어'); return; }
            updateLangLabel(countryCode);
            applyCoreUI(targetLang);
            try { sessionStorage.setItem(REDIRECT_KEY, '1'); } catch(_) {}
            location.replace(buildTranslateURL(targetLang));
        },
        getCurrentLang() {
            try {
                const cached = sessionStorage.getItem(STORAGE_KEY);
                if (cached) { const { country } = JSON.parse(cached); return COUNTRY_LANG_MAP[country] || 'en'; }
            } catch(_) {}
            return null;
        }
    };
})();
