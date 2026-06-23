/**
 * ============================================================
 *  부광솔라 통화 환산 모듈 v1.0
 * ============================================================
 *  - 통합수익분석의 모든 금액 계산은 항상 원화(KRW)를 기준으로 수행됩니다
 *    (SMP/REC/CDM 단가, 투자비 등 입력값이 모두 한국 제도 기반 원화 단위이므로).
 *  - 화면 표시(테이블/차트/CSV)만 사용자가 선택한 통화(KRW 또는 USD)로
 *    환산해서 보여줍니다. 즉 계산 로직과 표시 통화를 분리한 구조입니다.
 *  - 환율은 키가 필요 없는 공개 API(open.er-api.com, 일 1회 갱신)로 조회하며,
 *    세션 동안 캐시해 반복 호출하지 않습니다. 조회 실패 시 직전 알려진
 *    환율 또는 안전한 기본값(1,350원/달러 부근)으로 폴백합니다.
 * ============================================================
 */

(function () {
    'use strict';

    const FALLBACK_KRW_PER_USD = 1380; // API 실패 시 폴백 환율(대략적인 최근 시세)
    let cachedRate = null; // 1 USD = N KRW
    let fetchPromise = null;

    async function getKrwPerUsd() {
        if (cachedRate) return cachedRate;
        if (fetchPromise) return fetchPromise;

        fetchPromise = (async () => {
            try {
                const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
                if (!res.ok) throw new Error('환율 API 응답 오류');
                const data = await res.json();
                const rate = data?.rates?.KRW;
                if (!rate || rate <= 0) throw new Error('KRW 환율 없음');
                cachedRate = rate;
                return rate;
            } catch (e) {
                console.warn('[Currency] 환율 조회 실패, 기본값 사용:', e.message);
                cachedRate = FALLBACK_KRW_PER_USD;
                return cachedRate;
            }
        })();

        return fetchPromise;
    }

    /** 원화 금액(KRW)을 현재 환율로 달러(USD)로 환산합니다. */
    function krwToUsd(krwAmount) {
        const rate = cachedRate || FALLBACK_KRW_PER_USD;
        return krwAmount / rate;
    }

    window.SolarCurrency = {
        getKrwPerUsd,
        krwToUsd,
        getCachedRate: () => cachedRate || FALLBACK_KRW_PER_USD,
        FALLBACK_KRW_PER_USD
    };
})();
