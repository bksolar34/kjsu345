/**
 * ============================================================
 *  부광솔라 동적 Assets 로더 v1.0
 * ============================================================
 *  - 백엔드(/api/assets/<category>)가 실제 assets 폴더를 스캔한
 *    결과를 받아 갤러리/특허/영상 목록을 구성합니다.
 *  - 백엔드가 꺼져 있거나 응답이 없으면(정적 호스팅 환경 등)
 *    기존 방식대로 추측 가능한 파일명을 하나씩 시도하는
 *    폴백 로직으로 자동 전환되어 화면이 비지 않습니다.
 *  - 운영자는 frontend/assets/{images,patents,videos} 폴더에
 *    파일을 넣고 빼는 것만으로 화면 갱신이 끝납니다(코드 수정 불필요).
 * ============================================================
 */

(function () {
    'use strict';

    const API_BASE = (() => {
        // 같은 origin에 백엔드가 떠 있는 경우(권장 배포 형태) 상대경로로 충분합니다.
        // 별도 호스트에서 백엔드를 운영한다면 이 값을 절대경로로 바꿔주세요.
        return '';
    })();

    let cache = null;

    /**
     * 모든 카테고리(images/patents/videos)를 한 번에 조회합니다.
     * 실패하면 null을 반환하고, 호출부는 폴백 로직으로 넘어갑니다.
     */
    async function fetchAllAssets() {
        if (cache) return cache;
        try {
            const res = await fetch(`${API_BASE}/api/assets`, { cache: 'no-store' });
            if (!res.ok) throw new Error('assets API 응답 오류');
            const data = await res.json();
            cache = data;
            return data;
        } catch (e) {
            console.warn('[AssetsLoader] 백엔드 미응답 — 폴백 모드로 전환:', e.message);
            return null;
        }
    }

    /**
     * 갤러리(시공 사례) 이미지 목록을 반환합니다.
     * 우선 백엔드 스캔 결과를 쓰고, 실패 시 1~31.jpg / b1~b16.jpg 추측 방식으로 폴백합니다.
     */
    async function getGalleryImages() {
        const all = await fetchAllAssets();
        if (all && Array.isArray(all.images) && all.images.length) {
            return all.images.map(it => ({ src: it.url, label: it.label }));
        }
        // 폴백: 기존 추측 방식
        const fallback = [];
        for (let i = 1; i <= 31; i++) fallback.push({ src: `./assets/images/${i}.jpg`, label: `사례 ${i}` });
        for (let i = 1; i <= 16; i++) fallback.push({ src: `./assets/images/b${i}.jpg`, label: `사례 B${i}` });
        return fallback;
    }

    /**
     * 특허 인증서 이미지 목록을 반환합니다.
     * 우선 백엔드 스캔 결과를 쓰고, 실패 시 기존 고정 파일명 6종으로 폴백합니다.
     */
    async function getPatentImages() {
        const all = await fetchAllAssets();
        if (all && Array.isArray(all.patents) && all.patents.length) {
            return all.patents.map(it => ({ src: it.url, label: it.label }));
        }
        return [
            { src: './assets/patents/건물일체형특허증.png',              label: '건물일체형특허증' },
            { src: './assets/patents/노지스마트팜영농형태양광특허증.png', label: '노지스마트팜영농형태양광특허증' },
            { src: './assets/patents/스마트팜태양광온실특허증.jpg',       label: '스마트팜태양광온실특허증' },
            { src: './assets/patents/영농형태양광특허증.jpg',             label: '영농형태양광특허증' },
            { src: './assets/patents/전력원격감시제어특허증.png',          label: '전력원격감시제어특허증' }
        ];
    }

    /**
     * 기술 영상 목록을 반환합니다.
     * 우선 백엔드 스캔 결과를 쓰고, 실패 시 기존 고정 파일명 2종으로 폴백합니다.
     */
    async function getVideoList() {
        const all = await fetchAllAssets();
        if (all && Array.isArray(all.videos) && all.videos.length) {
            return all.videos.map(it => ({ src: it.url, label: it.label }));
        }
        return [
            { src: './assets/videos/스마트팜영농형태양광 구조물.mp4', label: '영농형 전용 구조물' },
            { src: './assets/videos/전력원격감시제어 테스트영상.mp4',  label: 'RTU 모니터링' }
        ];
    }

    /** 캐시를 비워 다음 조회 시 백엔드를 다시 호출하게 합니다. */
    function invalidateCache() {
        cache = null;
    }

    window.SolarAssets = {
        getGalleryImages,
        getPatentImages,
        getVideoList,
        invalidateCache
    };
})();
