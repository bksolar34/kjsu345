/* ===========================
   부광솔라 통합 메인 JS v4.0
   - 5개 독립 뷰 스위치 구조 (회사소개/통합수익분석/입지분석/기술특허/문의)
   - 주소 지오코딩 → 좌표 → NASA 1년치 일사량 → 23년 수익분석 직접 대입
   - 입지분석: 주소+면적 → 좌표 → 지형/건물/일사량 결합 3D
   =========================== */

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
    const invest = parseFloat(document.getElementById('bessInvest').value) || 0;
    const rate = parseFloat(document.getElementById('bessEquityRate').value) || 0;
    document.getElementById('bessEquityAmount').value = Math.round(invest * (rate / 100));
    updateFinance();
}

function updateFinance() {
    const pvInv = parseFloat(document.getElementById('pvInvest').value) || 0;
    const bessInv = parseFloat(document.getElementById('bessInvest').value) || 0;
    document.getElementById('totalInvest').value = pvInv + bessInv;

    const pvRate = parseFloat(document.getElementById('pvEquityRate').value) || 0;
    const bessRate = parseFloat(document.getElementById('bessEquityRate').value) || 0;
    document.getElementById('pvEquityAmount').value = Math.round(pvInv * (pvRate / 100));
    document.getElementById('bessEquityAmount').value = Math.round(bessInv * (bessRate / 100));
}

function runProfitAnalysis() {
    const pvCap = parseFloat(document.getElementById('pvCap').value) || 3300;
    const genTime = parseFloat(document.getElementById('genTime').value) || 3.4;
    const smp = parseFloat(document.getElementById('smpPrice').value) || 100;
    const rec = (parseFloat(document.getElementById('recPrice').value) || 75000) / 1000;
    const weight = parseFloat(document.getElementById('recWeight').value) || 1.542;
    const cdm = parseFloat(document.getElementById('cdmPrice').value) || 12.55;

    const pvInv = parseFloat(document.getElementById('pvInvest').value) || 3300;
    const bessInv = parseFloat(document.getElementById('bessInvest').value) || 2000;
    const pvEqRate = parseFloat(document.getElementById('pvEquityRate').value) || 10;
    const bessEqRate = parseFloat(document.getElementById('bessEquityRate').value) || 10;
    const interestRate = (parseFloat(document.getElementById('interestRate').value) || 5.5) / 100;
    const taxRate = (parseFloat(document.getElementById('taxRate').value) || 10) / 100;
    const term = parseInt(document.getElementById('loanTerm').value) || 23;

    const pvEq = pvInv * (pvEqRate / 100) * 1e6;
    const bessEq = bessInv * (bessEqRate / 100) * 1e6;
    const totalInvest = (pvInv + bessInv) * 1e6;
    const totalEquity = pvEq + bessEq;
    const loanPrincipal = totalInvest - totalEquity;
    const annualPrincipal = term > 0 ? loanPrincipal / term : 0;

    profitData = [];

    let cumSum = -totalEquity;
    let remainLoan = loanPrincipal;

    for (let i = 1; i <= term; i++) {
        const annualGen = pvCap * genTime * 365 * Math.pow(0.993, i - 1);
        const revenue = annualGen * (smp + (rec * weight) + cdm);
        const opex = (revenue * 0.015) + (50000000 / term);
        const interest = remainLoan > 0 ? remainLoan * interestRate : 0;
        const ebt = revenue - opex - interest;
        const tax = ebt > 0 ? ebt * taxRate : 0;
        const netProfit = ebt - tax;
        const repayment = annualPrincipal;
        const cashFlow = netProfit - repayment;

        remainLoan -= repayment;
        cumSum += cashFlow;

        profitData.push({ i, revenue, opex, interest, ebt, tax, netProfit, repayment, cashFlow, cumSum });
    }

    // 계산은 항상 원화 기준(위 루프)으로 끝내고, 표시(테이블/차트)는
    // 현재 선택된 통화에 맞춰 별도 함수에서 일관되게 그립니다.
    rerenderProfitTable();

    if (window.SolarAnalytics) {
        SolarAnalytics.track('profit_analysis', { pvCap, term, totalInvest: pvInv + bessInv, nasaApplied: RevenueState.avgIrradiance !== null });
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

    if (currency === 'USD') {
        if (hintEl) hintEl.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 실시간 환율 조회 중...`;
        const rate = await SolarCurrency.getKrwPerUsd();
        if (unitHead) unitHead.textContent = ' ($)';
        if (hintEl) hintEl.textContent = `모든 입력값과 계산은 원화 기준으로 수행되며, 결과만 달러로 환산해 표시됩니다. (현재 환율 1USD ≈ ${Math.round(rate).toLocaleString()}원)`;
    } else {
        if (unitHead) unitHead.textContent = ' (원)';
        if (hintEl) hintEl.textContent = '모든 입력값과 계산은 원화 기준으로 수행되며, 결과 표시 통화만 전환됩니다.';
    }

    // 저장된 profitData(원화 원본)를 다시 렌더링만 함 — 계산 재실행 없이 표시 통화만 갱신
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

        tbody.innerHTML += `<tr>
            <td style="text-align:center; font-weight:700;">${d.i}</td>
            <td>${fmt(d.revenue)}</td>
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
        { q: '우리 농지에 영농형 태양광을 설치하면 작물 재배에 지장이 있을까요?', icon: 'fa-seedling', view: 'about', prefill: null },
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
        { q: '부광솔라는 어떤 회사인가요?', icon: 'fa-building', view: 'about', prefill: null },
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
    const map = { about: '회사소개', revenue: '통합수익분석', site3d: '입지분석', tech: '기술·특허', contact: '문의' };
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
    renderYoloGuide();

    // YOLO 점수는 사용자의 행동(클릭, 스크롤, 체류)에 따라 계속 갱신되므로
    // 홈 화면에 머무는 동안 주기적으로 안내 카드를 다시 그려 자연스럽게 반영합니다.
    setInterval(() => {
        const homeActive = document.getElementById('view-home')?.classList.contains('active');
        if (homeActive) renderYoloGuide();
    }, 8000);
});
