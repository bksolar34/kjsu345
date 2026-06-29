/**
 * ============================================================
 *  부광솔라 자동 번역 시스템 v6.0 — Google Translate Element
 *  · 방식: translate.googleapis.com 스크립트 삽입 (인페이지 번역)
 *    → translate.google.com 리다이렉트 방식 완전 대체
 *    → 국가 도메인 확장자(.kr .jp .de 등)에 무관하게 동작
 *    → 크롬 내장 번역과 동일한 원리 (GTE: Google Translate Element)
 *  · IP 감지 3단계 폴백: ipapi.co → ip-api.com → 브라우저 언어
 *  · 한국(KR) 접속 시 원문 유지 (GTE 위젯 비활성)
 *  · 번역 완료 후 헤더 언어 배지 갱신
 * ============================================================
 */
(function () {
    'use strict';

    /* ── 국가코드 → Google Translate 언어코드 ──────────────────
       KR: null → 한국어 원문 유지 (GTE 미실행)
    ──────────────────────────────────────────────────────── */
    const COUNTRY_LANG_MAP = {
        KR: null,
        // 동아시아
        JP: 'ja', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-TW', MO: 'zh-TW', MN: 'mn',
        // 동남아시아
        VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', PH: 'tl',
        MM: 'my', KH: 'km', LA: 'lo', TL: 'pt', BN: 'ms',
        // 남아시아
        IN: 'hi', BD: 'bn', PK: 'ur', LK: 'si', NP: 'ne', BT: 'dz', MV: 'dv',
        // 중앙아시아
        UZ: 'uz', KZ: 'kk', KG: 'ky', TJ: 'tg', TM: 'tk', AF: 'ps',
        // 중동·아랍
        SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar',
        JO: 'ar', IQ: 'ar', YE: 'ar', SY: 'ar', LB: 'ar', MA: 'ar', DZ: 'ar',
        TN: 'ar', LY: 'ar', SD: 'ar', MR: 'ar', SO: 'so', DJ: 'ar', KM: 'ar',
        IL: 'iw', TR: 'tr', IR: 'fa', CY: 'el',
        // 코카서스
        GE: 'ka', AM: 'hy', AZ: 'az',
        // 서유럽
        GB: 'en', IE: 'en', MT: 'mt',
        DE: 'de', AT: 'de', CH: 'de', LI: 'de', LU: 'lb',
        FR: 'fr', BE: 'fr', MC: 'fr', AD: 'ca',
        ES: 'es', PT: 'pt',
        IT: 'it', SM: 'it', VA: 'it', NL: 'nl',
        // 북유럽
        SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', IS: 'is',
        EE: 'et', LV: 'lv', LT: 'lt',
        // 동유럽
        PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu',
        RO: 'ro', BG: 'bg', GR: 'el',
        HR: 'hr', RS: 'sr', SI: 'sl', BA: 'bs',
        ME: 'sr', MK: 'mk', AL: 'sq', XK: 'sq',
        RU: 'ru', UA: 'uk', BY: 'be', MD: 'ro',
        // 영어권
        US: 'en', AU: 'en', CA: 'en', NZ: 'en', SG: 'en',
        ZA: 'en', NG: 'en', GH: 'en', KE: 'sw', TZ: 'sw',
        UG: 'sw', RW: 'rw', ZW: 'en', ZM: 'en', BW: 'en',
        NA: 'af', LS: 'st', SZ: 'en',
        // 중남미
        MX: 'es', AR: 'es', CO: 'es', PE: 'es', CL: 'es',
        VE: 'es', EC: 'es', BO: 'es', PY: 'es', UY: 'es',
        DO: 'es', CU: 'es', GT: 'es', HN: 'es', SV: 'es',
        NI: 'es', CR: 'es', PA: 'es',
        PR: 'es', JM: 'en', HT: 'ht', TT: 'en', BB: 'en',
        GY: 'en', SR: 'nl', BZ: 'en',
        BR: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt', GW: 'pt', ST: 'pt', GQ: 'es',
        // 아프리카
        ET: 'am', ER: 'ti', SS: 'en',
        CM: 'fr', CI: 'fr', SN: 'fr', ML: 'fr', BF: 'fr',
        NE: 'fr', TD: 'fr', CD: 'fr', CG: 'fr', CF: 'fr',
        GA: 'fr', TG: 'fr', BJ: 'fr', GN: 'fr', MG: 'mg',
        MU: 'fr', SC: 'fr', RE: 'fr', YT: 'fr',
        // 오세아니아
        FJ: 'en', PG: 'en', SB: 'en', VU: 'fr', WS: 'sm',
        TO: 'to', KI: 'en', FM: 'en', MH: 'en', PW: 'en',
        NR: 'en', TV: 'en', CK: 'en', NU: 'en',
        // 태평양 섬·카리브해·기타
        PF: 'fr', NC: 'fr', WF: 'fr',
        GP: 'fr', MQ: 'fr', GF: 'fr', PM: 'fr', MF: 'fr',
        BL: 'fr', AW: 'nl', CW: 'nl', SX: 'nl', BQ: 'nl',
        GI: 'en', FO: 'da', GL: 'kl', AX: 'sv',
        SJ: 'no', IM: 'en', JE: 'en', GG: 'en',
        TF: 'fr', IO: 'en', SH: 'en', FK: 'en', GS: 'en'
    };

    const STORAGE_KEY = '_bk_geo_country_v6';
    const APPLIED_KEY = '_bk_gte_applied_v6';

    /* ── 언어 배지 업데이트 ─────────────────────────────────── */
    function updateLangLabel(text) {
        const el = document.getElementById('langLabel');
        if (!el) return;
        el.textContent = (text && /^[A-Z]{2,3}$/.test(text)) ? '.' + text.toLowerCase() : (text || 'KO');
    }

    /* ── IP 국가 감지 (3단계 폴백) ─────────────────────────── */
    async function detectCountry() {
        try {
            const cached = sessionStorage.getItem(STORAGE_KEY);
            if (cached) { const p = JSON.parse(cached); if (p?.country) return p; }
        } catch (_) {}

        // 1차: ipapi.co
        try {
            const res = await fetch('https://ipapi.co/json/', {
                cache: 'no-store',
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const d = await res.json();
                if (d.country_code && !d.error) {
                    const r = { country: d.country_code, source: 'ipapi.co' };
                    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch (_) {}
                    return r;
                }
            }
        } catch (e) { console.warn('[I18n] ipapi.co 실패:', e.message); }

        // 2차: ip-api.com
        try {
            const res = await fetch('https://ip-api.com/json/?fields=status,countryCode', {
                cache: 'no-store',
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const d = await res.json();
                if (d.status === 'success' && d.countryCode) {
                    const r = { country: d.countryCode, source: 'ip-api.com' };
                    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch (_) {}
                    return r;
                }
            }
        } catch (e) { console.warn('[I18n] ip-api.com 실패:', e.message); }

        // 3차: 브라우저 언어에서 추정
        const navLang = navigator.language || 'ko-KR';
        const parts = navLang.split('-');
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

    /* ── Google Translate Element (GTE) 초기화 ─────────────────
       translate.googleapis.com/translate_a/element.js 를 동적 삽입.
       googleTranslateElementInit() 콜백으로 번역 위젯을 초기화한 뒤
       doGTranslate() API 로 목표 언어를 자동 선택한다.
       이 방식은 현재 페이지 URL(도메인 확장자)에 전혀 영향을 받지 않으며
       크롬 내장 번역과 동일한 translate.googleapis.com 엔진을 사용한다.
    ──────────────────────────────────────────────────────────── */
    function loadGTE(targetLang) {
        // 컨테이너: body 맨 앞에 숨긴 div 삽입
        if (!document.getElementById('google_translate_element')) {
            const div = document.createElement('div');
            div.id = 'google_translate_element';
            div.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;';
            document.body.insertBefore(div, document.body.firstChild);
        }

        // GTE 초기화 콜백
        window.googleTranslateElementInit = function () {
            new window.google.translate.TranslateElement(
                {
                    pageLanguage: 'ko',
                    includedLanguages: '', // 전체 언어 허용
                    autoDisplay: false,    // 자동 배너 표시 금지
                    gaTrack: false
                },
                'google_translate_element'
            );

            // 위젯 초기화 완료 후 목표 언어 자동 선택
            // GTE 내부 select 가 렌더링될 때까지 폴링
            applyGTELanguage(targetLang, 0);
        };

        // GTE 스크립트 동적 삽입
        const script = document.createElement('script');
        script.src = 'https://translate.googleapis.com/translate_a/element.js?cb=googleTranslateElementInit';
        script.async = true;
        script.onerror = function () {
            console.warn('[I18n] GTE 스크립트 로드 실패 — 네트워크 또는 차단 환경');
        };
        document.head.appendChild(script);
    }

    /* ── GTE select 제어로 언어 전환 ───────────────────────────
       google.translate.TranslateElement 내부 <select> 의 값을 변경하고
       change 이벤트를 발행하는 것이 GTE 공식 언어 전환 방법이다.
       select 가 아직 렌더링되지 않았을 경우 최대 40회(2초) 재시도한다.
    ──────────────────────────────────────────────────────────── */
    function applyGTELanguage(lang, attempt) {
        if (attempt > 40) {
            console.warn('[I18n] GTE select 렌더링 타임아웃 — 번역 미적용');
            return;
        }

        // GTE 가 삽입하는 select#google_translate_element select
        const sel = document.querySelector('#google_translate_element select');
        if (!sel) {
            setTimeout(() => applyGTELanguage(lang, attempt + 1), 100);
            return;
        }

        // lang 값이 select options 에 있는지 확인
        const hasOption = Array.from(sel.options).some(o => o.value === lang);
        if (!hasOption) {
            // 일부 언어는 options 가 지연 로딩됨 — 재시도
            setTimeout(() => applyGTELanguage(lang, attempt + 1), 150);
            return;
        }

        sel.value = lang;
        sel.dispatchEvent(new Event('change'));
        console.info('[I18n] GTE 번역 적용:', lang);
        try { sessionStorage.setItem(APPLIED_KEY, lang); } catch (_) {}
    }

    /* ── 세션 내 이미 번역 적용된 경우 재적용 ──────────────── */
    function reapplyIfNeeded() {
        try {
            const appliedLang = sessionStorage.getItem(APPLIED_KEY);
            if (appliedLang && appliedLang !== 'ko') {
                // GTE 스크립트가 이미 있으면 재사용, 없으면 재로드
                if (window.google && window.google.translate) {
                    applyGTELanguage(appliedLang, 0);
                } else {
                    loadGTE(appliedLang);
                }
                return true;
            }
        } catch (_) {}
        return false;
    }

    /* ── 메인 초기화 ────────────────────────────────────────── */
    async function init() {
        // GTE 프록시 경유 중이면 스킵 (안전망)
        if (location.hostname.endsWith('.translate.goog')) {
            console.info('[I18n] translate.goog 프록시 경유 중 — GTE 스킵');
            return;
        }

        const { country, source } = await detectCountry();
        console.info(`[I18n] 접속 국가: ${country} (${source})`);

        const targetLang = Object.prototype.hasOwnProperty.call(COUNTRY_LANG_MAP, country)
            ? COUNTRY_LANG_MAP[country]
            : 'en';

        if (!targetLang) {
            updateLangLabel('KO');
            console.info('[I18n] 한국 접속 — 원문 유지');
            return;
        }

        updateLangLabel(country);

        // 이미 세션에 번역 적용 기록이 있으면 재적용
        if (reapplyIfNeeded()) return;

        // 최초 번역: GTE 로드 및 자동 언어 선택
        loadGTE(targetLang);
    }

    // DOMContentLoaded 이후 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init().catch(e => console.warn('[I18n]', e)));
    } else {
        init().catch(e => console.warn('[I18n]', e));
    }

    /* ── 외부 API (수동 언어 전환 지원) ────────────────────── */
    window.SolarI18n = {
        detectCountry,

        setLanguageManually(countryCode) {
            try {
                sessionStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(APPLIED_KEY);
            } catch (_) {}

            const targetLang = Object.prototype.hasOwnProperty.call(COUNTRY_LANG_MAP, countryCode)
                ? COUNTRY_LANG_MAP[countryCode] : 'en';

            if (!targetLang) {
                updateLangLabel('KO');
                console.info('[I18n] 수동 → 한국어');
                return;
            }

            updateLangLabel(countryCode);

            if (window.google && window.google.translate) {
                applyGTELanguage(targetLang, 0);
            } else {
                loadGTE(targetLang);
            }
        },

        getCurrentLang() {
            try {
                const lang = sessionStorage.getItem(APPLIED_KEY);
                return lang || null;
            } catch (_) { return null; }
        },

        // 원문(한국어)으로 복귀
        resetToKorean() {
            try {
                sessionStorage.removeItem(APPLIED_KEY);
            } catch (_) {}
            const sel = document.querySelector('#google_translate_element select');
            if (sel) {
                sel.value = 'ko';
                sel.dispatchEvent(new Event('change'));
            }
            updateLangLabel('KO');
        }
    };

})();
