/**
 * ============================================================
 *  부광솔라 3D 입지분석 시뮬레이션 v7.0
 *  Three.js 기반 | 실측 지형(Open-Meteo) + 실제 건물(OSM Overpass)
 *  + NASA 일사량 결합 + 선택형 축적(1:20~1:5000)
 * ============================================================
 *  v7.0 핵심 수정
 *
 *  [1] 좌표계 완전 통일 (건물 위치 어긋남 수정)
 *      이전 버전은 지형 정점 위치를 그리드 인덱스 비례(gu/gv)로 계산하고,
 *      건물은 SolarGeo.latLonToLocalMeters()로 별도 계산했습니다. 두 계산이
 *      수학적으로는 근사치였지만 부동소수점 누적 오차가 모서리로 갈수록
 *      커져 건물 위치가 지형과 미세하게 어긋나 보였습니다.
 *      → 지형 정점도 grid에 저장된 실제 lat/lon을 latLonToLocalMeters()로
 *        직접 변환해서 사용하도록 변경, 건물과 100% 동일한 변환 함수를
 *        거치게 해 어떤 오차도 발생할 수 없게 만들었습니다.
 *
 *  [2] 레이어 의미 재설계 (건물 위/토지 위 패널 설치 구분)
 *      이전 버전의 "지형/건물/패널 표시 on-off" 토글은 단순 가시성
 *      제어였을 뿐, 실제 의도(패널을 건물 옥상에 설치할지, 토지 위
 *      영농형으로 설치할지 구분)와 맞지 않았습니다.
 *      → "설치 위치" 토글로 전면 재설계: 토지 위(영농형 구조물, 다리
 *        달린 패널) / 건물 위(옥상형, 건물 지붕 위 평행 배치) 두 모드를
 *        제공하고, 각 모드에 맞는 형태로 패널을 생성합니다.
 *
 *  [3] 패널 표준 격자 시스템 (정형화, 다층 분리 오류 해결)
 *      자동배치와 클릭배치가 서로 다른 좌표 기준을 썼던 문제를 해결하기
 *      위해 단일 격자 시스템(PANEL_GRID)을 도입했습니다. 모든 패널은
 *      이 격자의 셀 중심에만 생성되어 항상 가지런히 정렬되며, 클릭은
 *      "가장 가까운 빈 격자 셀"로 스냅됩니다(무작위 위치 생성 차단).
 *
 *  [4] 클릭 배치 좌표 버그 수정
 *      클릭 지점을 그대로 패널 중심으로 쓰던 방식에서, 격자 스냅 방식으로
 *      변경해 자동배치 패널과 항상 동일한 행/열에 정렬되도록 했습니다.
 * ============================================================
 */

(function () {
    'use strict';

    const SCALE_PRESETS = {
        50:   { label: '1:50',   camDistFactor: 0.75,  gridStepM: 2,   fovHint: '패널 어레이 배치' },
        100:  { label: '1:100',  camDistFactor: 1.1,   gridStepM: 5,   fovHint: '단위 구조물 전체' },
        500:  { label: '1:500',  camDistFactor: 1.85,  gridStepM: 10,  fovHint: '부지 전체 보기' },
        1000: { label: '1:1000', camDistFactor: 2.8,   gridStepM: 20,  fovHint: '부지 전체 + 인접 건물' }
    };
    let currentScale = 100;

    const PANEL_CELL_X = 4.0;
    const PANEL_CELL_Z = 3.0;

    let scene, camera, renderer, sunLight, sunMesh, hemiLight, fillLight, skyMesh;
    let terrainLayer, buildingLayer, panelLayer, markerLayer, scaleGroup, compassGroup;
    let terrainMesh, terrainWire;
    let currentLat = 37.56, currentLon = 126.98;
    let currentIrradiance = 4.5;
    let currentCapacityKW = 100;
    let initialized = false;
    let camAngle = 35;
    let currentSceneSizeMeters = 80;

    // 줌 상태 (camDistFactor에 곱해지는 배율, 1.0 = 기본)
    let zoomFactor = 1.0;
    const ZOOM_MIN = 0.25, ZOOM_MAX = 4.0, ZOOM_STEP = 0.12;

    // 터치 핀치용
    let lastPinchDist = null;

    let terrainSample = null;
    let buildingFootprints = [];
    let installMode = 'ground';

    let clickPlacementMode = false;
    let raycaster, mouse;

    // sampleTerrainHeight(worldX, worldZ)
    // worldZ = localZ = -dLat*111320 (latLonToLocalMeters 반환값과 동일)
    function sampleTerrainHeight(x, z) {
        if (!terrainSample) return 0;
        const { grid, gridSize, minX, maxX, minZ, maxZ } = terrainSample;
        const gu = ((x - minX) / (maxX - minX || 1)) * (gridSize - 1);
        const gv = ((z - minZ) / (maxZ - minZ || 1)) * (gridSize - 1);
        const c0 = Math.max(0, Math.min(gridSize - 1, Math.floor(gu)));
        const c1 = Math.max(0, Math.min(gridSize - 1, c0 + 1));
        const r0 = Math.max(0, Math.min(gridSize - 1, Math.floor(gv)));
        const r1 = Math.max(0, Math.min(gridSize - 1, r0 + 1));
        const fu = Math.max(0, Math.min(1, gu - c0));
        const fv = Math.max(0, Math.min(1, gv - r0));

        const e00 = grid[r0 * gridSize + c0].localElev;
        const e01 = grid[r0 * gridSize + c1].localElev;
        const e10 = grid[r1 * gridSize + c0].localElev;
        const e11 = grid[r1 * gridSize + c1].localElev;
        const eTop = e00 * (1 - fu) + e01 * fu;
        const eBot = e10 * (1 - fu) + e11 * fu;
        return eTop * (1 - fv) + eBot * fv;
    }

    function pointInPolygon(px, pz, points) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i][0], zi = points[i][1];
            const xj = points[j][0], zj = points[j][1];
            const intersect = ((zi > pz) !== (zj > pz)) &&
                (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function findBuildingAt(x, z, marginM) {
        const m = marginM || 1.0;
        for (const fp of buildingFootprints) {
            if (pointInPolygon(x, z, fp.points)) return fp;
            for (const [bx, bz] of fp.points) {
                if (Math.hypot(x - bx, z - bz) < m) return fp;
            }
        }
        return null;
    }

    function getGroundGridCell(col, row) {
        return { x: col * PANEL_CELL_X, z: row * PANEL_CELL_Z };
    }

    function snapToGroundGrid(x, z) {
        const col = Math.round(x / PANEL_CELL_X);
        const row = Math.round(z / PANEL_CELL_Z);
        return { col, row, ...getGroundGridCell(col, row) };
    }

    function applyAniso(tex) {
        if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return tex;
    }

    function makeGroundTexture() {
        const size = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#7fb86b';
        ctx.fillRect(0, 0, size, size);

        for (let i = 0; i < 9000; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const r = Math.random() * 2.4 + 0.4;
            const shade = Math.random();
            const g = Math.floor(118 + shade * 62);
            const rr = Math.floor(88 + shade * 42);
            const bb = Math.floor(58 + shade * 32);
            ctx.fillStyle = `rgba(${rr},${g},${bb},${0.22 + Math.random() * 0.28})`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.strokeStyle = 'rgba(55,95,48,0.16)';
        ctx.lineWidth = 2;
        for (let x = 0; x < size; x += 30) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return applyAniso(tex);
    }

    function makePanelTexture() {
        const w = 512, h = 288;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#16243f');
        grad.addColorStop(0.5, '#1d3557');
        grad.addColorStop(1, '#142036');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(150,180,220,0.55)';
        ctx.lineWidth = 1.5;
        const cols = 6, rows = 10;
        for (let c = 1; c < cols; c++) {
            const x = (w / cols) * c;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let r = 1; r < rows; r++) {
            const y = (h / rows) * r;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.12);
        ctx.lineTo(w * 0.55, 0);
        ctx.stroke();

        const tex = new THREE.CanvasTexture(canvas);
        return applyAniso(tex);
    }

    function makeBuildingTexture(heightMeters) {
        const w = 256, h = 512;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');

        const wallGrad = ctx.createLinearGradient(0, 0, 0, h);
        wallGrad.addColorStop(0, '#b9c2d1');
        wallGrad.addColorStop(1, '#97a3b8');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(0, 0, w, h);

        const floors = Math.max(2, Math.round(heightMeters / 3));
        const floorH = h / floors;
        for (let f = 0; f < floors; f++) {
            const y = f * floorH + floorH * 0.16;
            const winH = floorH * 0.58;
            for (let wx = 0; wx < 4; wx++) {
                const x = wx * (w / 4) + (w / 4) * 0.1;
                const winW = (w / 4) * 0.8;
                ctx.fillStyle = 'rgba(50,70,100,0.62)';
                ctx.fillRect(x, y, winW, winH);
                ctx.fillStyle = 'rgba(220,235,255,0.2)';
                ctx.fillRect(x, y, winW, winH * 0.25);
            }
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        for (let f = 0; f < floors; f++) {
            const y = f * floorH;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        return applyAniso(tex);
    }

    function makeSkyMesh() {
        const skyGeo = new THREE.SphereGeometry(900, 32, 16);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x4a90d9) },
                bottomColor: { value: new THREE.Color(0xeaf4ff) },
                offset: { value: 20 },
                exponent: { value: 0.55 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
                    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
                }
            `,
            side: THREE.BackSide
        });
        return new THREE.Mesh(skyGeo, skyMat);
    }

    function ensureRenderer() {
        const container = document.getElementById('site3d-canvas');
        if (!container) return false;

        const w = container.clientWidth || 800;
        const h = container.clientHeight || 500;

        if (!initialized) {
            scene = new THREE.Scene();
            scene.fog = new THREE.FogExp2(0x87CEEB, 0.0006);

            camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 5000);

            renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.setSize(w, h);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.05;
            renderer.setClearColor(0x87CEEB, 1);
            container.innerHTML = '';
            container.appendChild(renderer.domElement);

            skyMesh = makeSkyMesh();
            scene.add(skyMesh);

            hemiLight = new THREE.HemisphereLight(0xddeeff, 0x556633, 0.7);
            scene.add(hemiLight);

            sunLight = new THREE.DirectionalLight(0xfff3d6, 1.35);
            sunLight.castShadow = true;
            sunLight.shadow.mapSize.set(2048, 2048);
            sunLight.shadow.bias = -0.0006;
            sunLight.shadow.normalBias = 0.02;
            scene.add(sunLight);

            fillLight = new THREE.DirectionalLight(0x9fc6ff, 0.28);
            scene.add(fillLight);

            const sunGeo = new THREE.SphereGeometry(1.6, 24, 24);
            const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
            sunMesh = new THREE.Mesh(sunGeo, sunMat);
            scene.add(sunMesh);

            terrainLayer = new THREE.Group(); terrainLayer.name = 'terrainLayer';
            buildingLayer = new THREE.Group(); buildingLayer.name = 'buildingLayer';
            panelLayer = new THREE.Group(); panelLayer.name = 'panelLayer';
            markerLayer = new THREE.Group(); markerLayer.name = 'markerLayer';
            scene.add(terrainLayer, buildingLayer, panelLayer, markerLayer);

            raycaster = new THREE.Raycaster();
            mouse = new THREE.Vector2();
            renderer.domElement.addEventListener('click', onCanvasClick);

            // ── 마우스 휠 줌 ────────────────────────────────────────
            renderer.domElement.addEventListener('wheel', e => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP;
                zoomFactor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomFactor + delta));
                updateCameraPosition(camAngle);
            }, { passive: false });

            // ── 터치 핀치 줌 ─────────────────────────────────────────
            renderer.domElement.addEventListener('touchstart', e => {
                if (e.touches.length === 2) {
                    lastPinchDist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                }
            }, { passive: true });
            renderer.domElement.addEventListener('touchmove', e => {
                if (e.touches.length === 2 && lastPinchDist !== null) {
                    e.preventDefault();
                    const d = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                    const ratio = lastPinchDist / d;
                    zoomFactor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomFactor * ratio));
                    lastPinchDist = d;
                    updateCameraPosition(camAngle);
                }
            }, { passive: false });
            renderer.domElement.addEventListener('touchend', () => { lastPinchDist = null; });

            initialized = true;
            animate();
            window.addEventListener('resize', onResize);
        }
        return true;
    }

    function updateShadowFrustum(sizeMeters) {
        if (!sunLight) return;
        const half = Math.max(20, sizeMeters * 0.7);
        sunLight.shadow.camera.left = -half;
        sunLight.shadow.camera.right = half;
        sunLight.shadow.camera.top = half;
        sunLight.shadow.camera.bottom = -half;
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = half * 6;
        sunLight.shadow.camera.updateProjectionMatrix();
    }

    function initPlaceholder(lat, lon) {
        if (!ensureRenderer()) return;
        currentLat = lat || currentLat;
        currentLon = lon || currentLon;

        clearTerrain();
        clearBuildings();
        clearPanels();
        clearMarker();
        clearScaleAndCompass();
        terrainSample = null;
        buildingFootprints = [];

        currentSceneSizeMeters = 80;
        const flatGeo = new THREE.PlaneGeometry(80, 80, 1, 1);
        const flatMat = new THREE.MeshStandardMaterial({ color: 0x7aaa5a, roughness: 0.9 });
        terrainMesh = new THREE.Mesh(flatGeo, flatMat);
        terrainMesh.rotation.x = -Math.PI / 2;
        terrainMesh.receiveShadow = true;
        terrainLayer.add(terrainMesh);

        buildScaleAndCompass(80);
        updateShadowFrustum(80);
        applyScalePreset(currentScale);
    }

    function clearTerrain() {
        if (terrainMesh) { terrainLayer.remove(terrainMesh); terrainMesh.geometry?.dispose(); terrainMesh = null; }
        if (terrainWire) { terrainLayer.remove(terrainWire); terrainWire.geometry?.dispose(); terrainWire = null; }
    }

    function clearBuildings() {
        if (buildingLayer) {
            [...buildingLayer.children].forEach(c => { c.geometry?.dispose(); buildingLayer.remove(c); });
        }
    }

    function clearPanels() {
        if (panelLayer) {
            [...panelLayer.children].forEach(c => { c.geometry?.dispose(); panelLayer.remove(c); });
        }
    }

    function clearMarker() {
        if (markerLayer) {
            [...markerLayer.children].forEach(c => { c.geometry?.dispose(); markerLayer.remove(c); });
        }
    }

    function clearScaleAndCompass() {
        if (scaleGroup) { scene.remove(scaleGroup); scaleGroup = null; }
        if (compassGroup) { scene.remove(compassGroup); compassGroup = null; }
    }

    function buildTerrainFromElevation(elevationData, centerLat, centerLon) {
        if (!ensureRenderer()) return;
        clearTerrain();

        const { grid, gridSize, minElev } = elevationData;
        const seg = gridSize - 1;

        // grid의 각 실측 점에 대해 좌표 변환 함수(latLonToLocalMeters)로 정확한
        // 로컬 (x, z)를 계산해 저장합니다. 건물(buildRealBuildings)도 동일한
        // 변환 함수를 쓰므로 이 좌표가 건물 위치의 기준과 100% 일치합니다.
        grid.forEach(p => {
            const { x, z } = SolarGeo.latLonToLocalMeters(p.lat, p.lon, centerLat, centerLon);
            p.localX = x;
            p.localZ = z;          // z = -dLat*111320 (북쪽이 음수, 원본 그대로)
            p.localElev = p.elev - minElev;
        });

        const xs = grid.map(p => p.localX);
        const zs = grid.map(p => p.localZ);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const sizeMeters = Math.max(maxX - minX, maxZ - minZ);
        currentSceneSizeMeters = sizeMeters;

        terrainSample = { grid, gridSize, minElev, sizeMeters, minX, maxX, minZ, maxZ };

        // ──────────────────────────────────────────────────────────
        // 핵심 수정: 이전 버전은 PlaneGeometry의 표준(완전 등간격) 격자에
        // 고도값만 끼워 넣어, 위도에 따른 경도 보정 등으로 실제 grid 점들이
        // 미세하게 비균일한 간격을 가진다는 사실을 무시했습니다. 이로 인해
        // 지형 메쉬와 건물(latLonToLocalMeters 직접 사용) 사이에 위치가
        // 어긋나 보이는 문제가 발생했습니다.
        // 이제는 메쉬의 모든 정점에 대해 X, Z 좌표 자체를 grid의 실측
        // localX/localZ로 양선형보간해서 직접 덮어씁니다. 즉 지형 메쉬도
        // 건물과 동일하게 "실측 좌표 그대로"를 따르므로 어떤 미세한
        // 불일치도 발생할 수 없습니다.
        // ──────────────────────────────────────────────────────────
        // ── 성능 최적화: fineSeg 축소 (64 이하) ──
        const fineSeg = Math.min(64, seg * 4);
        const geo = new THREE.PlaneGeometry(sizeMeters, sizeMeters, fineSeg, fineSeg);
        const pos = geo.attributes.position;

        const fineRes = fineSeg + 1;
        for (let row = 0; row < fineRes; row++) {
            for (let col = 0; col < fineRes; col++) {
                const idx = row * fineRes + col;
                const gu =  (col / (fineRes - 1)) * seg;
                // grid[row=0] = 남쪽, PlaneGeometry row=0 = 화면 위(북)
                // → gv를 뒤집어 row=0 → grid 북쪽(gridSize-1)에 대응
                const gv = (1 - row / (fineRes - 1)) * seg;
                const c0 = Math.floor(gu), c1 = Math.min(gridSize - 1, c0 + 1);
                const r0 = Math.floor(gv), r1 = Math.min(gridSize - 1, r0 + 1);
                const fu = gu - c0, fv = gv - r0;

                const p00 = grid[r0 * gridSize + c0];
                const p01 = grid[r0 * gridSize + c1];
                const p10 = grid[r1 * gridSize + c0];
                const p11 = grid[r1 * gridSize + c1];

                const eTop = p00.localElev * (1 - fu) + p01.localElev * fu;
                const eBot = p10.localElev * (1 - fu) + p11.localElev * fu;
                const elev = eTop * (1 - fv) + eBot * fv;

                const xTop = p00.localX * (1 - fu) + p01.localX * fu;
                const xBot = p10.localX * (1 - fu) + p11.localX * fu;
                const realX = xTop * (1 - fv) + xBot * fv;

                const zTop = p00.localZ * (1 - fu) + p01.localZ * fu;
                const zBot = p10.localZ * (1 - fu) + p11.localZ * fu;
                const realZ = zTop * (1 - fv) + zBot * fv;

                // PlaneGeometry(XY) + rotation.x=-π/2: localY → 월드 -Z
                // realZ = localZ = -dLat*111320 (북쪽=음수)
                // pos.setY(-realZ) = +dLat → 월드-Z = -dLat → 북쪽=-Z ✓
                pos.setX(idx, realX);
                pos.setY(idx, -realZ);
                pos.setZ(idx, elev);
            }
        }

        geo.computeVertexNormals();

        // ════════════════════════════════════════════════════════════════
        //  OpenTopoMap 타일 텍스처 — 위경도 기반 UV 정밀 매핑
        // ════════════════════════════════════════════════════════════════
        async function buildTopoTexture() {
            const zoom = sizeMeters < 200 ? 18 : sizeMeters < 400 ? 17 :
                         sizeMeters < 900 ? 16 : sizeMeters < 2000 ? 15 : 14;
            const n = Math.pow(2, zoom);

            function latLonToTileXY(lat, lon) {
                const r = lat * Math.PI / 180;
                return {
                    tx: (lon + 180) / 360 * n,
                    ty: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n
                };
            }

            const lats = grid.map(p => p.lat), lons = grid.map(p => p.lon);
            const pad = 2;
            const { tx: txNW, ty: tyNW } = latLonToTileXY(Math.max(...lats), Math.min(...lons));
            const { tx: txSE, ty: tySE } = latLonToTileXY(Math.min(...lats), Math.max(...lons));
            const tileX1 = Math.floor(txNW - pad), tileX2 = Math.ceil(txSE + pad);
            const tileY1 = Math.floor(tyNW - pad), tileY2 = Math.ceil(tySE + pad);
            const tileSize = 256;
            const canvasW = (tileX2 - tileX1) * tileSize;
            const canvasH = (tileY2 - tileY1) * tileSize;

            const canvas = document.createElement('canvas');
            canvas.width = canvasW; canvas.height = canvasH;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#e8f2d4';
            ctx.fillRect(0, 0, canvasW, canvasH);

            const servers = ['a', 'b', 'c'];
            const loads = [];
            for (let ty = tileY1; ty < tileY2; ty++) {
                for (let tx = tileX1; tx < tileX2; tx++) {
                    if (ty < 0 || ty >= n) continue;
                    const s = servers[Math.abs((tx + ty) % 3)];
                    const url = `https://${s}.tile.opentopomap.org/${zoom}/${tx}/${ty}.png`;
                    const cx = (tx - tileX1) * tileSize;
                    const cy = (ty - tileY1) * tileSize;
                    loads.push(new Promise(resolve => {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        img.onload  = () => { ctx.drawImage(img, cx, cy, tileSize, tileSize); resolve(); };
                        img.onerror = () => resolve();
                        img.src = url;
                    }));
                }
            }
            await Promise.allSettled(loads);

            // ── UV: 각 정점의 실제 lat/lon → 타일 픽셀 좌표 → UV ──────────
            // PlaneGeometry row=0 은 localY 최대(북쪽), row=fineRes-1 은 localY 최소(남쪽)
            // pos.setY(-realZ) 했으므로 row=0 → -realZ 큰 값 → localZ 작은 값 → 북쪽
            // Three.js flipY=false: v=0 → 캔버스 상단, v=1 → 캔버스 하단
            // 캔버스 상단(cy 작음) = 북쪽 타일 → row=0 과 일치 → v = py/canvasH (반전 없음)
            const fineRes2 = fineSeg + 1;
            const uvAttr = geo.attributes.uv;
            for (let row = 0; row < fineRes2; row++) {
                for (let col = 0; col < fineRes2; col++) {
                    const idx = row * fineRes2 + col;
                    const gu =  (col / (fineRes2 - 1)) * seg;
                    const gv = (1 - row / (fineRes2 - 1)) * seg; // 정점 루프와 동일한 뒤집기
                    const c0 = Math.min(gridSize - 2, Math.floor(gu));
                    const r0 = Math.min(gridSize - 2, Math.floor(gv));
                    const fu = gu - c0, fv = gv - r0;
                    const p00 = grid[r0 * gridSize + c0];
                    const p01 = grid[r0 * gridSize + (c0 + 1)];
                    const p10 = grid[(r0 + 1) * gridSize + c0];
                    const p11 = grid[(r0 + 1) * gridSize + (c0 + 1)];

                    const lat = p00.lat*(1-fu)*(1-fv) + p01.lat*fu*(1-fv)
                              + p10.lat*(1-fu)*fv     + p11.lat*fu*fv;
                    const lon = p00.lon*(1-fu)*(1-fv) + p01.lon*fu*(1-fv)
                              + p10.lon*(1-fu)*fv     + p11.lon*fu*fv;

                    const { tx: ptx, ty: pty } = latLonToTileXY(lat, lon);
                    const u = Math.max(0.001, Math.min(0.999, (ptx - tileX1) * tileSize / canvasW));
                    // 캔버스 y=0=북(타일Y 작음), 정점 row=0=화면위=북
                    // flipY=false: Three.js UV v=0→캔버스y=0=북, row=0=북 → 일치 ✓
                    const v = Math.max(0.001, Math.min(0.999, (pty - tileY1) * tileSize / canvasH));
                    uvAttr.setXY(idx, u, v);
                }
            }
            uvAttr.needsUpdate = true;

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.flipY = false;   // 캔버스 v=0=위=북, row=0=북 → 반전 불필요
            applyAniso(tex);
            return tex;
        }

        // 초기 메쉬: 초록 플레이스홀더
        terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7aaa5a, roughness: 0.85 }));
        terrainMesh.rotation.x = -Math.PI / 2;
        terrainMesh.receiveShadow = true;
        terrainMesh.name = 'terrainGround';
        terrainLayer.add(terrainMesh);

        // 와이어프레임 — 고도 구조 시각화
        const wireGeo = new THREE.WireframeGeometry(geo);
        terrainWire = new THREE.LineSegments(wireGeo,
            new THREE.LineBasicMaterial({ color: 0x1a4a1a, transparent: true, opacity: 0.12 }));
        terrainWire.rotation.x = -Math.PI / 2;
        terrainWire.position.y = 0.05;
        terrainLayer.add(terrainWire);

        // OpenTopoMap 타일 비동기 로드 후 메쉬 텍스처 교체
        buildTopoTexture().then(topoTex => {
            if (!terrainMesh) return;
            terrainMesh.material = new THREE.MeshStandardMaterial({
                map: topoTex, roughness: 0.80, metalness: 0.0
            });
        }).catch(err => {
            console.warn('OpenTopoMap 로드 실패:', err);
            if (terrainMesh) terrainMesh.material = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.88 });
        });

        clearScaleAndCompass();
        buildScaleAndCompass(sizeMeters);
        updateShadowFrustum(sizeMeters);
        applyScalePreset(currentScale);

        return { sizeMeters, minElev, maxElev: elevationData.maxElev, relief: elevationData.relief };
    }

    function placeLocationMarker(x, z) {
        const px = x || 0, pz = z || 0;
        clearMarker();
        const groundY = sampleTerrainHeight(px, pz);
        const scaleRef = Math.max(1.2, currentSceneSizeMeters * 0.025);

        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(scaleRef * 0.04, scaleRef * 0.04, scaleRef * 2.2, 8),
            new THREE.MeshStandardMaterial({ color: 0xef4444 })
        );
        pole.position.set(px, groundY + scaleRef * 1.1, pz);
        markerLayer.add(pole);

        const head = new THREE.Mesh(
            new THREE.SphereGeometry(scaleRef * 0.32, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, emissiveIntensity: 0.3 })
        );
        head.position.set(px, groundY + scaleRef * 2.3, pz);
        markerLayer.add(head);

        const ringGeo = new THREE.RingGeometry(scaleRef * 0.5, scaleRef * 0.65, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(px, groundY + 0.05, pz);
        markerLayer.add(ring);
    }

    function buildRealBuildings(buildings, centerLat, centerLon) {
        if (!ensureRenderer()) return 0;
        clearBuildings();
        buildingFootprints = [];

        let built = 0;

        buildings.forEach(b => {
            if (!b.footprint || b.footprint.length < 3) return;

            // ExtrudeGeometry 는 Shape(XY 평면) 를 Z 방향으로 돌출 후
            // rotateX(-π/2) 로 눕힙니다. 이 때 Shape.Y → 월드 -Z 변환이
            // 일어나므로, 지형 좌표계(북쪽=-Z)와 일치시키려면
            // Shape.Y 에 -z (= dLat*111320, 북쪽=+Y) 를 넣어야 합니다.
            const shapePoints = b.footprint.map(([flat, flon]) => {
                const { x, z } = SolarGeo.latLonToLocalMeters(flat, flon, centerLat, centerLon);
                return new THREE.Vector2(x, -z); // z 부호 반전: rotateX(-π/2) mirror 보정
            });

            let shape;
            try { shape = new THREE.Shape(shapePoints); } catch (e) { return; }

            // shapePoints: Vector2(x, -z_original) → Shape.Y = -z_original
            // ExtrudeGeo.rotateX(-π/2) → Shape.Y → 월드 -Z
            // 월드Z = -Shape.Y = z_original ✓ (latLonToLocalMeters 기준과 동일)
            const sumP = shapePoints.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
            const centerXZ = {
                x: sumP.x / shapePoints.length,
                z: -(sumP.y / shapePoints.length)  // 월드Z = -shapeY = z_original
            };
            const baseY = sampleTerrainHeight(centerXZ.x, centerXZ.z);

            const height = Math.max(3, b.heightMeters || 9);
            const extrudeSettings = { depth: height, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 };
            const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geo.rotateX(-Math.PI / 2);

            const wallTex = makeBuildingTexture(height);
            wallTex.repeat.set(2, Math.max(1, Math.round(height / 6)));
            const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.1 });

            const mesh = new THREE.Mesh(geo, wallMat);
            mesh.position.y = baseY;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.height = height;
            mesh.userData.centerLat = b.centerLat;
            mesh.userData.centerLon = b.centerLon;
            mesh.userData.name = b.name;
            buildingLayer.add(mesh);

            const baseMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.9 });
            const baseGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false });
            baseGeo.rotateX(-Math.PI / 2);
            baseGeo.translate(0, baseY - 0.38, 0);
            const baseMesh = new THREE.Mesh(baseGeo, baseMat);
            baseMesh.receiveShadow = true;
            buildingLayer.add(baseMesh);

            if (height > 6) {
                const acBox = new THREE.Mesh(
                    new THREE.BoxGeometry(1.2, 0.8, 1.2),
                    new THREE.MeshStandardMaterial({ color: 0xb0b8c2, roughness: 0.7 })
                );
                acBox.position.set(centerXZ.x + 1, baseY + height + 0.4, centerXZ.z + 1);
                acBox.castShadow = true;
                buildingLayer.add(acBox);
            }

            const railMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.4, roughness: 0.5 });
            for (let i = 0; i < shapePoints.length; i++) {
                const p0 = shapePoints[i];
                const p1 = shapePoints[(i + 1) % shapePoints.length];
                const segLen = p0.distanceTo(p1);
                if (segLen < 0.5) continue;
                const midX = (p0.x + p1.x) / 2;
                // shapePoints.y = -z → 월드 Z = -p.y
                const midZ = -((p0.y + p1.y) / 2);
                const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
                const rail = new THREE.Mesh(new THREE.BoxGeometry(segLen * 0.96, 0.45, 0.05), railMat);
                rail.position.set(midX, baseY + height + 0.22, midZ);
                rail.rotation.y = -angle;
                buildingLayer.add(rail);
            }

            // footprint points: [worldX, worldZ] — worldZ = z_original = -dLat*111320
            buildingFootprints.push({
                points: shapePoints.map(p => [p.x, -p.y]),  // worldZ = -shapeY
                height,
                roofY: baseY + height,
                centerX: centerXZ.x,
                centerZ: centerXZ.z  // worldZ
            });

            built++;
        });

        return built;
    }

    function placeGroundPanel(cellX, cellZ, panelTex) {
        const groundY = sampleTerrainHeight(cellX, cellZ);
        const leg = 3.2;
        const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.5, roughness: 0.25 });
        const frameMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.65, roughness: 0.35 });
        const legMat = new THREE.MeshStandardMaterial({ color: 0xacacac, metalness: 0.55, roughness: 0.45 });

        const group = new THREE.Group();
        group.userData.installMode = 'ground';
        group.position.set(0, 0, 0);

        const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.8), panelMat);
        panel.position.set(cellX, groundY + leg, cellZ);
        panel.rotation.x = -0.35;
        panel.castShadow = true;
        panel.receiveShadow = true;
        group.add(panel);

        [[1.62, 0], [-1.62, 0], [0, 0.93], [0, -0.93]].forEach(([ox, oz], idx) => {
            const isLong = idx < 2;
            const fg = new THREE.BoxGeometry(isLong ? 0.06 : 3.3, 0.14, isLong ? 1.9 : 0.06);
            const frame = new THREE.Mesh(fg, frameMat);
            frame.position.set(cellX + ox, groundY + leg + 0.01, cellZ + oz);
            frame.rotation.x = -0.35;
            group.add(frame);
        });

        [-1.3, 1.3].forEach(dz => {
            const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, leg, 10), legMat);
            legMesh.position.set(cellX, groundY + leg / 2, cellZ + dz);
            legMesh.castShadow = true;
            group.add(legMesh);
        });

        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.0), legMat);
        beam.position.set(cellX, groundY + leg * 0.75, cellZ);
        group.add(beam);

        group.userData.cellX = cellX;
        group.userData.cellZ = cellZ;
        panelLayer.add(group);
        return group;
    }

    function placeRoofPanel(cellX, cellZ, roofY, panelTex) {
        const standH = 0.45;
        const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.5, roughness: 0.25 });
        const frameMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.65, roughness: 0.35 });
        const standMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.5, roughness: 0.5 });

        const group = new THREE.Group();
        group.userData.installMode = 'roof';

        const panel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.2), panelMat);
        panel.position.set(cellX, roofY + standH, cellZ);
        panel.rotation.x = -0.18;
        panel.castShadow = true;
        panel.receiveShadow = true;
        group.add(panel);

        [[0.95, 0.55], [-0.95, 0.55], [0.95, -0.55], [-0.95, -0.55]].forEach(([ox, oz]) => {
            const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, standH, 0.08), standMat);
            stand.position.set(cellX + ox, roofY + standH / 2, cellZ + oz);
            stand.castShadow = true;
            group.add(stand);
        });

        const frame = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.04, 1.24), frameMat);
        frame.position.set(cellX, roofY + standH + 0.06, cellZ);
        frame.rotation.x = -0.18;
        group.add(frame);

        group.userData.cellX = cellX;
        group.userData.cellZ = cellZ;
        panelLayer.add(group);
        return group;
    }

    function rebuildPanels(capacityKW, sceneSizeMeters) {
        clearPanels();
        currentCapacityKW = capacityKW || currentCapacityKW;

        const panelTex = makePanelTexture();
        const moduleKW = 0.55;
        let placed = 0;

        if (installMode === 'roof') {
            if (!buildingFootprints.length) return { placed: 0, mode: 'roof', note: 'no-buildings' };

            buildingFootprints.forEach(fp => {
                const xs = fp.points.map(p => p[0]);
                const zs = fp.points.map(p => p[1]);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minZ = Math.min(...zs), maxZ = Math.max(...zs);
                const margin = 1.0;
                const usableMinX = minX + margin, usableMaxX = maxX - margin;
                const usableMinZ = minZ + margin, usableMaxZ = maxZ - margin;
                if (usableMaxX - usableMinX < 2.2 || usableMaxZ - usableMinZ < 1.4) return;

                const cellW = 2.3, cellD = 1.5;
                const cols = Math.max(1, Math.floor((usableMaxX - usableMinX) / cellW));
                const rows = Math.max(1, Math.floor((usableMaxZ - usableMinZ) / cellD));

                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const cx = usableMinX + cellW * (c + 0.5);
                        const cz = usableMinZ + cellD * (r + 0.5);
                        if (!pointInPolygon(cx, cz, fp.points)) continue;
                        placeRoofPanel(cx, cz, fp.roofY, panelTex);
                        placed++;
                    }
                }
            });

            return { placed, mode: 'roof' };
        }

        const moduleCount = Math.max(4, Math.min(300, Math.round((capacityKW || 100) / moduleKW)));
        const cols = Math.max(2, Math.min(18, Math.round(Math.sqrt(moduleCount))));
        const rows = Math.max(1, Math.round(moduleCount / cols));
        const offsetCol = (cols - 1) / 2;
        const offsetRow = (rows - 1) / 2;

        const legMat = new THREE.MeshStandardMaterial({ color: 0xacacac, metalness: 0.55, roughness: 0.45 });

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const gridCol = Math.round(col - offsetCol);
                const gridRow = Math.round(row - offsetRow);
                const { x: cx, z: cz } = getGroundGridCell(gridCol, gridRow);

                if (findBuildingAt(cx, cz, 1.5)) continue;

                placeGroundPanel(cx, cz, panelTex);
                placed++;
            }
        }

        if (rows > 1 && placed > 0) {
            for (let col = 0; col < cols; col++) {
                const gridCol = Math.round(col - offsetCol);
                const { x: cx } = getGroundGridCell(gridCol, 0);
                if (findBuildingAt(cx, 0, 1.5)) continue;
                const groundY = sampleTerrainHeight(cx, 0);
                const girder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, rows * PANEL_CELL_Z), legMat);
                girder.position.set(cx, groundY + 1.55, 0);
                panelLayer.add(girder);
            }
        }

        return { cols, rows, moduleCount, placed, mode: 'ground' };
    }

    function setInstallMode(mode) {
        installMode = (mode === 'roof') ? 'roof' : 'ground';
        return rebuildPanels(currentCapacityKW, currentSceneSizeMeters);
    }

    function getInstallMode() {
        return installMode;
    }

    function setClickPlacementMode(enabled) {
        clickPlacementMode = !!enabled;
    }

    function onCanvasClick(event) {
        if (!clickPlacementMode || !terrainMesh) return;

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        const panelTex = makePanelTexture();

        if (installMode === 'roof') {
            const buildingHits = raycaster.intersectObjects(buildingLayer.children, false);
            if (!buildingHits.length) {
                return;
            }
            const p = buildingHits[0].point;
            const fp = findBuildingAt(p.x, p.z, 0.1) || buildingFootprints.find(f =>
                Math.hypot(f.centerX - p.x, f.centerZ - p.z) < 40
            );
            const roofY = fp ? fp.roofY : p.y;
            const cellW = 2.3, cellD = 1.5;
            const snapX = Math.round(p.x / cellW) * cellW;
            const snapZ = Math.round(p.z / cellD) * cellD;

            const occupied = panelLayer.children.some(g =>
                g.userData?.installMode === 'roof' &&
                Math.abs(g.userData.cellX - snapX) < 0.05 &&
                Math.abs(g.userData.cellZ - snapZ) < 0.05
            );
            if (occupied) {
                flashClickFeedback(new THREE.Vector3(snapX, roofY, snapZ), false);
                return;
            }

            placeRoofPanel(snapX, snapZ, roofY, panelTex);
            flashClickFeedback(new THREE.Vector3(snapX, roofY, snapZ), true);
            if (window.onSite3DPanelPlaced) window.onSite3DPanelPlaced(snapX, snapZ);
            return;
        }

        const buildingHits = raycaster.intersectObjects(buildingLayer.children, false);
        if (buildingHits.length) {
            flashClickFeedback(buildingHits[0].point, false);
            return;
        }

        const terrainHits = raycaster.intersectObject(terrainMesh, false);
        if (!terrainHits.length) return;

        const p = terrainHits[0].point;
        const snapped = snapToGroundGrid(p.x, p.z);

        if (findBuildingAt(snapped.x, snapped.z, 1.5)) {
            flashClickFeedback(p, false);
            return;
        }

        const occupied = panelLayer.children.some(g =>
            g.userData?.installMode === 'ground' &&
            Math.abs(g.userData.cellX - snapped.x) < 0.05 &&
            Math.abs(g.userData.cellZ - snapped.z) < 0.05
        );
        if (occupied) {
            flashClickFeedback(new THREE.Vector3(snapped.x, sampleTerrainHeight(snapped.x, snapped.z), snapped.z), false);
            return;
        }

        placeGroundPanel(snapped.x, snapped.z, panelTex);
        flashClickFeedback(new THREE.Vector3(snapped.x, sampleTerrainHeight(snapped.x, snapped.z), snapped.z), true);

        if (window.onSite3DPanelPlaced) window.onSite3DPanelPlaced(snapped.x, snapped.z);
    }

    function flashClickFeedback(point, success) {
        const ringGeo = new THREE.RingGeometry(0.4, 0.6, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: success ? 0x10b981 : 0xef4444,
            transparent: true, opacity: 0.8, side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(point.x, point.y + 0.08, point.z);
        scene.add(ring);

        let t = 0;
        const fade = () => {
            t += 0.05;
            ring.scale.setScalar(1 + t * 1.5);
            ringMat.opacity = Math.max(0, 0.8 - t);
            if (t < 1) requestAnimationFrame(fade);
            else { scene.remove(ring); ring.geometry.dispose(); ringMat.dispose(); }
        };
        fade();
    }

    function buildScaleAndCompass(sizeMeters) {
        scaleGroup = new THREE.Group();

        const preset = SCALE_PRESETS[currentScale] || SCALE_PRESETS[100];
        const unit = preset.gridStepM;

        const barY = 0.05;
        const startX = -sizeMeters / 2 + 2;
        const startZ = sizeMeters / 2 - 4;
        const barMat = new THREE.LineBasicMaterial({ color: 0x1a2744, linewidth: 2 });

        const barGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(startX, barY, startZ),
            new THREE.Vector3(startX + unit * 2, barY, startZ)
        ]);
        scaleGroup.add(new THREE.Line(barGeo, barMat));

        [0, unit, unit * 2].forEach(off => {
            const tickGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(startX + off, barY, startZ),
                new THREE.Vector3(startX + off, barY, startZ - Math.max(0.5, sizeMeters * 0.01))
            ]);
            scaleGroup.add(new THREE.Line(tickGeo, barMat));
        });

        const labelScale = Math.max(0.6, sizeMeters * 0.012);
        scaleGroup.add(makeTextSprite(`0m`, startX, labelScale * 1.6, startZ + labelScale * 1.8, labelScale));
        scaleGroup.add(makeTextSprite(`${unit}m`, startX + unit, labelScale * 1.6, startZ + labelScale * 1.8, labelScale));
        scaleGroup.add(makeTextSprite(`${unit * 2}m`, startX + unit * 2, labelScale * 1.6, startZ + labelScale * 1.8, labelScale));
        scaleGroup.add(makeTextSprite(preset.label, startX + unit, labelScale * 3.2, startZ + labelScale * 1.8, labelScale * 1.1));

        scene.add(scaleGroup);

        compassGroup = new THREE.Group();
        const compassX = sizeMeters / 2 - sizeMeters * 0.06 - 2;
        const compassZ = -sizeMeters / 2 + sizeMeters * 0.06 + 2;
        const ringScale = Math.max(0.6, sizeMeters * 0.012);

        const ringGeo = new THREE.RingGeometry(ringScale, ringScale * 1.15, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x1a2744, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(compassX, 0.06, compassZ);
        compassGroup.add(ring);

        // 북쪽 = -Z 좌표계: 화살표를 -Z 방향(compassZ - offset)으로 배치
        const arrowGeo = new THREE.ConeGeometry(ringScale * 0.3, ringScale * 1.2, 12);
        const arrowMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.position.set(compassX, ringScale * 0.6, compassZ - ringScale * 0.6);
        arrow.rotation.x = -Math.PI / 2;
        compassGroup.add(arrow);

        compassGroup.add(makeTextSprite('N', compassX, ringScale * 1.9, compassZ - ringScale * 0.6, ringScale * 0.9));

        scene.add(compassGroup);
    }

    function makeTextSprite(text, x, y, z, scale) {
        const canvas = document.createElement('canvas');
        canvas.width = 160; canvas.height = 80;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#1a2744';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
        ctx.fillStyle = '#1a2744';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(scale * 2.2, scale * 1.1, 1);
        sprite.position.set(x, y, z);
        return sprite;
    }

    function applyScalePreset(scaleKey) {
        currentScale = scaleKey;
        const preset = SCALE_PRESETS[scaleKey] || SCALE_PRESETS[100];
        const baseDist = Math.max(30, currentSceneSizeMeters * 0.55);
        const dist = baseDist * preset.camDistFactor;
        updateCameraPosition(camAngle, dist);
        return preset;
    }

    function updateCameraPosition(angleDeg, distOverride) {
        camAngle = angleDeg;
        const preset = SCALE_PRESETS[currentScale] || SCALE_PRESETS[100];
        const baseDist = Math.max(30, currentSceneSizeMeters * 0.55);
        const dist = (distOverride || (baseDist * preset.camDistFactor)) * zoomFactor;
        const rad = (angleDeg * Math.PI) / 180;
        const height = Math.max(8, dist * 0.55);
        camera.position.set(dist * Math.cos(rad), height, dist * Math.sin(rad));
        camera.lookAt(0, Math.min(8, height * 0.15), 0);
    }

    function onResize() {
        const container = document.getElementById('site3d-map-container') ||
                          document.getElementById('site3d-canvas');
        if (!container || !renderer) return;
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 500;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }

    function animate() {
        requestAnimationFrame(animate);
        if (renderer && scene && camera) renderer.render(scene, camera);
    }

    function computeSunPosition(hour, lat) {
        const hourAngle = (hour - 12) * 15;
        const latRad = (lat * Math.PI) / 180;
        const declRad = (23.45 * Math.PI) / 180 * Math.sin((2 * Math.PI * (172 - 81)) / 365);
        const hourRad = (hourAngle * Math.PI) / 180;

        const elevation = Math.asin(
            Math.sin(latRad) * Math.sin(declRad) +
            Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourRad)
        );
        const azimuth = Math.atan2(
            -Math.sin(hourRad),
            Math.tan(declRad) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(hourRad)
        );
        return { elevation, azimuth };
    }

    function updateSun(hour, lat, irradiance) {
        if (!ensureRenderer()) return null;
        currentLat = lat;
        currentIrradiance = irradiance || currentIrradiance;

        const { elevation, azimuth } = computeSunPosition(hour, lat);
        const dist = Math.max(120, currentSceneSizeMeters * 1.5);
        const elevClamped = Math.max(elevation, 0.04);

        const x = dist * Math.cos(elevClamped) * Math.sin(azimuth);
        const y = dist * Math.sin(elevClamped);
        // 북쪽 = -Z 좌표계: 방위각 0°(북)이 -Z를 향하도록 z 부호를 반전합니다
        const z = -dist * Math.cos(elevClamped) * Math.cos(azimuth);

        if (sunLight) {
            sunLight.position.set(x, y, z);
            sunLight.target.position.set(0, 0, 0);
            scene.add(sunLight.target);

            const intensityFactor = Math.min(1.6, Math.max(0.15, (irradiance / 5) * Math.sin(elevClamped) * 1.4));
            sunLight.intensity = intensityFactor;

            const dayFactor = Math.sin(elevClamped);
            if (scene.fog) scene.fog.color.setRGB(0.6 + 0.3 * dayFactor, 0.75 + 0.2 * dayFactor, 0.95);
            if (skyMesh) {
                skyMesh.material.uniforms.topColor.value.setRGB(0.18 + dayFactor * 0.3, 0.4 + dayFactor * 0.4, 0.65 + dayFactor * 0.3);
                skyMesh.material.uniforms.bottomColor.value.setRGB(0.85 + dayFactor * 0.1, 0.9 + dayFactor * 0.08, 0.96);
            }
            if (hemiLight) hemiLight.intensity = 0.35 + dayFactor * 0.35;
        }
        if (sunMesh) sunMesh.position.set(x, y, z);

        const shadowImpact = estimateShadowImpact(elevClamped, azimuth);
        return { elevation: elevClamped, azimuth, shadowImpact, intensityFactor: sunLight ? sunLight.intensity : 0 };
    }

    function estimateShadowImpact(elevation, azimuth) {
        // 태양 고도 0 이하 = 야간
        if (elevation <= 0) return 100;

        // 태양 방향 벡터 (광선이 태양→지표 방향)
        const sunDirX = -Math.cos(elevation) * Math.sin(azimuth);
        const sunDirY = -Math.sin(elevation);
        const sunDirZ =  Math.cos(elevation) * Math.cos(azimuth);
        const sunDir  = new THREE.Vector3(sunDirX, sunDirY, sunDirZ).normalize();

        if (!panelLayer || panelLayer.children.length === 0) return 0;

        // 패널 그룹의 중심 위치 샘플링 (최대 50개)
        const panels = panelLayer.children.slice(0, 50);
        if (panels.length === 0) return 0;

        const raycaster = new THREE.Raycaster();
        let shadowed = 0;

        // 충돌 검사 대상: 건물 메쉬
        const obstacles = [];
        if (buildingLayer) buildingLayer.traverse(obj => {
            if (obj.isMesh) obstacles.push(obj);
        });
        // 지형 메쉬도 포함
        if (terrainMesh) obstacles.push(terrainMesh);

        panels.forEach(group => {
            // 패널 그룹 중심에서 태양 반대 방향으로 레이캐스트
            const origin = new THREE.Vector3(
                group.userData.cellX || 0,
                (group.userData.roofY || sampleTerrainHeight(group.userData.cellX || 0, group.userData.cellZ || 0)) + 2,
                group.userData.cellZ || 0
            );
            // 광선: 패널에서 태양 방향으로 쏨
            raycaster.set(origin, sunDir.clone().negate());
            raycaster.far = Math.max(200, currentSceneSizeMeters * 2);

            const hits = raycaster.intersectObjects(obstacles, false);
            if (hits.length > 0) shadowed++;
        });

        const shadowRatio = panels.length > 0 ? (shadowed / panels.length) * 100 : 0;

        // 태양 고도 보정: 낮은 태양각에서 그림자 비중이 커짐
        const elevationBonus = Math.max(0, (1 - elevation / (Math.PI / 2)) * 15);
        return Math.round(Math.min(95, shadowRatio + elevationBonus));
    }

    function rotateCamera(angleDeg) {
        updateCameraPosition(angleDeg);
    }

    function zoomCamera(direction) {
        if (!camera) return;
        if (direction === 'in')    zoomFactor = Math.max(ZOOM_MIN, zoomFactor - ZOOM_STEP * 2);
        else if (direction === 'out')  zoomFactor = Math.min(ZOOM_MAX, zoomFactor + ZOOM_STEP * 2);
        else if (direction === 'reset') zoomFactor = 1.0;
        updateCameraPosition(camAngle);
    }

    function setScale(scaleKey) {
        const key = SCALE_PRESETS[scaleKey] ? scaleKey : 100;
        const preset = applyScalePreset(key);
        clearScaleAndCompass();
        buildScaleAndCompass(currentSceneSizeMeters);
        return preset;
    }

    function getScalePresets() {
        return SCALE_PRESETS;
    }

    window.SolarSite3D = {
        initPlaceholder,
        buildTerrainFromElevation,
        buildRealBuildings,
        rebuildPanels,
        placeLocationMarker,
        setClickPlacementMode,
        setInstallMode,
        getInstallMode,
        updateSun,
        rotateCamera,
        zoomCamera,
        setScale,
        getScalePresets,
        ensureRenderer
    };
})();
