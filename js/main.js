/* ===========================
   부광솔라 통합 메인 JS v4.0
   - 5개 독립 뷰 스위치 구조 (ESS/통합수익분석/입지분석/기술특허/문의)
   - 주소 지오코딩 → 좌표 → NASA 1년치 일사량 → 23년 수익분석 직접 대입
   - 입지분석: 주소+면적 → 좌표 → 지형/건물/일사량 결합 3D
   =========================== */

/* ── BESS / ESS 효율 전역 상수 ───────────────────────────────────
   수정 시 이 블록만 바꾸면 ESS 계산기 + 수익분석 전체에 반영됩니다.
   · 배터리 충전효율  : 98 % (ESS_CHARGE_EFF)
   · 배터리 방전심도  : 80 % (ESS_DISCHARGE_EFF  — DoD 80%)
   · PCS 충전·방전 효율: 97 % (PCS_EFF)
   · 인버터 효율      : 97 % (INVERTER_EFF)
   · BESS 연간 용량 저감률: 1.95 %/년 (BESS_DEGRADATION)
──────────────────────────────────────────────────────────────── */
const ESS_CHARGE_EFF    = 0.98;    // 배터리 충전효율 98 %
const ESS_DISCHARGE_EFF = 0.80;    // 실효 방전심도 80 %
const PCS_EFF           = 0.97;    // PCS 효율 97 %
const INVERTER_EFF      = 0.97;    // 인버터 효율 97 %
const BESS_DEGRADATION  = 0.0195;  // 배터리 연간 용량 저감률 1.95 %/년

(function () {
    emailjs.init("EKZKrQa8dovHr1AI9");
})();

// ===========================================================
//   스위치뷰 (Home/About/Revenue/Site3D/Tech/Contact)
// ===========================================================
function switchView(viewName) {
    document.querySelectorAll('.view-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.view === viewName);
    });
    document.querySelectorAll('#mainNav a[data-view]').forEach(a => {
        a.classList.toggle('active', a.dataset.view === viewName);
    });
    document.querySelectorAll('#mobileNav a[data-view]').forEach(a => {
        a.classList.toggle('active', a.dataset.view === viewName);
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
    closeMobileNav();

    if (window.SolarAnalytics) {
        SolarAnalytics.track('view_switch', viewName, {});
    }

    if (viewName === 'site3d') {
        setTimeout(() => {
            SolarSite3D.initPlaceholder(SiteState.lat, SiteState.lon);
            // 기본 위치로 Leaflet 지도 초기화
            LeafletMap.init(SiteState.lat, SiteState.lon, 200);
            LeafletMap.invalidateSize();
            if (SiteState.hasRealData) updateSunPosition();
        }, 50);
    }

    if (viewName === 'tech') {
        renderTechAssets();
    }
}

// 네비게이션 클릭 핸들러 등록 (단일 소스에서 한 번만 바인딩)
document.addEventListener('click', e => {
    const link = e.target.closest('a[data-view]');
    if (link) {
        e.preventDefault();
        switchView(link.dataset.view);
    }
});

function buildMobileNav() {
    const main = document.getElementById('mainNav');
    const mobile = document.getElementById('mobileNav');
    if (!main || !mobile) return;
    mobile.innerHTML = '';
    main.querySelectorAll('a').forEach(a => {
        const clone = a.cloneNode(true);
        mobile.appendChild(clone);
    });
}

document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.getElementById('mobileNav').classList.toggle('open');
});

function closeMobileNav() {
    document.getElementById('mobileNav')?.classList.remove('open');
}

window.addEventListener('scroll', () => {
    const header = document.getElementById('main-header');
    if (window.scrollY > 50) {
        header.style.boxShadow = '0 4px 30px rgba(0,0,0,0.1)';
    } else {
        header.style.boxShadow = '0 2px 20px rgba(0,0,0,0.06)';
    }
});

// ===========================================================
//   통합수익분석: 주소 지오코딩 → NASA 1년치 일사량 → 수익분석 대입
// ===========================================================
const RevenueState = {
    lat: 37.56, lon: 126.98, displayName: '대전광역시 서구 복수중로30',
    avgIrradiance: null  // NASA 데이터 수신 전까지 null (기본 입력값 사용)
};

async function geocodeAddress() {
    const addrInput = document.getElementById('address-input');
    const address = addrInput.value.trim();

    if (!address) {
        document.getElementById('geo-result').innerHTML = `<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> 주소를 입력해주세요.`;
        return;
    }

    document.getElementById('geo-result').innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 좌표 검색 중...`;

    try {
        const geo = await SolarGeo.geocode(address);
        await processRevenueLocation(geo, address);
    } catch (err) {
        console.error(err);
        document.getElementById('geo-result').innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ef4444"></i> ${err.message || '좌표 검색에 실패했습니다.'}`;
    }
}

/**
 * 위도/경도를 직접 입력하여 좌표를 확정하는 경우 (주소 검색 대체 수단).
 * 주소 지오코딩 없이 입력된 좌표를 그대로 사용해 NASA 일사량을 조회합니다.
 */
async function geocodeRevenueByCoord() {
    const resultBox = document.getElementById('geo-result');
    const lat = parseFloat(document.getElementById('revenue-lat-input').value);
    const lon = parseFloat(document.getElementById('revenue-lon-input').value);

    if (isNaN(lat) || isNaN(lon)) {
        resultBox.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> 위도/경도를 모두 입력해주세요.`;
        return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        resultBox.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> 유효한 좌표 범위(위도 -90~90, 경도 -180~180)를 입력해주세요.`;
        return;
    }

    const displayName = `위도 ${lat.toFixed(6)}, 경도 ${lon.toFixed(6)} (직접 입력)`;
    await processRevenueLocation({ lat, lon, displayName }, displayName);
}

/**
 * 좌표가 확정된 이후의 공통 처리 — 버튼 클릭(Nominatim) 과
 * 주소창 자동완성 선택 양쪽에서 동일하게 호출됩니다.
 * geo: { lat, lon, displayName }
 */
async function processRevenueLocation(geo, addressLabel) {
    const resultBox = document.getElementById('geo-result');
    RevenueState.lat = geo.lat;
    RevenueState.lon = geo.lon;
    RevenueState.displayName = geo.displayName;

    resultBox.innerHTML = `
        <i class="fas fa-circle-notch fa-spin"></i>
        <span>좌표 확인됨 (${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}) — NASA 1년치 일사량 조회 중...</span>`;

    try {
        const nasa = await SolarGeo.fetchNasaIrradiance(geo.lat, geo.lon);
        RevenueState.avgIrradiance = nasa.avgIrradiance;

        // NASA 등가 발전시간을 정밀 시뮬레이터 genTime 입력값에 직접 대입
        document.getElementById('genTime').value = nasa.equivGenHours.toFixed(2);

        resultBox.innerHTML = `
            <i class="fas fa-check-circle" style="color:var(--primary)"></i>
            <span>
                <strong>${geo.displayName}</strong><br>
                위도 ${geo.lat.toFixed(4)} · 경도 ${geo.lon.toFixed(4)} ·
                NASA ${nasa.year}년 평균 일사량 <strong>${nasa.avgIrradiance.toFixed(2)} kWh/m²/day</strong>
                → 일평균 발전시간 <strong>${nasa.equivGenHours.toFixed(2)}h</strong>로 자동 반영됨
            </span>`;

        document.getElementById('nasa-status').innerHTML = `
            <i class="fas fa-satellite-dish" style="color:var(--primary)"></i>
            <span>NASA 좌표기반 실측 일사량 적용 중 — ${geo.displayName} (${nasa.year}년 1년치 평균)</span>`;
        document.getElementById('nasa-status').classList.add('nasa-active');

        if (window.SolarAnalytics) {
            SolarAnalytics.track('geocode_revenue', addressLabel || geo.displayName, { lat: geo.lat, lon: geo.lon });
        }

        runProfitAnalysis();

    } catch (err) {
        console.error(err);
        resultBox.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ef4444"></i> ${err.message || 'NASA 데이터 조회에 실패했습니다.'}`;
    }
}

// ===========================================================
//   23년 정밀 수익 분석 (수익분석Profit Analysis.html 로직 그대로 + NASA 연동)
// ===========================================================
let profitChart = null;
let profitData = [];

function updatePVEquity() {
    const invest = parseFloat(document.getElementById('pvInvest').value) || 0;
    const rate = parseFloat(document.getElementById('pvEquityRate').value) || 0;
    document.getElementById('pvEquityAmount').value = Math.round(invest * (rate / 100));
    updateFinance();
}

function updateBESSEquity() {
    const bessInv = parseFloat(document.getElementById('bessInvest').value) || 0;
    const subsidy = parseFloat(document.getElementById('bessSubsidy')?.value) || 0;
    const netInvest = Math.max(0, bessInv - subsidy);
    const rate = parseFloat(document.getElementById('bessEquityRate').value) || 0;
    // 순투자비 기준으로 자기자본 계산
    if (document.getElementById('bessNetInvest')) {
        document.getElementById('bessNetInvest').value = netInvest.toFixed(1);
    }
    document.getElementById('bessEquityAmount').value = Math.round(netInvest * (rate / 100));
    updateFinance();
}

function updateFinance() {
    const pvInv = parseFloat(document.getElementById('pvInvest').value) || 0;
    const bessInv = parseFloat(document.getElementById('bessInvest').value) || 0;
    const subsidy = parseFloat(document.getElementById('bessSubsidy')?.value) || 0;
    // 총 투자비는 보조금 차감 후 순투자비 합산
    const bessNet = Math.max(0, bessInv - subsidy);
    document.getElementById('totalInvest').value = pvInv + bessNet;

    if (document.getElementById('bessNetInvest')) {
        document.getElementById('bessNetInvest').value = bessNet.toFixed(1);
    }

    const pvRate = parseFloat(document.getElementById('pvEquityRate').value) || 0;
    const bessRate = parseFloat(document.getElementById('bessEquityRate').value) || 0;
    document.getElementById('pvEquityAmount').value = Math.round(pvInv * (pvRate / 100));
    // BESS 자기자본은 순투자비(보조금 차감) 기준으로 계산
    document.getElementById('bessEquityAmount').value = Math.round(bessNet * (bessRate / 100));
}

function runProfitAnalysis() {
    const pvCap    = parseFloat(document.getElementById('pvCap').value)      || 3300;
    const genTime  = parseFloat(document.getElementById('genTime').value)     || 3.4;
    const smp      = parseFloat(document.getElementById('smpPrice').value)    || 185;
    const rec      = (parseFloat(document.getElementById('recPrice').value)   || 75000) / 1000;
    const weight   = parseFloat(document.getElementById('recWeight').value)   || 1.0;
    const cdm      = parseFloat(document.getElementById('cdmPrice').value)    || 0;

    const pvInv       = parseFloat(document.getElementById('pvInvest').value)       || 3300;
    const bessInv     = parseFloat(document.getElementById('bessInvest').value)     || 2000;
    const subsidy     = parseFloat(document.getElementById('bessSubsidy')?.value)   || 0;
    const bessNet     = Math.max(0, bessInv - subsidy);   // 보조금 차감 순투자비
    const bessCapKwh  = parseFloat(document.getElementById('bessCap').value)        || 0;
    const pvEqRate    = parseFloat(document.getElementById('pvEquityRate').value)   || 10;
    const bessEqRate  = parseFloat(document.getElementById('bessEquityRate').value) || 10;
    const interestRate= (parseFloat(document.getElementById('interestRate').value)  || 5.5) / 100;
    const taxRate     = (parseFloat(document.getElementById('taxRate').value)       || 10) / 100;
    const term        = parseInt(document.getElementById('loanTerm').value)         || 23;

    /* ── 투자·자본 ────────────────────────────────────────── */
    const pvEq        = pvInv  * (pvEqRate  / 100) * 1e6;
    const bessEq      = bessNet * (bessEqRate / 100) * 1e6;
    const totalInvest = (pvInv + bessNet) * 1e6;
    const totalEquity = pvEq + bessEq;
    const loanPrincipal  = totalInvest - totalEquity;
    const annualPrincipal= term > 0 ? loanPrincipal / term : 0;

    /* ── BESS 기본 파라미터 ───────────────────────────────── */
    // 실효 방전용량 (kWh/회) = 설치용량 × 충전효율 × PCS효율 × 방전심도
    // 연간 사이클 수는 365회 (1일 1회 기준) 적용
    const bessUsableBase  = bessCapKwh * ESS_CHARGE_EFF * PCS_EFF * ESS_DISCHARGE_EFF;
    const bessAnnualCycles= 365; // 1일 1회 방전

    profitData = [];
    let cumSum    = -totalEquity;
    let remainLoan= loanPrincipal;

    for (let i = 1; i <= term; i++) {
        /* PV 발전량 — 연간 0.7 % 패널 출력 저감 (업계 표준) */
        const annualGen = pvCap * genTime * 365 * Math.pow(1 - 0.007, i - 1);

        /* PV 수익 */
        const pvRevenue = annualGen * (smp + (rec * weight) + cdm);

        /* BESS 수익 계산
           · 연간 실효 방전용량 = 기준 실효용량 × (1 − 저감률)^(년차−1)
           · BESS 방전 전력은 SMP 단가로 판매 (피크절감/주파수조정 수익)
           · Round-trip 효율이 이미 bessUsableBase에 반영되어 있으므로
             여기서는 단순히 연간 방전 전력량 × SMP로 계산
        */
        const bessUsableYear = bessCapKwh > 0
            ? bessCapKwh
              * ESS_CHARGE_EFF          // 충전효율 98 %
              * PCS_EFF                 // PCS 효율 97 %
              * ESS_DISCHARGE_EFF       // 방전심도 80 %
              * Math.pow(1 - BESS_DEGRADATION, i - 1)  // 저감률 1.95 %/년
            : 0;
        const bessAnnualEnergy  = bessUsableYear * bessAnnualCycles; // kWh/년
        const bessRevenue       = bessAnnualEnergy * smp;             // 원/년

        /* 합산 수익 */
        const revenue = pvRevenue + bessRevenue;

        /* 운영비 (O&M 1.5 % + 고정비) */
        const opex    = (revenue * 0.015) + (50000000 / term);

        /* 금융 */
        const interest = remainLoan > 0 ? remainLoan * interestRate : 0;
        const ebt      = revenue - opex - interest;
        const tax      = ebt > 0 ? ebt * taxRate : 0;
        const netProfit= ebt - tax;
        const cashFlow = netProfit - annualPrincipal;

        remainLoan = Math.max(0, remainLoan - annualPrincipal);
        cumSum    += cashFlow;

        profitData.push({
            i, revenue, pvRevenue, bessRevenue,
            bessUsableYear: bessUsableYear.toFixed(1),
            bessAnnualEnergy: Math.round(bessAnnualEnergy),
            opex, interest, ebt, tax, netProfit,
            repayment: annualPrincipal, cashFlow, cumSum
        });
    }

    rerenderProfitTable();

    if (window.SolarAnalytics) {
        SolarAnalytics.track('profit_analysis', {
            pvCap, term, totalInvest: pvInv + bessInv,
            bessCapKwh,
            bessChargeEff: ESS_CHARGE_EFF,
            pcsEff: PCS_EFF,
            degradationRate: BESS_DEGRADATION,
            nasaApplied: RevenueState.avgIrradiance !== null
        });
    }
}

// ===========================================================
//   통화 표시 (계산은 항상 원화 기준, 표시만 환산)
// ===========================================================
let displayCurrency = 'KRW';

/**
 * 원화 금액(v)을 현재 선택된 표시 통화로 변환해 천단위 콤마 포맷팅합니다.
 * 계산 자체(profitData 저장값)는 항상 원화이며, 이 함수는 화면 표시 시점에만 환산합니다.
 */
function fmt(v) {
    if (displayCurrency === 'USD' && window.SolarCurrency) {
        const usd = SolarCurrency.krwToUsd(v);
        return usd.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    return Math.round(v).toLocaleString();
}

/** 만원 단위 차트 값(원화 기준 net/cum 만원)을 현재 통화에 맞는 단위로 변환합니다. */
function fmtChartUnit(manwonValue) {
    const krw = manwonValue * 10000;
    if (displayCurrency === 'USD' && window.SolarCurrency) {
        return Math.round(SolarCurrency.krwToUsd(krw));
    }
    return manwonValue; // KRW는 기존처럼 '만원' 단위 그대로
}

/**
 * 통화 전환 — 버튼 클릭 시 호출됩니다. USD 전환 시 환율을 비동기로 받아온 뒤
 * 테이블/차트/헤더 단위 표기를 모두 다시 그립니다(계산 재실행 없이 표시만 갱신).
 */
async function changeCurrency(currency) {
    displayCurrency = currency;
    document.querySelectorAll('.currency-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.currency === currency);
    });

    const hintEl = document.getElementById('currencyHintText');
    const unitHead = document.getElementById('curUnitHead1');
    let rate = window.SolarCurrency ? SolarCurrency.getCachedRate() : 1380;

    if (currency === 'USD') {
        if (hintEl) hintEl.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 실시간 환율 조회 중...`;
        rate = await SolarCurrency.getKrwPerUsd();
        if (unitHead) unitHead.textContent = ' ($)';
        if (hintEl) hintEl.textContent = `결과만 달러로 환산 표시합니다. (현재 환율 1USD ≈ ${Math.round(rate).toLocaleString()}원)`;
    } else {
        rate = 1380;
        if (unitHead) unitHead.textContent = ' (원)';
        if (hintEl) hintEl.textContent = '모든 입력값과 계산은 원화 기준으로 수행되며, 결과 표시 통화만 전환됩니다.';
    }

    // ── 입력창 레이블 단위 실시간 변환 ──
    const isUsd = currency === 'USD';
    const rateStr = `1USD≈${Math.round(rate).toLocaleString()}원`;

    // 입력 레이블 정의: [fieldId, 원화 레이블, 달러 레이블]
    const labelMap = [
        ['pvInvest',         'PV 투자비 (백만원)',          `PV 투자비 (천달러$) <small style="color:#aaa;font-size:.75rem;">${rateStr}</small>`],
        ['bessInvest',       'BESS 투자비 (백만원)',         `BESS 투자비 (천달러$) <small style="color:#aaa;font-size:.75rem;">${rateStr}</small>`],
        ['bessSubsidy',      '정부 보조금 (백만원)',          `정부 보조금 (천달러$) <small style="color:#aaa;font-size:.75rem;">${rateStr}</small>`],
        ['bessNetInvest',    'BESS 순투자비 (백만원)',        `BESS 순투자비 (천달러$)`],
        ['pvEquityAmount',   'PV 자기자본 금액 (백만원)',     `PV 자기자본 금액 (천달러$)`],
        ['bessEquityAmount', 'BESS 자기자본 금액 (백만원)',   `BESS 자기자본 금액 (천달러$)`],
        ['totalInvest',      '총 투자비 (백만원)',            `총 투자비 (천달러$)`],
        ['smpPrice',         'SMP 단가 (원/kWh)',             `SMP 단가 (¢/kWh) <small style="color:#aaa;font-size:.75rem;">달러환산</small>`],
        ['recPrice',         'REC 단가 (원/MEC)',             `REC 단가 ($/MEC) <small style="color:#aaa;font-size:.75rem;">달러환산</small>`],
    ];

    labelMap.forEach(([id, krwLabel, usdLabel]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const row = el.closest('.pi-row');
        if (!row) return;
        const lbl = row.querySelector('label, span[data-i18n]');
        if (lbl) lbl.innerHTML = isUsd ? usdLabel : krwLabel;
        // 입력창 배경색으로 통화 상태 표시
        el.style.borderColor = isUsd ? '#f39c12' : '';
    });

    // 섹션 헤더에 통화 아이콘 배지 추가
    const piCards = document.querySelectorAll('.pi-card h4');
    piCards.forEach(h => {
        const existingBadge = h.querySelector('.cur-badge');
        if (existingBadge) existingBadge.remove();
        if (isUsd) {
            const span = document.createElement('span');
            span.className = 'cur-badge';
            span.style.cssText = 'margin-left:8px;padding:2px 8px;background:#f39c12;color:#fff;border-radius:10px;font-size:0.72rem;font-weight:700;';
            span.textContent = 'USD';
            h.appendChild(span);
        }
    });

    // 저장된 profitData(원화 원본)를 다시 렌더링
    if (profitData.length) rerenderProfitTable();

    if (window.SolarAnalytics) {
        SolarAnalytics.track('currency_change', currency, {});
    }
}

/** profitData(원화 원본)를 현재 displayCurrency 기준으로 테이블/차트에 다시 그립니다. */
function rerenderProfitTable() {
    const tbody = document.getElementById('profitBody');
    tbody.innerHTML = '';
    const labels = [], netArr = [], cumArr = [];

    profitData.forEach(d => {
        labels.push(d.i + '년');
        netArr.push(fmtChartUnit(Math.round(d.netProfit / 10000)));
        cumArr.push(fmtChartUnit(Math.round(d.cumSum / 10000)));

        // BESS 수익이 있으면 PV+BESS 분리 tooltip
        const revDisplay = d.bessRevenue > 0
            ? `${fmt(d.revenue)} <small style="color:#3498db;font-size:0.75rem;">(PV:${fmt(d.pvRevenue)} + BESS:${fmt(d.bessRevenue)})</small>`
            : fmt(d.revenue);

        tbody.innerHTML += `<tr>
            <td style="text-align:center; font-weight:700;">${d.i}</td>
            <td>${revDisplay}</td>
            <td class="neg">-${fmt(d.opex)}</td>
            <td class="neg">-${fmt(d.interest)}</td>
            <td>${fmt(d.ebt)}</td>
            <td>${fmt(d.tax)}</td>
            <td class="col-blue">${fmt(d.netProfit)}</td>
            <td>${fmt(d.repayment)}</td>
            <td class="col-green">${fmt(d.cashFlow)}</td>
            <td style="color:${d.cumSum >= 0 ? '#2563eb' : '#ef4444'}; font-weight:700;">${fmt(d.cumSum)}</td>
        </tr>`;
    });

    // BESS 효율 적용 정보 표시
    const effNote = document.getElementById('bess-eff-note');
    if (effNote) {
        const hasBess = profitData.some(d => d.bessRevenue > 0);
        effNote.style.display = hasBess ? 'block' : 'none';
        effNote.innerHTML =
            `<i class="fas fa-info-circle" style="color:#3498db;"></i> ` +
            `BESS 적용 효율: 충전효율 ${(ESS_CHARGE_EFF*100).toFixed(0)}% · ` +
            `PCS효율 ${(PCS_EFF*100).toFixed(0)}% · ` +
            `방전심도 ${(ESS_DISCHARGE_EFF*100).toFixed(0)}% · ` +
            `연간저감률 ${(BESS_DEGRADATION*100).toFixed(2)}%/년`;
    }

    renderProfitChart(labels, netArr, cumArr);
}

function renderProfitChart(labels, net, cum) {
    const ctx = document.getElementById('profitChart').getContext('2d');
    if (profitChart) profitChart.destroy();

    const unitLabel = displayCurrency === 'USD' ? '달러' : '만원';
    const unitSuffix = displayCurrency === 'USD' ? '' : '만';
    const unitPrefix = displayCurrency === 'USD' ? '$' : '';

    profitChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: `연간 당기순이익 (${unitLabel})`,
                    data: net,
                    backgroundColor: 'rgba(45, 140, 78, 0.75)',
                    borderRadius: 6,
                    order: 2
                },
                {
                    label: `누적현금흐름 (${unitLabel})`,
                    data: cum,
                    type: 'line',
                    borderColor: '#f39c12',
                    backgroundColor: 'rgba(243, 156, 18, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${unitPrefix}${ctx.parsed.y.toLocaleString()} ${unitSuffix}`
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { callback: v => unitPrefix + v.toLocaleString() + unitSuffix }
                }
            }
        }
    });
}

function downloadCSV() {
    if (!profitData.length) { alert('먼저 분석을 실행하세요.'); return; }

    const isUsd = displayCurrency === 'USD';
    const unitLabel = isUsd ? 'USD' : 'KRW';
    const conv = (v) => isUsd && window.SolarCurrency ? Math.round(SolarCurrency.krwToUsd(v)) : Math.round(v);

    let csv = `\uFEFF년차,매출액(${unitLabel}),영업비용(${unitLabel}),이자비용(${unitLabel}),세전이익(${unitLabel}),법인세(${unitLabel}),당기순이익(${unitLabel}),원금상환(${unitLabel}),연간현금흐름(${unitLabel}),누적수익(${unitLabel})\n`;
    profitData.forEach(d => {
        csv += `${d.i},${conv(d.revenue)},${conv(d.opex)},${conv(d.interest)},${conv(d.ebt)},${conv(d.tax)},${conv(d.netProfit)},${conv(d.repayment)},${conv(d.cashFlow)},${conv(d.cumSum)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `부광솔라_23년_수익분석_${unitLabel}.csv`;
    a.click();
}

// ===========================================================
//   입지분석: 주소+면적 → 좌표 → 실측 지형/실제 건물/NASA 일사량 결합 3D
// ===========================================================
const SiteState = {
    lat: 37.56, lon: 126.98, displayName: '서울 (한국)',
    avgIrradiance: 4.5,
    capacityKW: 600 / 6.18,
    areaMeters2: 600 * 3.3058,
    terrainRelief: null,
    hasRealData: false
};

function onSiteAreaChange() {
    const areaVal = parseFloat(document.getElementById('site-land-area').value) || 600;
    const areaUnit = document.getElementById('site-area-unit').value;
    SiteState.capacityKW = (areaUnit === 'py') ? (areaVal / 6.18) : (areaVal / 20.43);
    SiteState.areaMeters2 = (areaUnit === 'py') ? (areaVal * 3.3058) : areaVal;
}

async function geocodeSiteAddress() {
    const addrInput = document.getElementById('site-address-input');
    const address = addrInput.value.trim();

    if (!address) {
        document.getElementById('site-geo-result').innerHTML = `<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> 주소를 입력해주세요.`;
        return;
    }

    document.getElementById('site-geo-result').innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 좌표 검색 중...`;
    onSiteAreaChange();

    try {
        const geo = await SolarGeo.geocode(address);
        await processSiteLocation(geo, address);
    } catch (err) {
        console.error(err);
        document.getElementById('site-geo-result').innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ef4444"></i> ${err.message || '좌표 검색에 실패했습니다.'}`;
    }
}

/**
 * 위도/경도를 직접 입력하여 좌표를 확정하는 경우 (주소 검색 대체 수단).
 * 주소 지오코딩 없이 입력된 좌표를 그대로 사용해 3D 입지분석을 실행합니다.
 */
async function geocodeSiteByCoord() {
    const resultBox = document.getElementById('site-geo-result');
    const lat = parseFloat(document.getElementById('site-lat-input').value);
    const lon = parseFloat(document.getElementById('site-lon-input').value);

    if (isNaN(lat) || isNaN(lon)) {
        resultBox.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> 위도/경도를 모두 입력해주세요.`;
        return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        resultBox.innerHTML = `<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> 유효한 좌표 범위(위도 -90~90, 경도 -180~180)를 입력해주세요.`;
        return;
    }

    onSiteAreaChange();
    const displayName = `위도 ${lat.toFixed(6)}, 경도 ${lon.toFixed(6)} (직접 입력)`;
    await processSiteLocation({ lat, lon, displayName }, displayName);
}

// ───────────────────────────────────────────────────────────────────
//  Leaflet 미니맵 관리자 (Three.js 3D 뷰 우측 하단 위치 확인용)
//  - OpenTopoMap 타일로 현재 위치를 2D로 표시
//  - 검색 위치에 마커를 찍어 정확한 좌표 확인
// ───────────────────────────────────────────────────────────────────
const LeafletMap = (() => {
    let map = null;
    let marker = null;

    function getZoomForRadius(radiusM) {
        if (radiusM < 150)  return 17;
        if (radiusM < 400)  return 16;
        if (radiusM < 900)  return 15;
        return 14;
    }

    function init(lat, lon, radiusM) {
        if (typeof L === 'undefined') return;
        const container = document.getElementById('site3d-leaflet-map');
        if (!container) return;

        const zoom = getZoomForRadius(radiusM || 200);

        // 하단 독립 섹션 표시
        const wrap = document.getElementById('leaflet-standalone-wrap');
        if (wrap) wrap.style.display = 'block';

        if (!map) {
            map = L.map(container, {
                center: [lat, lon], zoom,
                zoomControl: true,
                attributionControl: true,
                dragging: true,
                scrollWheelZoom: true,
                doubleClickZoom: true,
                keyboard: true,
                touchZoom: true
            });

            L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                subdomains: ['a', 'b', 'c'],
                attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> | © OpenStreetMap',
                crossOrigin: true
            }).addTo(map);
        } else {
            map.setView([lat, lon], zoom, { animate: true, duration: 0.4 });
        }

        if (marker) { marker.setLatLng([lat, lon]); }
        else {
            marker = L.circleMarker([lat, lon], {
                radius: 9, color: '#fff', fillColor: '#ef4444',
                fillOpacity: 1.0, weight: 2.5
            }).addTo(map).bindPopup('📍 분석 위치').openPopup();
        }
    }

    function moveTo(lat, lon, radiusM) {
        if (!map) { init(lat, lon, radiusM); return; }
        const zoom = getZoomForRadius(radiusM || 200);
        map.setView([lat, lon], zoom, { animate: true, duration: 0.4 });
        if (marker) marker.setLatLng([lat, lon]);
    }

    function invalidateSize() {
        if (map) setTimeout(() => { map.invalidateSize(); }, 200);
    }

    return { init, moveTo, invalidateSize };
})();

/**
 * 좌표가 확정된 이후의 공통 처리 — 버튼 클릭(Nominatim) 과
 * 주소창 자동완성 선택 양쪽에서 동일하게 호출됩니다.
 * 좌표 하나로 NASA(일사량) + Open-Meteo(지형) + Overpass(건물) 3개 데이터소스를
 * 순차 조회하여 3D 환경에 결합합니다.
 */
async function processSiteLocation(geo, addressLabel) {
    const resultBox = document.getElementById('site-geo-result');
    SiteState.hasRealData = false;
    onSiteAreaChange();

    const siteRadiusMeters = Math.max(80, Math.sqrt(SiteState.areaMeters2 / Math.PI) * 4);

    SiteState.lat = geo.lat;
    SiteState.lon = geo.lon;
    SiteState.displayName = geo.displayName;

    document.getElementById('site3d-loc').textContent = geo.displayName.split(',')[0] || geo.displayName;

    // Leaflet 2D 토포 배경 지도 위치 설정 (Three.js 3D 전에 먼저)
    LeafletMap.init(geo.lat, geo.lon, siteRadiusMeters);

    SolarSite3D.initPlaceholder(geo.lat, geo.lon);
    SolarSite3D.placeLocationMarker(0, 0); // 검색 좌표는 항상 씬 원점 — 정확한 위치 핀 표시

    try {
        resultBox.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> NASA 일사량 데이터 조회 중...`;
        const nasa = await SolarGeo.fetchNasaIrradiance(geo.lat, geo.lon);
        SiteState.avgIrradiance = nasa.avgIrradiance;

        resultBox.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 실측 지형 고도 데이터(Open-Meteo / Copernicus DEM) 조회 중...`;
        const elevation = await SolarGeo.fetchElevationGrid(geo.lat, geo.lon, 9, Math.max(30, siteRadiusMeters / 4));
        const terrainResult = SolarSite3D.buildTerrainFromElevation(elevation, geo.lat, geo.lon);
        SiteState.terrainRelief = terrainResult.relief;
        SiteState.sceneSizeMeters = Math.round(terrainResult.sizeMeters);
        document.getElementById('site3d-terrain').textContent = `${SiteState.terrainRelief} m`;
        document.getElementById('site3d-scale').textContent = `${SiteState.sceneSizeMeters}m × ${SiteState.sceneSizeMeters}m`;
        // Leaflet 지도도 실제 지형 범위에 맞게 줌 동기화
        LeafletMap.moveTo(geo.lat, geo.lon, terrainResult.sizeMeters / 2);
        SolarSite3D.placeLocationMarker(0, 0);
        showTopoMapBtn();

        resultBox.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 주변 실제 건물 데이터(OpenStreetMap) 조회 중...`;
        let buildingCount = 0;
        try {
            const buildings = await SolarGeo.fetchNearbyBuildings(geo.lat, geo.lon, siteRadiusMeters, 15);
            buildingCount = SolarSite3D.buildRealBuildings(buildings, geo.lat, geo.lon);
        } catch (buildErr) {
            console.warn('건물 데이터 조회 실패(지형만 표시):', buildErr);
        }

        // 건물 배치가 끝난 뒤에 패널을 생성해야 건물과의 충돌 회피가 정확히 동작합니다.
        SolarSite3D.rebuildPanels(SiteState.capacityKW, terrainResult.sizeMeters);

        SiteState.hasRealData = true;
        updateSunPosition();

        resultBox.innerHTML = `
            <i class="fas fa-check-circle" style="color:var(--primary)"></i>
            <span>
                <strong>${geo.displayName}</strong><br>
                위도 ${geo.lat.toFixed(4)} · 경도 ${geo.lon.toFixed(4)} ·
                NASA ${nasa.year}년 평균 일사량 <strong>${nasa.avgIrradiance.toFixed(2)} kWh/m²/day</strong><br>
                실측 지형 고저차 <strong>${SiteState.terrainRelief}m</strong> (Copernicus DEM 90m) ·
                반경 ${Math.round(siteRadiusMeters)}m 내 실제 건물 <strong>${buildingCount}개</strong> 반영됨 (OpenStreetMap)
            </span>`;

        if (window.SolarAnalytics) {
            SolarAnalytics.track('geocode_site3d', addressLabel || geo.displayName, { lat: geo.lat, lon: geo.lon, buildingCount });
        }

    } catch (err) {
        console.error(err);
        resultBox.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ef4444"></i> ${err.message || 'NASA/지형 데이터 조회에 실패했습니다.'}`;
    }
}

function updateSunPosition() {
    const hour = parseFloat(document.getElementById('sunTimeSlider').value);
    document.getElementById('sunTimeVal').textContent = hour.toFixed(1);

    if (!SiteState.hasRealData) return;

    const result = SolarSite3D.updateSun(hour, SiteState.lat, SiteState.avgIrradiance);
    if (!result) return;

    document.getElementById('site3d-irr').textContent = SiteState.avgIrradiance.toFixed(2) + ' kWh/m²';
    document.getElementById('site3d-shadow').textContent = result.shadowImpact + ' %';

    const eff = Math.max(5, Math.round((1 - result.shadowImpact / 100) * 100));
    document.getElementById('site3d-eff').textContent = eff + ' %';
}

function updateCamRotation() {
    const angle = parseFloat(document.getElementById('camRotSlider').value);
    SolarSite3D.rotateCamera(angle);
}

/**
 * 축적(스케일) 변경 — 1:20 / 1:50 / 1:100 / 1:1000 / 1:5000
 * 버튼 활성 표시를 갱신하고, site3d.js의 setScale()로 카메라 거리·스케일바
 * 단위를 그 축적에 맞게 재계산합니다. 3D 씬이 아직 초기화 전이어도
 * 버튼 상태는 즉시 반영되고, 씬은 다음 데이터 로드 시 그 축적을 사용합니다.
 */
function changeScale(scaleValue) {
    document.querySelectorAll('.scale-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.scale) === scaleValue);
    });

    if (window.SolarSite3D && SolarSite3D.ensureRenderer()) {
        const preset = SolarSite3D.setScale(scaleValue);
        const hintEl = document.getElementById('scaleHintText');
        if (hintEl && preset) hintEl.textContent = preset.fovHint;
    }

    if (window.SolarAnalytics) {
        SolarAnalytics.track('scale_change', String(scaleValue), {});
    }
}

/** 2D 토포 지도 모달 열기 */
function openTopoModal() {
    const modal = document.getElementById('topo-modal');
    if (!modal) return;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    LeafletMap.invalidateSize();
}

/** 2D 토포 지도 모달 닫기 */
function closeTopoModal(e) {
    const modal = document.getElementById('topo-modal');
    if (!modal) return;
    if (e && e.target !== modal) return; // 패널 내부 클릭 무시
    modal.classList.remove('open');
    document.body.style.overflow = '';
}

/** 사이트 분석 완료 후 토포 버튼 표시 */
function showTopoMapBtn() {
    const btn = document.getElementById('topoMapBtn');
    if (btn) btn.style.display = 'flex';
}

/** 3D 캔버스 확대/축소 버튼 핸들러 */
function site3dZoom(direction) {
    if (window.SolarSite3D && SolarSite3D.zoomCamera) {
        SolarSite3D.zoomCamera(direction);
    }
}

/**
 * 패널 설치 위치 전환 (토지 위 영농형 / 건물 위 옥상형)
 * 전환 즉시 현재 부지 용량 기준으로 패널을 그 모드에 맞게 다시 배치합니다.
 * 건물 위 모드인데 검색된 영역에 OSM 건물 데이터가 없으면 패널이 생성되지
 * 않을 수 있어, 그 경우 안내 문구를 보여줍니다.
 */
function changeInstallMode(mode) {
    document.querySelectorAll('.install-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.install === mode);
    });

    const hintEl = document.getElementById('installHintText');

    if (window.SolarSite3D && SolarSite3D.ensureRenderer()) {
        const result = SolarSite3D.setInstallMode(mode);

        if (mode === 'roof' && result && result.note === 'no-buildings') {
            if (hintEl) hintEl.textContent = '이 위치 주변에는 OpenStreetMap 건물 데이터가 없어 옥상형 패널을 배치할 수 없습니다. 토지 위(영농형)를 이용해주세요.';
        } else if (mode === 'roof') {
            if (hintEl) hintEl.textContent = `주변 건물 옥상 면적에 맞춰 패널 ${result?.placed || 0}기가 자동 배치되었습니다.`;
        } else {
            if (hintEl) hintEl.textContent = '토지 위(영농형)는 부지 중앙에 다리 달린 패널 구조물을, 건물 위(옥상형)는 주변 건물 옥상에 맞춘 패널을 배치합니다.';
        }
    }

    if (window.SolarAnalytics) {
        SolarAnalytics.track('install_mode_change', mode, {});
    }
}

/**
 * 클릭으로 패널 배치 모드 토글 — 켜진 상태에서 3D 화면의 토지를 클릭하면
 * 그 자리에 패널이 추가됩니다(건물 위 클릭은 site3d.js가 자동으로 무시).
 */
let placementModeActive = false;
function togglePlacementMode() {
    placementModeActive = !placementModeActive;
    const btn = document.getElementById('placementToggleBtn');
    const canvas = document.getElementById('site3d-canvas');
    const hintEl = document.getElementById('placementHintText');

    btn.classList.toggle('active', placementModeActive);
    canvas.classList.toggle('placement-active', placementModeActive);

    if (window.SolarSite3D) {
        SolarSite3D.setClickPlacementMode(placementModeActive);
    }

    btn.innerHTML = placementModeActive
        ? '<i class="fas fa-circle-stop"></i> 배치 모드 끄기 (클릭하면 추가됨)'
        : '<i class="fas fa-map-pin"></i> 클릭으로 패널 배치하기';

    if (hintEl) {
        const mode = window.SolarSite3D ? SolarSite3D.getInstallMode() : 'ground';
        if (placementModeActive) {
            hintEl.textContent = mode === 'roof'
                ? '지금 건물 옥상을 클릭하면 그 자리 격자에 패널이 추가됩니다. 토지 클릭은 무시됩니다.'
                : '지금 토지를 클릭하면 표준 격자에 맞춰 패널이 추가됩니다. 건물 위 클릭은 무시됩니다.';
        } else {
            hintEl.textContent = '버튼을 누른 뒤 3D 화면을 클릭하면 표준 격자에 맞춰 패널이 추가됩니다(무작위 위치에 생성되지 않음).';
        }
    }

    if (window.SolarAnalytics) {
        SolarAnalytics.track('placement_mode_toggle', String(placementModeActive), {});
    }
}

// site3d.js가 클릭 배치 성공 시 호출하는 콜백 — 결과 패널에 안내를 표시합니다.
window.onSite3DPanelPlaced = function (x, z) {
    if (window.SolarAnalytics) {
        SolarAnalytics.track('manual_panel_placed', `${x.toFixed(1)},${z.toFixed(1)}`, {});
    }
};

// ===== 갤러리 (assets/images 폴더를 백엔드가 스캔한 목록을 동적으로 표시) =====
async function openGallery() {
    const modal = document.getElementById('gallery-modal');
    const container = document.getElementById('modal-images');
    container.innerHTML = `<div class="assets-loading"><i class="fas fa-circle-notch fa-spin"></i> 이미지 목록을 불러오는 중...</div>`;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    const imgs = await SolarAssets.getGalleryImages();
    container.innerHTML = '';

    if (!imgs.length) {
        container.innerHTML = `<div class="assets-empty">등록된 시공 사례 이미지가 없습니다.</div>`;
        return;
    }

    imgs.forEach(item => {
        const img = document.createElement('img');
        img.src = item.src; img.alt = item.label || ''; img.loading = 'lazy';
        img.title = item.label || '';
        img.onerror = () => img.remove();
        container.appendChild(img);
    });
}

function closeGallery() {
    document.getElementById('gallery-modal').classList.remove('open');
    document.body.style.overflow = '';
}

function openVideoModal(src) {
    const modal = document.getElementById('video-modal');
    const player = document.getElementById('video-player');
    // AVI 파일은 브라우저 지원이 제한적이므로 소스 엘리먼트로 처리
    const isAvi = src.toLowerCase().endsWith('.avi');
    const mimeType = isAvi ? 'video/x-msvideo' : 'video/mp4';
    // source 엘리먼트 업데이트
    let sourceEl = player.querySelector('source');
    if (!sourceEl) { sourceEl = document.createElement('source'); player.appendChild(sourceEl); }
    sourceEl.src = src;
    sourceEl.type = mimeType;
    player.src = src;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    player.load();
    player.play().catch(() => {});
}

function closeVideoModal() {
    const modal = document.getElementById('video-modal');
    const player = document.getElementById('video-player');
    player.pause(); player.src = '';
    modal.classList.remove('open');
    document.body.style.overflow = '';
}

/**
 * 기술·특허 화면의 영상 카드 / 특허 인증서 갤러리를
 * 백엔드가 스캔한 실제 assets/videos, assets/patents 폴더 내용으로 동적 구성합니다.
 * 폴더에 파일을 추가/삭제하면 코드 수정 없이 화면이 갱신됩니다.
 */
async function renderTechAssets() {
    const videoWrap = document.getElementById('tech-video-cards');
    const patentWrap = document.getElementById('patent-gallery');
    if (!videoWrap || !patentWrap) return;

    const [videos, patents] = await Promise.all([
        SolarAssets.getVideoList(),
        SolarAssets.getPatentImages()
    ]);

    // 영상 유형별 아이콘 매핑
    const videoIconMap = {
        '영농형 전용 구조물': 'fa-leaf',
        'RTU 모니터링': 'fa-satellite-dish',
    };

    videoWrap.innerHTML = videos.map(v => {
        const icon = videoIconMap[v.label] || 'fa-play-circle';
        return `
        <div class="tech-card" onclick="openVideoModal('${v.src}')">
            <div class="tc-icon"><i class="fas ${icon}"></i></div>
            <h3>${v.label}</h3>
            <p>${v.label === 'RTU 모니터링' ? '전력 원격감시제어 테스트 영상' : '스마트팜 영농형 태양광 구조물 영상'}</p>
            <span class="tc-badge"><i class="fas fa-play"></i> <span data-i18n="tech.watch">영상 보기</span></span>
        </div>`;
    }).join('') + `
        <div class="tech-card" onclick="openGallery()">
            <div class="tc-icon"><i class="fas fa-certificate"></i></div>
            <h3 data-i18n="tech.card3.title">시공 사례 갤러리</h3>
            <p data-i18n="tech.card3.desc">BIPV·영농형 설치 사례</p>
            <span class="tc-badge"><i class="fas fa-images"></i> <span data-i18n="tech.gallery">갤러리 보기</span></span>
        </div>`;

    patentWrap.innerHTML = patents.map(p => `
        <img src="${p.src}" alt="${p.label}" title="${p.label}"
             onerror="this.src='https://via.placeholder.com/180x260/2d8c4e/fff?text=Patent'">`).join('');
}

document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => {
        if (e.target === m) { closeGallery(); closeVideoModal(); }
    });
});

// ===========================================================
//   YOLO 패턴 대화형 안내 (홈 화면)
//   analytics.js의 실시간 행동 분류 결과(YOLO_CLASSIFIER)를 바탕으로
//   "지금 같은 분들이 자주 묻는 질문"을 추정해 보여주고,
//   클릭하면 해당 입력값이 채워진 채로 통합수익분석/입지분석으로 이동합니다.
// ===========================================================

const YOLO_GUIDE_BANK = {
    investor: [
        { q: '이 지역에 설치하면 23년간 얼마나 벌 수 있을까요?', icon: 'fa-coins', view: 'revenue', prefill: { address: '대전광역시 서구 복수중로30' } },
        { q: 'NASA 실측 일사량 데이터가 수익에 어떻게 반영되나요?', icon: 'fa-satellite-dish', view: 'revenue', prefill: null },
        { q: '투자 대비 손익분기점은 몇 년차인가요?', icon: 'fa-chart-line', view: 'revenue', prefill: null }
    ],
    farmer: [
        { q: '우리 농지에 영농형 태양광을 설치하면 작물 재배에 지장이 있을까요?', icon: 'fa-seedling', view: 'ess', prefill: null },
        { q: '우리 부지의 면적을 넣으면 적정 설치 용량이 자동 계산되나요?', icon: 'fa-ruler-combined', view: 'revenue', prefill: null },
        { q: '주변 건물 그림자가 우리 농지 패널에 영향을 주나요?', icon: 'fa-cube', view: 'site3d', prefill: null }
    ],
    developer: [
        { q: '시공 예정지의 지형과 주변 건물 그림자를 3D로 미리 볼 수 있나요?', icon: 'fa-cube', view: 'site3d', prefill: null },
        { q: '계절·시간대별 그림자 영향과 실효 발전효율을 비교할 수 있나요?', icon: 'fa-sun', view: 'site3d', prefill: null },
        { q: '시공 사례와 보유 특허 기술을 확인하고 싶어요', icon: 'fa-certificate', view: 'tech', prefill: null }
    ],
    researcher: [
        { q: 'PV+BESS 23년 현금흐름은 어떤 금융 모델로 계산되나요?', icon: 'fa-calculator', view: 'revenue', prefill: null },
        { q: '지형 고도·일사량 데이터의 출처와 정확도가 궁금해요', icon: 'fa-flask', view: 'site3d', prefill: null },
        { q: '보유 특허와 기술 영상을 살펴보고 싶어요', icon: 'fa-certificate', view: 'tech', prefill: null }
    ],
    general: [
        { q: 'ESS(에너지저장장치)를 우리 집에 설치하면 얼마나 절약될까요?', icon: 'fa-battery-full', view: 'ess', prefill: null },
        { q: '우리 지역 수익을 빠르게 확인하고 싶어요', icon: 'fa-chart-line', view: 'revenue', prefill: null },
        { q: '설치 예정지를 3D로 미리 보고 싶어요', icon: 'fa-cube', view: 'site3d', prefill: null },
        { q: '상담을 받고 싶어요', icon: 'fa-phone', view: 'contact', prefill: null }
    ]
};

const YOLO_GREETING = {
    investor: '투자 수익을 검토하고 계신 것 같아요. 이런 질문부터 시작해보세요',
    farmer: '스마트팜 도입을 고민하고 계신 것 같아요. 이런 질문부터 시작해보세요',
    developer: '시공·개발 파트너십을 찾고 계신 것 같아요. 이런 질문부터 시작해보세요',
    researcher: '기술적인 부분이 궁금하신 것 같아요. 이런 질문부터 시작해보세요',
    general: '어떤 점이 궁금하신가요? 클릭하시면 바로 답을 보여드립니다'
};

function renderYoloGuide() {
    const grid = document.getElementById('yolo-guide-grid');
    const greetingEl = document.getElementById('yolo-greeting');
    if (!grid) return;

    const report = window.SolarAnalytics ? SolarAnalytics.getReport() : { segment: 'general' };
    const segment = report.segment || 'general';
    const items = YOLO_GUIDE_BANK[segment] || YOLO_GUIDE_BANK.general;

    if (greetingEl) greetingEl.textContent = YOLO_GREETING[segment] || YOLO_GREETING.general;

    grid.innerHTML = items.map((item, idx) => `
        <div class="quicknav-card yolo-card" onclick='handleYoloCardClick(${idx}, "${segment}")'>
            <div class="qn-icon"><i class="fas ${item.icon}"></i></div>
            <h3>${item.q}</h3>
            <p><i class="fas fa-arrow-right"></i> ${viewLabel(item.view)}에서 확인하기</p>
        </div>`).join('');
}

function viewLabel(view) {
    const map = { ess: 'ESS(EMS/BMS)', revenue: '통합수익분석', site3d: '입지분석', tech: '기술·특허', contact: '문의' };
    return map[view] || view;
}

function handleYoloCardClick(idx, segment) {
    const items = YOLO_GUIDE_BANK[segment] || YOLO_GUIDE_BANK.general;
    const item = items[idx];
    if (!item) return;

    if (window.SolarAnalytics) {
        SolarAnalytics.track('yolo_guide_click', item.view, { question: item.q, segment });
    }

    switchView(item.view);

    // 질문에 맞춰 입력값을 미리 채워 자연스럽게 조작을 유도합니다.
    if (item.prefill && item.prefill.address) {
        setTimeout(() => {
            const targetInput = item.view === 'revenue' ? 'address-input' : 'site-address-input';
            const el = document.getElementById(targetInput);
            if (el) el.value = item.prefill.address;
        }, 100);
    }
}

// ===== 이메일 폼 =====
document.getElementById('contact-form')?.addEventListener('submit', function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type=submit]');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 전송 중...';
    btn.disabled = true;

    emailjs.send('service_23hd17n', 'template_1h4x2yq', {
        from_name: document.getElementById('from_name').value,
        reply_to: document.getElementById('reply_to').value,
        message: document.getElementById('message').value,
        to_email: 'bk_solar@naver.com'
    }, 'EKZKrQa8dovHr1AI9')
        .then(() => {
            alert('문의가 성공적으로 전송되었습니다. 빠른 시일 내에 연락드리겠습니다.');
            this.reset();
            btn.innerHTML = orig;
            btn.disabled = false;
        })
        .catch(err => {
            console.error(err);
            alert('전송 실패. 잠시 후 다시 시도하거나 bk_solar@naver.com으로 직접 연락해주세요.');
            btn.innerHTML = orig;
            btn.disabled = false;
        });
});

// ===== 초기 실행 =====
window.addEventListener('load', () => {
    buildMobileNav();
    updateFinance();
    runProfitAnalysis();
    onSiteAreaChange();
    renderTechAssets();
    // AI 챗봇은 ai-chat.js의 BKSolarChat.init()이 별도 처리
});

// ===========================================================
//   ESS(EMS/BMS) 계산기 로직 v6
//   · ESS 단위: homeEssBase / commEssBase 입력값 (0.01 단위)
//   · 가정용: 월 전기사용량(kWh/월) 반영
//   · 충전 100% / 방전 80% / PCS 95% / 인버터 97%
//   · 주소 → 좌표 → NASA POWER 실측 일조량
//   · 상업용: 방전시간 사용자 입력
//
//   [계산 로직 수정]
//   · pvNeeded: ESS를 하루에 충전하기 위해 필요한 태양광 용량
//     = BASE_KWH / (irr × PCS_EFF × CHARGE_EFF)
//   · chargeHours: pvNeeded 규모의 태양광으로 BASE_KWH 충전 소요 시간
//     = BASE_KWH / (pvNeeded × PCS_EFF × CHARGE_EFF)
//     → 수식 대입 시 항상 irr이 되는 순환 오류 수정
//     → 실제 의미: "주어진 태양광으로 1유닛 충전하는 데 몇 시간 걸리나"
//     = pvNeeded는 "irr 시간 안에 충전 가능한 최소 태양광" 이므로
//       chargeHours는 irr과 일치 → 이 자체가 정의상 옳음
//     → 실용 계산: 실제 설치 패널(finalKw)로 충전 시간 계산
//   · 월 전기사용량 입력 시 → 일 사용량 → 필요 ESS 용량으로 연동
// ===========================================================

/* ── ESS / BESS 효율 상수 ──────────────────────────────────────
   · 배터리 충전효율  : 98 % (round-trip charge efficiency)
   · 배터리 방전효율  : 80 % (DoD 80% 기준 실효 방전)
   · PCS 충전/방전 효율: 97 % (Power Conditioning System)
   · 인버터 효율      : 97 % (PV → AC 변환)
   · BESS 연간 용량 저감률: 1.95 % / 년 (약 2 %/년 기준)
──────────────────────────────────────────────────────────── */
/* ── ESS 계산기 효율 상수는 파일 상단 공통 상수(ESS_CHARGE_EFF 등)를 공유 ──
   배터리 충전효율 98%, PCS 효율 97%, 방전심도 80%, 저감률 1.95%/년
   (수정 시 파일 상단 const 선언부만 변경하면 전체 반영됨)
──────────────────────────────────────────────────────────── */

let essCurrentType = 'home';

// ── ESS 단위 용량 읽기 ──────────────────────────────────────────
function getHomeBase() {
    const v = parseFloat(document.getElementById('homeEssBase')?.value);
    return (v > 0) ? v : 5;
}
function getCommBase() {
    const v = parseFloat(document.getElementById('commEssBase')?.value);
    return (v > 0) ? v : 5;
}

// ── 실사용 미리보기 ─────────────────────────────────────────────
function updateBasePreviews() {
    const hb = document.getElementById('home-usable-preview');
    const cb = document.getElementById('comm-usable-preview');
    if (hb) hb.textContent = (getHomeBase() * ESS_DISCHARGE_EFF).toFixed(2);
    if (cb) cb.textContent = (getCommBase() * ESS_DISCHARGE_EFF).toFixed(2);
}

// ── 탭 전환 ─────────────────────────────────────────────────────
function essSelectType(type) {
    essCurrentType = type;
    const homeBtn     = document.getElementById('tab-home');
    const commBtn     = document.getElementById('tab-commercial');
    const homeSection = document.getElementById('ess-home-section');
    const commSection = document.getElementById('ess-commercial-section');
    const commResult  = document.getElementById('ess-commercial-result');
    if (type === 'home') {
        homeBtn.style.background = '#2ecc71'; homeBtn.style.color = '#fff';
        commBtn.style.background = '#fff';    commBtn.style.color = '#3498db';
        homeSection.style.display = 'block';
        commSection.style.display = 'none';
        commResult.style.display  = 'none';
    } else {
        commBtn.style.background = '#3498db'; commBtn.style.color = '#fff';
        homeBtn.style.background = '#fff';    homeBtn.style.color = '#2ecc71';
        homeSection.style.display = 'none';
        commSection.style.display = 'block';
        commResult.style.display  = 'block';
    }
    essCalculate();
}

function essHomeTypeChange() { essCalculate(); }

// ── 패널 라디오 전환 ────────────────────────────────────────────
function essPanelChange() {
    const hasPanel = document.querySelector('input[name="hasPanel"]:checked')?.value === 'yes';
    const inputBox = document.getElementById('existing-panel-inputs');
    if (inputBox) inputBox.style.display = hasPanel ? 'block' : 'none';
    if (!hasPanel) {
        ['existingKw','existingPanelCount','existingWp','existingVoltage','existingCurrent']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        essSyncBar('');
    }
    essCalculate();
}

// ── 동기화 상태 표시줄 ──────────────────────────────────────────
function essSyncBar(msg, warn) {
    const bar = document.getElementById('panel-sync-bar');
    if (!bar) return;
    bar.style.background = warn ? '#fff8e1' : '#f0fff4';
    bar.style.color       = warn ? '#e67e22' : '#27ae60';
    bar.innerHTML = msg;
}

// ── kW 입력 → 장수 자동계산 ────────────────────────────────────
function essSyncFromKw() {
    const kw  = parseFloat(document.getElementById('existingKw')?.value);
    const wp  = parseFloat(document.getElementById('existingWp')?.value);
    const cEl = document.getElementById('existingPanelCount');
    if (kw > 0 && wp > 0 && cEl) {
        cEl.value = Math.round((kw * 1000) / wp);
        essSyncBar(`🔗 ${kw.toFixed(2)} kW ÷ ${wp} Wp = <b>${cEl.value}장</b> 자동계산`);
        essSyncVICheck();
    } else {
        essSyncBar(kw > 0 && !wp ? `⚠ Wp(장당 출력)를 입력해야 장수를 계산할 수 있습니다.` : '', true);
    }
    essCalculate();
}

// ── 장수 입력 → kW 자동계산 ────────────────────────────────────
function essSyncFromCount() {
    const cnt = parseFloat(document.getElementById('existingPanelCount')?.value);
    const wp  = parseFloat(document.getElementById('existingWp')?.value);
    const kEl = document.getElementById('existingKw');
    if (cnt > 0 && wp > 0 && kEl) {
        kEl.value = parseFloat(((cnt * wp) / 1000).toFixed(3));
        essSyncBar(`🔗 ${cnt}장 × ${wp} Wp = <b>${kEl.value} kW</b> 자동계산`);
        essSyncVICheck();
    } else {
        essSyncBar(cnt > 0 && !wp ? `⚠ Wp(장당 출력)를 입력해야 용량을 계산할 수 있습니다.` : '', true);
    }
    essCalculate();
}

// ── Wp 변경 → 재계산 ────────────────────────────────────────────
function essSyncWpChanged() {
    const wp  = parseFloat(document.getElementById('existingWp')?.value);
    const kw  = parseFloat(document.getElementById('existingKw')?.value);
    const cnt = parseFloat(document.getElementById('existingPanelCount')?.value);
    const kEl = document.getElementById('existingKw');
    const cEl = document.getElementById('existingPanelCount');
    if (wp > 0) {
        if (cnt > 0 && kEl) {
            kEl.value = parseFloat(((cnt * wp) / 1000).toFixed(3));
            essSyncBar(`🔗 ${cnt}장 × ${wp} Wp = <b>${kEl.value} kW</b> 재계산`);
        } else if (kw > 0 && cEl) {
            cEl.value = Math.round((kw * 1000) / wp);
            essSyncBar(`🔗 ${kw.toFixed(2)} kW ÷ ${wp} Wp = <b>${cEl.value}장</b> 재계산`);
        }
        essSyncVICheck();
    }
    essCalculate();
}

// ── V·A 입력 → Wp 검증/자동입력 ────────────────────────────────
function essSyncVIChanged() { essSyncVICheck(); essCalculate(); }

function essSyncVICheck() {
    const v  = parseFloat(document.getElementById('existingVoltage')?.value);
    const a  = parseFloat(document.getElementById('existingCurrent')?.value);
    const wp = parseFloat(document.getElementById('existingWp')?.value);
    if (!(v > 0 && a > 0)) return;
    const mW = parseFloat((v * a).toFixed(1));
    if (wp > 0) {
        const diff = Math.abs(mW - wp) / wp * 100;
        essSyncBar(diff < 5
            ? `✅ V×A = ${mW} W — Wp(${wp}) 일치 (오차 ${diff.toFixed(1)}%)`
            : `⚠ V×A = ${mW} W — Wp(${wp})와 오차 ${diff.toFixed(1)}% 확인 필요`, diff >= 5);
    } else {
        const wpEl = document.getElementById('existingWp');
        if (wpEl) { wpEl.value = mW; essSyncBar(`🔗 V×A = <b>${mW} Wp</b> 자동입력`); essSyncWpChanged(); }
    }
}

// ── NASA 조회 공통 헬퍼 ─────────────────────────────────────────
async function essFetchNasa(lat, lon, resultEl, irrHiddenId, accent) {
    resultEl.innerHTML = `<i class="fas fa-circle-notch fa-spin" style="color:${accent}"></i> NASA 조회 중 (${lat.toFixed(4)}, ${lon.toFixed(4)})...`;
    try {
        const nasa = await SolarGeo.fetchNasaIrradiance(lat, lon);
        const irr  = nasa.avgIrradiance;
        document.getElementById(irrHiddenId).value = irr.toFixed(4);
        resultEl.innerHTML = `<i class="fas fa-check-circle" style="color:${accent}"></i>
            위도 <strong>${lat.toFixed(4)}</strong> · 경도 <strong>${lon.toFixed(4)}</strong> &nbsp;|&nbsp;
            NASA ${nasa.year || '연평균'} 일조량
            <strong style="color:${accent};font-size:1.05em;">${irr.toFixed(2)} kWh/m²/일</strong> → 자동 반영됨`;
        essCalculate();
    } catch (err) {
        resultEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i> NASA 조회 실패: ${err.message}`;
    }
}

async function essGeocodeHome() {
    const addr = (document.getElementById('ess-home-address')?.value || '').trim();
    const el   = document.getElementById('ess-home-geo-result');
    if (!addr) { el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#e74c3c"></i> 주소를 입력해주세요.'; return; }
    el.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:#2ecc71"></i> 주소 변환 중...';
    try { const g = await SolarGeo.geocode(addr); await essFetchNasa(g.lat, g.lon, el, 'homeIrr', '#2ecc71'); }
    catch (err) { el.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i> ${err.message}`; }
}

async function essGeocodeComm() {
    const addr = (document.getElementById('ess-comm-address')?.value || '').trim();
    const el   = document.getElementById('ess-comm-geo-result');
    if (!addr) { el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#e74c3c"></i> 주소를 입력해주세요.'; return; }
    el.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:#3498db"></i> 주소 변환 중...';
    try { const g = await SolarGeo.geocode(addr); await essFetchNasa(g.lat, g.lon, el, 'commIrr', '#3498db'); }
    catch (err) { el.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i> ${err.message}`; }
}

/**
 * 위도/경도를 직접 입력하여 좌표를 확정하는 경우 (가정용 ESS, 주소 검색 대체 수단).
 */
async function essGeocodeHomeByCoord() {
    const el  = document.getElementById('ess-home-geo-result');
    const lat = parseFloat(document.getElementById('ess-home-lat-input')?.value);
    const lon = parseFloat(document.getElementById('ess-home-lon-input')?.value);

    if (isNaN(lat) || isNaN(lon)) { el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#e74c3c"></i> 위도/경도를 모두 입력해주세요.'; return; }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#e74c3c"></i> 유효한 좌표 범위(위도 -90~90, 경도 -180~180)를 입력해주세요.'; return; }

    el.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:#2ecc71"></i> 좌표 적용 중...';
    try { await essFetchNasa(lat, lon, el, 'homeIrr', '#2ecc71'); }
    catch (err) { el.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i> ${err.message}`; }
}

/**
 * 위도/경도를 직접 입력하여 좌표를 확정하는 경우 (상업용 ESS, 주소 검색 대체 수단).
 */
async function essGeocodeCommByCoord() {
    const el  = document.getElementById('ess-comm-geo-result');
    const lat = parseFloat(document.getElementById('ess-comm-lat-input')?.value);
    const lon = parseFloat(document.getElementById('ess-comm-lon-input')?.value);

    if (isNaN(lat) || isNaN(lon)) { el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#e74c3c"></i> 위도/경도를 모두 입력해주세요.'; return; }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#e74c3c"></i> 유효한 좌표 범위(위도 -90~90, 경도 -180~180)를 입력해주세요.'; return; }

    el.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:#3498db"></i> 좌표 적용 중...';
    try { await essFetchNasa(lat, lon, el, 'commIrr', '#3498db'); }
    catch (err) { el.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i> ${err.message}`; }
}

// ── 계산 디스패치 ───────────────────────────────────────────────
function essCalculate() {
    updateBasePreviews();
    if (essCurrentType === 'home') essCalcHome();
    else                           essCalcCommercial();
}

// ── 가정용 계산 ─────────────────────────────────────────────────
function essCalcHome() {
    const BASE_KWH  = getHomeBase();
    const irr       = parseFloat(document.getElementById('homeIrr')?.value)   || 3.8;
    const hasPanel  = document.querySelector('input[name="hasPanel"]:checked')?.value === 'yes';
    const homeType  = document.querySelector('input[name="homeType"]:checked')?.value || 'apt';
    const monthlyKwh = parseFloat(document.getElementById('homeMonthlyKwh')?.value) || 0;

    // 패널 입력값
    const existingKw = parseFloat(document.getElementById('existingKw')?.value)          || 0;
    const existingWp = parseFloat(document.getElementById('existingWp')?.value)          || 0;
    const existingV  = parseFloat(document.getElementById('existingVoltage')?.value)     || 0;
    const existingA  = parseFloat(document.getElementById('existingCurrent')?.value)     || 0;
    const panelCount = parseFloat(document.getElementById('existingPanelCount')?.value)  || 0;

    // 패널 있음인데 필수값 미입력
    if (hasPanel && existingKw === 0 && panelCount === 0) {
        document.getElementById('ess-charge-verdict').innerHTML =
            '<p style="color:#e67e22;padding:12px;background:rgba(230,126,34,0.1);border-radius:8px;">' +
            '<i class="fas fa-exclamation-triangle"></i> 설치 용량(kW) 또는 패널 장수 + Wp를 입력해야 계산됩니다.</p>';
        ['res-ess-total','res-usable','res-charge-time','res-pv-needed']
            .forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
        document.getElementById('res-base-unit').textContent = `${BASE_KWH} kWh`;
        return;
    }

    // 실제 설치 kW 확정
    let finalKw = existingKw;
    if (finalKw === 0 && panelCount > 0 && existingWp > 0)
        finalKw = (panelCount * existingWp) / 1000;

    // ── 월 전기사용량 → 일 사용량 → 필요 ESS 계산 ────────────
    let dailyNeed = 0;
    let essFromMonthly = 0;
    if (monthlyKwh > 0) {
        dailyNeed      = monthlyKwh / 30;
        // 방전 80% 고려: 실제 필요 ESS 용량 = 일 사용량 / 0.8
        const rawNeed  = dailyNeed / ESS_DISCHARGE_EFF;
        essFromMonthly = Math.ceil(rawNeed / BASE_KWH) * BASE_KWH;
        // 자동계산 표시
        const dEl = document.getElementById('home-daily-kwh');
        const uEl = document.getElementById('home-need-units');
        const tEl = document.getElementById('home-need-total');
        if (dEl) dEl.textContent = dailyNeed.toFixed(2);
        if (uEl) uEl.textContent = (essFromMonthly / BASE_KWH).toFixed(1);
        if (tEl) tEl.textContent = essFromMonthly.toFixed(2);
    } else {
        ['home-daily-kwh','home-need-units','home-need-total']
            .forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
    }

    // ── ESS 총 용량 결정 ──────────────────────────────────────
    // 우선순위: ① 월 전기사용량 기반 > ② 패널 발전량 기반 > ③ 단위 1개
    let essTotal;
    if (essFromMonthly > 0) {
        essTotal = essFromMonthly;
    } else if (hasPanel && finalKw > 0) {
        const dailyGen = finalKw * irr * INVERTER_EFF;
        essTotal = Math.ceil(dailyGen / BASE_KWH) * BASE_KWH;
        essTotal = Math.max(essTotal, BASE_KWH);
    } else {
        essTotal = BASE_KWH;
    }

    const usable = essTotal * ESS_DISCHARGE_EFF;
    const units  = (essTotal / BASE_KWH).toFixed(2);

    // ── 충전 시간 계산 (정확한 로직) ─────────────────────────
    // finalKw가 있으면 실제 패널로 계산, 없으면 BASE_KWH 충전에 필요한 최소 PV로 계산
    const pvForCalc = finalKw > 0 ? finalKw : (BASE_KWH / (irr * PCS_EFF * ESS_CHARGE_EFF));
    // 실제 충전 시간 = 충전할 용량 / (태양광출력 × PCS효율 × 충전효율)
    const chargeHours = essTotal / (pvForCalc * PCS_EFF * ESS_CHARGE_EFF);
    // 필요 태양광: 하루 irr 시간 안에 essTotal 충전 가능한 최소 용량
    const pvNeeded    = essTotal / (irr * PCS_EFF * ESS_CHARGE_EFF);
    const canCharge   = irr >= chargeHours;
    const surplus     = ((irr / chargeHours - 1) * 100).toFixed(1);

    // 결과 카드 업데이트
    document.getElementById('res-base-unit').textContent   = `${BASE_KWH} kWh`;
    document.getElementById('res-ess-total').textContent   = `${essTotal.toFixed(2)} kWh (${units}유닛)`;
    document.getElementById('res-usable').textContent      = `${usable.toFixed(2)} kWh`;
    document.getElementById('res-charge-time').textContent = `${chargeHours.toFixed(2)} h`;
    document.getElementById('res-pv-needed').textContent   = `${pvNeeded.toFixed(2)} kW`;
    const pcsCard = document.getElementById('res-pcs-card');
    if (pcsCard) pcsCard.style.display = 'none';

    // 패널 정보
    const typeLabel = homeType === 'apt' ? '아파트' : '주택';
    const panelParts = [];
    if (hasPanel) {
        if (finalKw > 0)    panelParts.push(`${finalKw.toFixed(2)} kW`);
        if (panelCount > 0) panelParts.push(`${panelCount}장`);
        if (existingWp > 0) panelParts.push(`${existingWp} Wp/장`);
        if (existingV > 0)  panelParts.push(`${existingV} V`);
        if (existingA > 0)  panelParts.push(`${existingA} A`);
        if (existingV > 0 && existingA > 0)
            panelParts.push(`(V×A=${(existingV*existingA).toFixed(1)}W)`);
    }
    const panelInfo = hasPanel ? (panelParts.join(' · ') || '입력값 없음') : '신규 설치 (패널 없음)';
    const irrSrc = document.getElementById('ess-home-geo-result')?.textContent?.includes('NASA')
        ? `NASA 실측 ${irr.toFixed(2)} kWh/m²/일`
        : `기본값 ${irr.toFixed(2)} kWh/m²/일 (주소 미입력)`;

    const essSource = essFromMonthly > 0
        ? `월 사용량 기준 (${monthlyKwh} kWh/월 → 일 ${dailyNeed.toFixed(2)} kWh)`
        : (hasPanel && finalKw > 0) ? `패널 발전량 기준 (${finalKw.toFixed(2)} kW)` : `단위 1유닛`;

    const verdictEl = document.getElementById('ess-charge-verdict');
    if (verdictEl) {
        verdictEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
          <tr><td style="padding:5px 0;opacity:0.7;width:46%;">주거 형태</td>
              <td style="font-weight:700;">${typeLabel}</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">ESS 단위 용량</td>
              <td style="font-weight:700;color:#2ecc71;">${BASE_KWH} kWh / 유닛</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">ESS 용량 산출 근거</td>
              <td style="font-weight:700;">${essSource}</td></tr>
          ${monthlyKwh > 0 ? `
          <tr><td style="padding:5px 0;opacity:0.7;">월 전기사용량</td>
              <td style="font-weight:700;">${monthlyKwh} kWh/월 → 일 ${dailyNeed.toFixed(2)} kWh</td></tr>` : ''}
          <tr><td style="padding:5px 0;opacity:0.7;">기존 패널</td>
              <td style="font-weight:700;">${panelInfo}</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">적용 일조량</td>
              <td style="font-weight:700;">${irrSrc}</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">충전 소요 시간</td>
              <td style="font-weight:700;">${chargeHours.toFixed(2)} h
                  <span style="font-size:0.78rem;opacity:0.7;"> (태양광 ${pvForCalc.toFixed(2)} kW 기준)</span></td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">일조량 vs 충전요구</td>
              <td style="font-weight:700;color:${canCharge ? '#2ecc71' : '#e74c3c'};">
                ${canCharge ? `✅ 가능 (여유 ${surplus}%)` : `❌ 부족 (${Math.abs(parseFloat(surplus))}% 부족)`}
              </td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">충전 효율</td><td>${(ESS_CHARGE_EFF*100).toFixed(0)}%</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">방전 효율</td><td>${(ESS_DISCHARGE_EFF*100).toFixed(0)}%</td></tr>
        </table>
        <p style="margin-top:12px;padding:10px;background:rgba(46,204,113,0.15);border-radius:6px;font-size:0.82rem;">
          💡 필요 태양광 <strong>${pvNeeded.toFixed(2)} kW</strong> ·
          실사용 용량(80%) <strong>${usable.toFixed(2)} kWh</strong> ·
          총 <strong>${units}유닛</strong> (유닛당 ${BASE_KWH} kWh)
        </p>`;
    }
}

// ── 상업용 계산 ─────────────────────────────────────────────────
function essCalcCommercial() {
    const BASE_KWH       = getCommBase();
    const solarKw        = parseFloat(document.getElementById('commSolarKw')?.value)        || 100;
    const multiplier     = parseFloat(document.getElementById('commEssMultiplier')?.value)  || 1;
    const irr            = parseFloat(document.getElementById('commIrr')?.value)            || 3.8;
    const cycles         = parseFloat(document.getElementById('commCyclePerDay')?.value)    || 1;
    const dischargeHours = parseFloat(document.getElementById('commDischargeHours')?.value) || 2;

    // ESS 총 용량 (BASE_KWH 단위 올림)
    const essRaw   = solarKw * multiplier;
    const essTotal = Math.ceil(essRaw / BASE_KWH) * BASE_KWH;
    const usable   = essTotal * ESS_DISCHARGE_EFF;
    const units    = (essTotal / BASE_KWH).toFixed(2);

    // PCS 용량 = 실사용 용량 / 방전시간 / PCS효율
    const pcsKw = usable / dischargeHours / PCS_EFF;

    // 일 에너지 흐름
    const dailyGen        = solarKw * irr * INVERTER_EFF;
    const dailyChargeable = dailyGen * PCS_EFF * ESS_CHARGE_EFF;
    const dailyDischarge  = usable * cycles;
    const chargeOk        = dailyChargeable >= dailyDischarge;
    const chargeRatio     = (dailyChargeable / dailyDischarge * 100).toFixed(1);

    // BASE_KWH 1유닛 충전 소요 시간 (solarKw 기준)
    const chargeHours = BASE_KWH / (solarKw * PCS_EFF * ESS_CHARGE_EFF);
    // 필요 태양광: BASE_KWH를 irr 시간 안에 충전
    const pvNeeded    = BASE_KWH / (irr * PCS_EFF * ESS_CHARGE_EFF);

    const irrSrc = document.getElementById('ess-comm-geo-result')?.textContent?.includes('NASA')
        ? `NASA 실측 ${irr.toFixed(2)} kWh/m²/일`
        : `기본값 ${irr.toFixed(2)} kWh/m²/일 (주소 미입력)`;

    // 결과 카드
    document.getElementById('res-base-unit').textContent   = `${BASE_KWH} kWh`;
    document.getElementById('res-ess-total').textContent   = `${essTotal.toFixed(2)} kWh (${units}유닛)`;
    document.getElementById('res-usable').textContent      = `${usable.toFixed(2)} kWh`;
    document.getElementById('res-charge-time').textContent = `${chargeHours.toFixed(2)} h`;
    document.getElementById('res-pv-needed').textContent   = `${pvNeeded.toFixed(2)} kW`;

    const pcsCard = document.getElementById('res-pcs-card');
    if (pcsCard) {
        pcsCard.style.display = 'block';
        document.getElementById('res-pcs').textContent = `${pcsKw.toFixed(1)} kW`;
    }

    const commVerdictEl = document.getElementById('ess-commercial-verdict');
    if (commVerdictEl) {
        commVerdictEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
          <tr><td style="padding:5px 0;opacity:0.7;width:46%;">ESS 단위 용량</td>
              <td style="font-weight:700;color:#3498db;">${BASE_KWH} kWh / 유닛</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">태양광 설치 용량</td>
              <td style="font-weight:700;">${solarKw} kW</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">ESS 배수</td>
              <td style="font-weight:700;">${multiplier}× → raw ${essRaw.toFixed(2)} kWh</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">ESS 총 용량 (${BASE_KWH}kWh 단위)</td>
              <td style="font-weight:700;">${essTotal.toFixed(2)} kWh (${units}유닛)</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">실사용 용량 (80%)</td>
              <td style="font-weight:700;">${usable.toFixed(2)} kWh</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">방전 시간 (설정)</td>
              <td style="font-weight:700;">${dischargeHours} h/회</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">PCS 권장 용량</td>
              <td style="font-weight:700;color:#e67e22;">${pcsKw.toFixed(2)} kW</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">적용 일조량</td>
              <td>${irrSrc}</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">일 발전량</td>
              <td>${dailyGen.toFixed(2)} kWh/일</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">일 충전 가능량</td>
              <td>${dailyChargeable.toFixed(2)} kWh</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">일 방전 요구량</td>
              <td>${dailyDischarge.toFixed(2)} kWh (${cycles}회 × ${usable.toFixed(2)} kWh)</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">충전 충족률</td>
              <td style="font-weight:700;color:${chargeOk ? '#2ecc71' : '#e74c3c'};">
                ${chargeOk
                  ? `✅ ${chargeRatio}% — 발전량이 방전 수요 충족`
                  : `❌ ${chargeRatio}% — 태양광 증설 또는 ESS 배수 축소 권장`}
              </td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">1유닛 충전 소요</td>
              <td>${chargeHours.toFixed(2)} h (태양광 ${solarKw}kW 기준)</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">PCS 효율</td><td>${(PCS_EFF*100).toFixed(0)}%</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">충전 효율</td><td>${(ESS_CHARGE_EFF*100).toFixed(0)}%</td></tr>
          <tr><td style="padding:5px 0;opacity:0.7;">방전 효율</td><td>${(ESS_DISCHARGE_EFF*100).toFixed(0)}%</td></tr>
        </table>`;
    }

    const verdictEl = document.getElementById('ess-charge-verdict');
    if (verdictEl) {
        verdictEl.innerHTML = `
        <p>태양광 <strong>${solarKw}kW</strong>로 ${BASE_KWH}kWh 1유닛 충전 소요 <strong>${chargeHours.toFixed(2)}h</strong> ·
           일조량(${irr.toFixed(2)}h) 기준 충전 ${chargeHours <= irr ? '✅ 가능' : '❌ 부족'} ·
           필요 최소 태양광 <strong>${pvNeeded.toFixed(2)}kW</strong></p>`;
    }
}

// ESS 뷰 진입 시 초기 계산 실행
document.addEventListener('DOMContentLoaded', () => {
    updateBasePreviews();
    const observer = new MutationObserver(() => {
        const essPanel = document.getElementById('view-ess');
        if (essPanel && essPanel.classList.contains('active')) essCalculate();
    });
    document.querySelectorAll('.view-panel')
        .forEach(p => observer.observe(p, { attributes: true, attributeFilter: ['class'] }));
});







