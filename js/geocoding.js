/**
 * ============================================================
 *  부광솔라 지오코딩 + 실측 지형/건물/일사량 결합 모듈 v4.0
 * ============================================================
 *  - 주소 입력 → 전세계 주소를 대상으로 두 개의 오픈(키 불필요) 지오코더를
 *    순차 시도합니다: 1차 OpenStreetMap Nominatim → 실패 시 2차 Photon(komoot).
 *    국가를 한정하지 않으며, 영어 결과를 우선해 비-한국 주소의 인식률을 높입니다.
 *  - 좌표 → NASA POWER 1년치(월별) 실측 일사량 데이터 (전세계 좌표 지원)
 *  - 좌표 → Open-Meteo Elevation API 실측 고도 그리드 (Copernicus DEM 90m, 전세계)
 *  - 좌표 → OpenStreetMap Overpass API 실제 주변 건물 폴리곤 + 높이 (전세계)
 *  네 데이터 소스 모두 API 키 없이 동작하며 국가 제한이 없는 전세계 공개 데이터입니다.
 * ============================================================
 */

(function () {
    'use strict';

    /**
     * 주소 → {lat, lon, displayName}
     * 1차: Nominatim(OSM 공식) → 결과 없음/오류 시 2차: Photon(komoot, OSM 기반)
     * 두 서비스 모두 키가 필요 없고 국가 제한이 없는 전세계 커버리지를 가집니다.
     */
    async function geocode(address) {
        if (!address || !address.trim()) {
            throw new Error('주소를 입력해주세요.');
        }

        try {
            return await geocodeWithNominatim(address);
        } catch (e1) {
            console.warn('[Geocode] Nominatim 실패, Photon으로 재시도:', e1.message);
            try {
                return await geocodeWithPhoton(address);
            } catch (e2) {
                console.warn('[Geocode] Photon도 실패:', e2.message);
                throw new Error('주소를 찾을 수 없습니다. 영문 표기나 더 구체적인 주소로 다시 시도해주세요.');
            }
        }
    }

    async function geocodeWithNominatim(address) {
        // 국가 코드(countrycodes)를 지정하지 않아 전세계 검색이 가능하며,
        // accept-language를 'en'으로 두어 비영어권 주소도 일관되게 매칭되도록 합니다.
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=3&addressdetails=1&q=${encodeURIComponent(address)}`;
        const res = await fetch(url, {
            headers: { 'Accept-Language': 'en' }
        });
        if (!res.ok) throw new Error('Nominatim 응답 오류');
        const data = await res.json();
        if (!data.length) throw new Error('Nominatim 결과 없음');

        const best = data[0];
        return {
            lat: parseFloat(best.lat),
            lon: parseFloat(best.lon),
            displayName: best.display_name,
            source: 'nominatim'
        };
    }

    async function geocodeWithPhoton(address) {
        // Photon(komoot) — OpenStreetMap 데이터를 기반으로 한 전세계 오픈 지오코더.
        // Nominatim이 인식하지 못하는 형식의 해외 주소/지명에서 보완적으로 동작합니다.
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=3&lang=en`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Photon 응답 오류');
        const data = await res.json();
        const features = data?.features || [];
        if (!features.length) throw new Error('Photon 결과 없음');

        const best = features[0];
        const [lon, lat] = best.geometry.coordinates;
        const p = best.properties || {};
        const nameParts = [p.name, p.street, p.city, p.state, p.country].filter(Boolean);

        return {
            lat, lon,
            displayName: nameParts.join(', ') || address,
            source: 'photon'
        };
    }

    /**
     * 좌표 → NASA POWER 1년치(월별) 일사량 데이터 (전세계 모든 좌표 지원, 키 불필요)
     * 반환: { monthly: [12개월 값], avgIrradiance: 평균(kWh/m²/day), equivGenHours: 등가발전시간(h) }
     */
    async function fetchNasaIrradiance(lat, lon, year) {
        const targetYear = year || (new Date().getFullYear() - 1); // 최근 완료된 연도 기본 사용
        const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&format=JSON&start=${targetYear}&end=${targetYear}`;
        const res = await fetch(url);
        const data = await res.json();

        const paramObj = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN;
        if (!paramObj) throw new Error('NASA 데이터 수신 실패');

        const monthly = Object.values(paramObj).filter(v => v > 0 && v < 900); // 결측치(-999 등) 제거
        if (!monthly.length) throw new Error('해당 좌표의 NASA 일사량 데이터가 없습니다.');

        const avgIrradiance = monthly.reduce((a, b) => a + b, 0) / monthly.length;

        // kWh/m²/day 평균 일사량을 '일평균 발전시간(h)' 등가값으로 환산.
        // 표준시험조건(STC, 1 kW/m²) 기준 환산 — 일사량(kWh/m²) ÷ 1(kW/m²) = 등가시간(h)
        const equivGenHours = avgIrradiance;

        return { monthly, avgIrradiance, equivGenHours, year: targetYear };
    }

    /**
     * 좌표 → 실제 지형 고도 그리드 (Open-Meteo Elevation API, 키 불필요, CORS 지원)
     * 좌표 중심으로 5x5 그리드(약 70m 격자)의 실측 고도(m)를 조회하여
     * 등고선 지형 생성에 사용합니다. (데이터: Copernicus DEM GLO-90, 90m 해상도)
     * 반환: { grid: [{lat, lon, elev}], minElev, maxElev, relief }
     */
    async function fetchElevationGrid(lat, lon, gridSize = 5, stepMeters = 70) {
        const stepDeg = stepMeters / 111320; // 위도 1도 ≈ 111.32km
        const half = Math.floor(gridSize / 2);

        const points = [];
        for (let row = -half; row <= half; row++) {
            for (let col = -half; col <= half; col++) {
                const pLat = lat + row * stepDeg;
                const pLon = lon + col * (stepDeg / Math.cos(lat * Math.PI / 180));
                points.push({ row, col, lat: pLat, lon: pLon });
            }
        }

        const latStr = points.map(p => p.lat.toFixed(6)).join(',');
        const lonStr = points.map(p => p.lon.toFixed(6)).join(',');
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${latStr}&longitude=${lonStr}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('지형 고도 데이터를 가져오지 못했습니다.');
        const data = await res.json();
        if (!data.elevation || !data.elevation.length) throw new Error('지형 고도 데이터가 비어있습니다.');

        const grid = points.map((p, i) => ({ ...p, elev: data.elevation[i] }));
        const elevs = grid.map(g => g.elev);
        const minElev = Math.min(...elevs);
        const maxElev = Math.max(...elevs);

        return { grid, gridSize, minElev, maxElev, relief: Math.round((maxElev - minElev) * 10) / 10 };
    }

    /**
     * 좌표 → 실제 주변 건물 데이터 (OpenStreetMap Overpass API, 키 불필요, 전세계 커버리지)
     * 반경(미터) 내 건물 폴리곤과 높이(height/building:levels 태그)를 조회합니다.
     * 메인 서버가 응답하지 않을 경우 미러 서버로 자동 재시도합니다(해외 접속 시 지연/차단 대비).
     * 반환: [{ centerLat, centerLon, footprint:[[lat,lon],...], heightMeters, levels, name }]
     */
    async function fetchNearbyBuildings(lat, lon, radiusMeters = 150, limit = 12) {
        const query = `[out:json][timeout:20];
(
  way["building"](around:${radiusMeters},${lat},${lon});
);
out geom tags;`;

        const endpoints = [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter'
        ];

        let data = null, lastErr = null;
        for (const url of endpoints) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    body: 'data=' + encodeURIComponent(query)
                });
                if (!res.ok) throw new Error(`Overpass 응답 오류 (${url})`);
                data = await res.json();
                break;
            } catch (e) {
                lastErr = e;
            }
        }
        if (!data) throw new Error('주변 건물 데이터를 가져오지 못했습니다.');

        const buildings = (data.elements || [])
            .filter(el => el.type === 'way' && el.geometry && el.geometry.length >= 3)
            .map(el => {
                const footprint = el.geometry.map(g => [g.lat, g.lon]);
                const centerLat = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
                const centerLon = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;

                const tags = el.tags || {};
                let heightMeters = parseFloat(tags['height']);
                if (isNaN(heightMeters)) {
                    const levels = parseFloat(tags['building:levels']);
                    heightMeters = !isNaN(levels) ? levels * 3 : 9; // 층당 3m 가정, 정보 없으면 3층(9m) 기본값
                }

                return {
                    centerLat, centerLon, footprint,
                    heightMeters,
                    levels: tags['building:levels'] || null,
                    name: tags['name'] || tags['building'] || '건물'
                };
            })
            .sort((a, b) => {
                const da = haversine(lat, lon, a.centerLat, a.centerLon);
                const db = haversine(lat, lon, b.centerLat, b.centerLon);
                return da - db;
            })
            .slice(0, limit);

        return buildings;
    }

    function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    // 위경도 좌표를 중심점 기준 로컬 미터 단위(x, z)로 변환 (3D 씬 배치용)
    // ※ 지형 메쉬는 PlaneGeometry(XY 평면)를 rotation.x = -π/2 로 눕힌 뒤
    //   localY → -realZ 로 직접 기록합니다. 따라서 Three.js 월드 좌표계에서
    //   북쪽(위도 증가) 방향은 -Z 입니다. 건물·패널도 이 규칙을 따라야
    //   지형과 완전히 일치하므로 z = -dLat * 111320 으로 정의합니다.
    function latLonToLocalMeters(lat, lon, centerLat, centerLon) {
        const dLat = lat - centerLat;
        const dLon = lon - centerLon;
        const z = -dLat * 111320; // 북쪽 = -Z (지형 PlaneGeometry 규칙과 통일)
        const x = dLon * 111320 * Math.cos(centerLat * Math.PI / 180); // 동쪽(+x)
        return { x, z };
    }

    window.SolarGeo = {
        geocode,
        fetchNasaIrradiance,
        fetchElevationGrid,
        fetchNearbyBuildings,
        latLonToLocalMeters,
        haversine
    };
})();
