/**
 * ============================================================
 *  부광솔라 접속 국가 기반 자동 언어 전환 시스템 v3.0
 * ============================================================
 *  - 이전(v2.0)에는 접속 "도메인 확장자"(.kr/.us/.uz)로 언어를 추정했으나,
 *    실제 운영 환경에서는 도메인이 하나(.com 등)인 경우가 많아
 *    이 방식만으로는 전세계 방문자에게 의미가 없었습니다.
 *  - v3.0은 인터넷 접속 시 브라우저에 자동으로 부여되는 "접속 국가"를
 *    키 없는 공개 IP 위치 조회 API(ipapi.co)로 감지하고,
 *    Google Translate의 웹사이트 번역 엔진을 이용해 감지된 국가의
 *    공용어로 페이지 전체(7개 언어로 제한되지 않는 전세계 언어)를
 *    자동 번역합니다.
 *  - Google Translate 위젯의 화면상 UI(드롭다운, 배너 등)는 모두 숨기고
 *    "자동 적용"만 동작하도록 구성해 사용자에게는 위젯이 보이지 않습니다.
 *  - IP 위치 조회가 실패하거나(네트워크 차단 등) 국가가 한국으로 감지되면
 *    번역을 적용하지 않고 원문(한국어)을 그대로 유지합니다.
 * ============================================================
 */

(function () {
    'use strict';

    /* ─── 국가코드 → Google 번역 언어코드 매핑 ───────────────
       (Google Translate가 지원하는 100여 개 언어 중 국가의 공용어를 매핑.
        목록에 없는 국가는 영어로 폴백하며, 한국은 번역하지 않습니다.) */
    const COUNTRY_LANG_MAP = {
        KR: null,           // 한국 — 원문 유지(번역 안 함)
        US: 'en', GB: 'en', AU: 'en', CA: 'en', NZ: 'en', IE: 'en', SG: 'en', ZA: 'en', IN: 'en', PH: 'en',
        UZ: 'uz', KZ: 'kk', KG: 'ky', TJ: 'tg', TM: 'tk',
        JP: 'ja', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-TW', MO: 'zh-TW',
        VN: 'vi', TH: 'th', MY: 'ms', ID: 'id', MM: 'my', KH: 'km', LA: 'lo',
        BD: 'bn', PK: 'ur', LK: 'si', NP: 'ne',
        SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', JO: 'ar', IQ: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', LY: 'ar', LB: 'ar', YE: 'ar', SY: 'ar',
        IL: 'iw', TR: 'tr', IR: 'fa', AF: 'ps',
        DE: 'de', AT: 'de', CH: 'de',
        FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
        ES: 'es', MX: 'es', AR: 'es', CO: 'es', PE: 'es', CL: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es',
        IT: 'it', SM: 'it', VA: 'it',
        PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt',
        RU: 'ru', BY: 'ru', UA: 'uk',
        NL: 'nl', SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', IS: 'is',
        PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', GR: 'el', HR: 'hr', RS: 'sr', SI: 'sl', LT: 'lt', LV: 'lv', EE: 'et', AL: 'sq', MK: 'mk', BA: 'bs',
        KE: 'sw', TZ: 'sw', ET: 'am', NG: 'en', GH: 'en',
        MN: 'mn', GE: 'ka', AM: 'hy', AZ: 'az'
    };

    const STORAGE_KEY = '_bk_geo_lang_v3';

    /* ─── UI 핵심 사전 (헤더/버튼 등 즉시 반응이 필요한 요소) ───
       Google Translate가 본문 전체를 자연어로 번역하기까지 약간의 지연이
       있을 수 있으므로, 가장 먼저 보이는 핵심 UI 텍스트는 별도 사전으로
       즉시 전환합니다. 나머지 본문은 Google Translate가 전세계 언어로 처리합니다. */
    const CORE_UI = {
        en: {
            'nav.home': 'Home', 'nav.about': 'About', 'nav.revenue': 'Revenue Analysis',
            'nav.site3d': 'Site Analysis', 'nav.tech': 'Technology', 'nav.contact': 'Contact'
        },
        ja: {
            'nav.home': 'ホーム', 'nav.about': '会社案内', 'nav.revenue': '収益分析',
            'nav.site3d': '立地分析', 'nav.tech': '技術·特許', 'nav.contact': 'お問い合わせ'
        },
        'zh-CN': {
            'nav.home': '首页', 'nav.about': '公司介绍', 'nav.revenue': '收益分析',
            'nav.site3d': '选址分析', 'nav.tech': '技术专利', 'nav.contact': '咨询'
        }
        // 그 외 언어는 Google Translate가 페이지 전체를 번역하면서 자연히 처리됩니다.
    };

    /* ─── 접속 국가 감지 (키 없는 공개 IP 위치 조회) ──────────── */
    async function detectCountry() {
        const cached = sessionStorage.getItem(STORAGE_KEY);
        if (cached) {
            try { return JSON.parse(cached); } catch (e) { /* 무시하고 재조회 */ }
        }

        try {
            const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
            if (!res.ok) throw new Error('IP 위치 조회 실패');
            const data = await res.json();
            const result = { country: data.country_code || 'KR', source: 'ipapi' };
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
            return result;
        } catch (e) {
            console.warn('[I18n] IP 국가 감지 실패, 브라우저 언어로 대체:', e.message);
            const browserLang = (navigator.language || 'ko-KR').split('-')[1] || 'KR';
            return { country: browserLang.toUpperCase(), source: 'browser-fallback' };
        }
    }

    /* ─── Google Translate 위젯을 화면에 보이지 않게 로드하고
           감지된 언어로 즉시 전환 ──────────────────────────── */
    let translateReady = null;

    function loadGoogleTranslate(targetLang) {
        if (!targetLang) return Promise.resolve(); // 한국어는 번역 불필요

        if (translateReady) return translateReady;

        translateReady = new Promise((resolve) => {
            const containerId = 'google_translate_container';
            if (!document.getElementById(containerId)) {
                const div = document.createElement('div');
                div.id = containerId;
                div.style.cssText = 'position:fixed; top:-200px; left:-200px; width:1px; height:1px; overflow:hidden;';
                document.body.appendChild(div);
            }

            window.googleTranslateElementInit = function () {
                new google.translate.TranslateElement({
                    pageLanguage: 'ko',
                    includedLanguages: undefined, // 전세계 모든 지원 언어를 대상으로 함(7개 제한 없음)
                    autoDisplay: false,
                    layout: google.translate.TranslateElement.InlineLayout.SIMPLE
                }, containerId);

                // 위젯이 그려진 뒤 목표 언어로 즉시 전환
                let attempts = 0;
                const trySwitch = () => {
                    attempts++;
                    const combo = document.querySelector('select.goog-te-combo');
                    if (combo) {
                        combo.value = targetLang;
                        combo.dispatchEvent(new Event('change'));
                        resolve();
                    } else if (attempts < 40) {
                        setTimeout(trySwitch, 150);
                    } else {
                        resolve(); // 실패해도 페이지가 멈추지 않도록 resolve
                    }
                };
                setTimeout(trySwitch, 200);
            };

            const script = document.createElement('script');
            script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
            script.async = true;
            document.head.appendChild(script);
        });

        return translateReady;
    }

    /* ─── 핵심 UI 즉시 반영 ────────────────────────────────── */
    function applyCoreUI(lang) {
        const dict = CORE_UI[lang];
        if (!dict) return;
        Object.entries(dict).forEach(([key, text]) => {
            document.querySelectorAll(`[data-i18n="${key}"]`).forEach(el => { el.textContent = text; });
        });
    }

    function updateLangLabel(countryCode) {
        const label = document.getElementById('langLabel');
        if (label) label.textContent = countryCode || 'KO';
    }

    /* ─── 초기 실행 ────────────────────────────────────────── */
    async function init() {
        const { country } = await detectCountry();
        const targetLang = COUNTRY_LANG_MAP[country];

        updateLangLabel(country === 'KR' || !country ? 'KO' : country);

        if (!targetLang) {
            return; // 한국 또는 매핑 없는 국가는 원문 유지
        }

        applyCoreUI(targetLang);
        await loadGoogleTranslate(targetLang);
    }

    document.addEventListener('DOMContentLoaded', () => {
        init().catch(e => console.warn('[I18n] 초기화 중 오류:', e));
    });

    window.SolarI18n = {
        detectCountry,
        setLanguageManually: async (countryCode) => {
            sessionStorage.removeItem(STORAGE_KEY);
            const targetLang = COUNTRY_LANG_MAP[countryCode];
            updateLangLabel(countryCode);
            if (targetLang) {
                applyCoreUI(targetLang);
                await loadGoogleTranslate(targetLang);
            }
        }
    };
})();
