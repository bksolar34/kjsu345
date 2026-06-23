/**
 * ============================================================
 *  부광솔라 자체 AI 방문자 분석 시스템 v1.0
 *  YOLO(You Only Look Once) 방식 실시간 행동 분석 알고리즘
 * ============================================================
 *  - 외부 서비스 없이 자체 수집·분석
 *  - 세션 단위 행동 추적 (클릭, 스크롤, 체류시간, 전환)
 *  - 사용자 세그먼트 자동 분류 (AI Clustering)
 *  - 히트맵 데이터 수집
 *  - backend/analytics_api.py 로 데이터 전송
 * ============================================================
 */

(function () {
    'use strict';

    /* ─── 설정 ──────────────────────────────────────── */
    const CONFIG = {
        endpoint: '/api/analytics',     // 백엔드 API 엔드포인트
        batchInterval: 10000,           // 10초마다 일괄 전송
        heatmapSample: 0.3,            // 30% 샘플링
        debug: false                    // 개발 시 true
    };

    /* ─── 세션 초기화 ────────────────────────────────── */
    const SESSION = {
        id: genSessionId(),
        start: Date.now(),
        page: location.pathname,
        referrer: document.referrer || 'direct',
        ua: navigator.userAgent,
        lang: navigator.language,
        screen: `${screen.width}x${screen.height}`,
        device: detectDevice(),
        events: [],
        heatmap: [],
        scrollDepths: new Set(),
        sections: {},           // 섹션별 체류 시간
        conversions: []
    };

    /* ─── YOLO 실시간 분류기 ─────────────────────────── */
    /**
     * YOLO 방식: 매 이벤트마다 즉시(One-Pass) 사용자 인텐트를 분류.
     * 딥러닝 YOLO의 "한 번에 전체를 보고 즉시 판단" 철학을 행동 분석에 적용.
     * 누적 점수로 세그먼트 실시간 업데이트.
     */
    const YOLO_CLASSIFIER = {
        scores: {
            investor: 0,       // 투자자 (수익분석 관심)
            farmer: 0,         // 농업인 (스마트팜 관심)
            developer: 0,      // 개발사/시공사
            researcher: 0,     // 연구자/학생
            general: 0         // 일반 방문자
        },

        // 즉시 분류 함수 (이벤트 발생 즉시 호출)
        classify(event) {
            const { type, target, data } = event;

            // 통합수익분석 뷰 진입/실행 → 투자자 신호
            if (target === 'revenue' || type === 'profit_analysis' ||
                type === 'geocode_revenue') {
                this.scores.investor += 3;
                this.scores.developer += 1;
            }

            // 입지분석 뷰 진입/실행 → 개발사 신호
            if (target === 'site3d' || type === 'geocode_site3d') {
                this.scores.developer += 3;
                this.scores.researcher += 1;
            }

            // 기술·특허 뷰 → 연구자/개발사 신호
            if (target === 'tech' || type === 'video_open') {
                this.scores.researcher += 2;
                this.scores.developer += 2;
            }

            // 회사소개 뷰 체류 → 농업인 신호
            if (target === 'about' && type === 'view_switch') {
                this.scores.farmer += 2;
            }

            // 문의 뷰 진입/제출 → 고관심 신호 (전체 가중)
            if (target === 'contact' || type === 'form_submit') {
                this.scores.investor += 2;
                this.scores.farmer += 2;
                this.scores.developer += 2;
            }

            // CSV 다운로드 → 투자자/개발사
            if (type === 'csv_download') {
                this.scores.investor += 4;
                this.scores.developer += 3;
            }

            // 긴 체류 → 연구자
            if (type === 'long_stay') {
                this.scores.researcher += 3;
            }

            // general 기준점
            this.scores.general = 1;

            return this.getSegment();
        },

        getSegment() {
            const s = this.scores;
            const max = Math.max(...Object.values(s));
            if (max < 2) return 'general';
            return Object.keys(s).find(k => s[k] === max) || 'general';
        },

        getReport() {
            return {
                segment: this.getSegment(),
                scores: { ...this.scores },
                intent: this._getIntent()
            };
        },

        _getIntent() {
            const seg = this.getSegment();
            const map = {
                investor: '투자 수익 검토',
                farmer: '스마트팜 도입 관심',
                developer: '시공·개발 파트너십',
                researcher: '기술 연구/학습',
                general: '일반 정보 탐색'
            };
            return map[seg] || '알 수 없음';
        }
    };

    /* ─── 스크롤 깊이 추적 ───────────────────────────── */
    const scrollObserver = () => {
        const total = document.body.scrollHeight - window.innerHeight;
        if (total <= 0) return;
        const pct = Math.round((window.scrollY / total) * 100);
        const milestone = Math.floor(pct / 25) * 25;
        if (milestone > 0 && !SESSION.scrollDepths.has(milestone)) {
            SESSION.scrollDepths.add(milestone);
            track('scroll_depth', null, { depth: milestone });
        }
    };

    /* ─── 섹션 체류시간 IntersectionObserver ─────────── */
    const sectionTimes = {};
    const sectionObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const id = entry.target.id;
            if (!id) return;
            if (entry.isIntersecting) {
                sectionTimes[id] = Date.now();
                track('section_view', id, {});
                YOLO_CLASSIFIER.classify({ type: 'section_view', target: id });
            } else if (sectionTimes[id]) {
                const duration = Math.round((Date.now() - sectionTimes[id]) / 1000);
                SESSION.sections[id] = (SESSION.sections[id] || 0) + duration;
                delete sectionTimes[id];
                if (duration > 30) track('long_stay', id, { duration });
            }
        });
    }, { threshold: 0.3 });

    document.querySelectorAll('section[id]').forEach(s => sectionObserver.observe(s));

    /* ─── 히트맵 수집 ────────────────────────────────── */
    document.addEventListener('click', e => {
        if (Math.random() > CONFIG.heatmapSample) return;
        SESSION.heatmap.push({
            x: Math.round(e.clientX / window.innerWidth * 1000) / 10,  // % 로 저장
            y: Math.round(e.clientY / window.innerHeight * 1000) / 10,
            t: Date.now() - SESSION.start,
            el: e.target.tagName + (e.target.id ? '#' + e.target.id : '')
        });
        track('click', e.target.id || e.target.className || e.target.tagName, {});
    });

    /* ─── 스크롤 이벤트 ──────────────────────────────── */
    let scrollTimer;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(scrollObserver, 200);
    }, { passive: true });

    /* ─── 이탈 예측 (Churn Prediction) ─────────────── */
    let mouseLeaveCount = 0;
    document.addEventListener('mouseleave', e => {
        if (e.clientY <= 0) {
            mouseLeaveCount++;
            if (mouseLeaveCount >= 2) {
                track('churn_signal', 'header_exit', { count: mouseLeaveCount });
            }
        }
    });

    /* ─── 페이지 이탈 시 최종 전송 ───────────────────── */
    window.addEventListener('beforeunload', () => {
        SESSION.duration = Math.round((Date.now() - SESSION.start) / 1000);
        SESSION.yolo = YOLO_CLASSIFIER.getReport();
        SESSION.scrollMax = Math.max(...[...SESSION.scrollDepths], 0);
        flush(true);
    });

    /* ─── 이벤트 큐 & 배치 전송 ─────────────────────── */
    let eventQueue = [];

    function track(type, target, data) {
        const evt = {
            type, target, data,
            ts: Date.now() - SESSION.start,
            seg: YOLO_CLASSIFIER.getSegment()
        };
        SESSION.events.push(evt);
        eventQueue.push(evt);
        YOLO_CLASSIFIER.classify({ type, target, data });
        if (CONFIG.debug) console.log('[Analytics]', evt);
    }

    setInterval(() => flush(), CONFIG.batchInterval);

    async function flush(final = false) {
        if (!eventQueue.length && !final) return;
        const payload = {
            session_id: SESSION.id,
            device: SESSION.device,
            referrer: SESSION.referrer,
            screen: SESSION.screen,
            lang: SESSION.lang,
            events: eventQueue.splice(0),
            heatmap: final ? SESSION.heatmap : [],
            sections: final ? SESSION.sections : {},
            yolo: YOLO_CLASSIFIER.getReport(),
            duration: final ? Math.round((Date.now() - SESSION.start) / 1000) : null,
            scroll_max: final ? Math.max(...[...SESSION.scrollDepths], 0) : null,
            ts: new Date().toISOString()
        };

        try {
            if (navigator.sendBeacon && final) {
                navigator.sendBeacon(CONFIG.endpoint, JSON.stringify(payload));
            } else {
                await fetch(CONFIG.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive: true
                });
            }
        } catch (e) {
            // 오프라인/에러 시 로컬 저장
            try {
                const stored = JSON.parse(localStorage.getItem('_bk_queue') || '[]');
                stored.push(payload);
                localStorage.setItem('_bk_queue', JSON.stringify(stored.slice(-20)));
            } catch (_) {}
        }
    }

    /* ─── 유틸리티 ───────────────────────────────────── */
    function genSessionId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    }

    function detectDevice() {
        const ua = navigator.userAgent;
        if (/Mobi|Android/i.test(ua)) return 'mobile';
        if (/Tablet|iPad/i.test(ua)) return 'tablet';
        return 'desktop';
    }

    /* ─── 공개 API ───────────────────────────────────── */
    window.SolarAnalytics = {
        track,
        getSegment: () => YOLO_CLASSIFIER.getSegment(),
        getReport: () => YOLO_CLASSIFIER.getReport(),
        getSession: () => SESSION
    };

    // 초기 페이지뷰 이벤트
    track('pageview', location.pathname, {
        title: document.title,
        referrer: document.referrer
    });

    if (CONFIG.debug) {
        console.log('[SolarAnalytics] 초기화 완료 | 세션:', SESSION.id);
    }

})();
