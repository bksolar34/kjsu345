"""
============================================================
  부광솔라 백엔드 API 서버 v1.0
  FastAPI 기반 | 분석 데이터 수신 및 저장
============================================================
  실행: python analytics_api.py
  의존성: pip install fastapi uvicorn aiofiles
============================================================
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import json
import os
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict, Counter
import statistics

# ─── 앱 초기화 ─────────────────────────────────────────
app = FastAPI(
    title="부광솔라 분석 API",
    description="자체 방문자 분석 백엔드",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── 데이터 저장 경로 ────────────────────────────────────
DATA_DIR = Path("./data")
DATA_DIR.mkdir(exist_ok=True)
ANALYTICS_FILE = DATA_DIR / "analytics.jsonl"
SESSIONS_FILE = DATA_DIR / "sessions.json"


# ─── 인메모리 집계 버퍼 ─────────────────────────────────
class AnalyticsBuffer:
    """실시간 집계를 위한 인메모리 버퍼"""

    def __init__(self):
        self.sessions = {}          # session_id → 세션 데이터
        self.event_counts = Counter()
        self.segment_counts = Counter()
        self.section_times = defaultdict(list)
        self.hourly_visits = defaultdict(int)
        self.device_counts = Counter()
        self.today_visitors = set()

    def ingest(self, payload: dict):
        sid = payload.get("session_id")
        if not sid:
            return

        # 세션 저장
        self.sessions[sid] = {
            "device": payload.get("device"),
            "referrer": payload.get("referrer"),
            "duration": payload.get("duration"),
            "scroll_max": payload.get("scroll_max"),
            "yolo": payload.get("yolo"),
            "ts": payload.get("ts"),
        }

        # 집계
        self.today_visitors.add(sid)
        seg = payload.get("yolo", {}).get("segment", "general")
        self.segment_counts[seg] += 1
        self.device_counts[payload.get("device", "unknown")] += 1

        for evt in payload.get("events", []):
            self.event_counts[evt.get("type", "unknown")] += 1

        for sec_id, t in payload.get("sections", {}).items():
            self.section_times[sec_id].append(t)

        hour = datetime.now().hour
        self.hourly_visits[hour] += 1

    def summary(self):
        section_avg = {
            k: round(statistics.mean(v), 1)
            for k, v in self.section_times.items() if v
        }
        return {
            "today_visitors": len(self.today_visitors),
            "total_sessions": len(self.sessions),
            "segment_distribution": dict(self.segment_counts),
            "device_distribution": dict(self.device_counts),
            "top_events": self.event_counts.most_common(10),
            "section_avg_time": section_avg,
            "hourly_visits": dict(self.hourly_visits),
            "updated_at": datetime.now().isoformat()
        }


buffer = AnalyticsBuffer()


# ─── 엔드포인트: 분석 데이터 수신 ────────────────────────
@app.post("/api/analytics")
async def receive_analytics(request: Request):
    """프론트엔드에서 전송하는 세션 이벤트 수신"""
    try:
        body = await request.body()
        if not body:
            return JSONResponse({"status": "empty"})

        payload = json.loads(body)
        buffer.ingest(payload)

        # 파일에 append (JSONL 형식)
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        with open(ANALYTICS_FILE, "a", encoding="utf-8") as f:
            f.write(line)

        return JSONResponse({"status": "ok"})

    except json.JSONDecodeError:
        return JSONResponse({"status": "invalid_json"}, status_code=400)
    except Exception as e:
        print(f"[Analytics Error] {e}")
        return JSONResponse({"status": "error"}, status_code=500)


# ─── 엔드포인트: 대시보드 요약 ──────────────────────────
@app.get("/api/analytics/summary")
async def get_summary():
    """집계 요약 (관리자 대시보드용)"""
    return JSONResponse(buffer.summary())


# ─── 엔드포인트: 히트맵 데이터 ──────────────────────────
@app.get("/api/analytics/heatmap")
async def get_heatmap(limit: int = 500):
    """히트맵 좌표 데이터 반환"""
    points = []
    try:
        if ANALYTICS_FILE.exists():
            with open(ANALYTICS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                        for p in d.get("heatmap", [])[:20]:
                            points.append(p)
                            if len(points) >= limit:
                                break
                    except:
                        pass
                    if len(points) >= limit:
                        break
    except Exception as e:
        print(f"[Heatmap Error] {e}")

    return JSONResponse({"points": points, "count": len(points)})


# ─── 엔드포인트: YOLO 세그먼트 분석 ────────────────────
@app.get("/api/analytics/segments")
async def get_segments():
    """YOLO 분류 결과 - 사용자 세그먼트 분포"""
    segments = defaultdict(lambda: {"count": 0, "avg_duration": [], "top_sections": Counter()})

    try:
        if ANALYTICS_FILE.exists():
            with open(ANALYTICS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                        seg = d.get("yolo", {}).get("segment", "general")
                        segments[seg]["count"] += 1
                        dur = d.get("duration")
                        if dur:
                            segments[seg]["avg_duration"].append(dur)
                        for sec_id in d.get("sections", {}):
                            segments[seg]["top_sections"][sec_id] += 1
                    except:
                        pass
    except Exception as e:
        print(f"[Segments Error] {e}")

    result = {}
    for seg, data in segments.items():
        durs = data["avg_duration"]
        result[seg] = {
            "count": data["count"],
            "avg_duration_sec": round(statistics.mean(durs), 1) if durs else 0,
            "top_sections": dict(data["top_sections"].most_common(3))
        }

    return JSONResponse(result)


# ─── 엔드포인트: 이탈 예측 ──────────────────────────────
@app.get("/api/analytics/churn")
async def get_churn_analysis():
    """이탈 위험 세션 분석"""
    churn_sessions = []
    total = 0

    try:
        if ANALYTICS_FILE.exists():
            with open(ANALYTICS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                        total += 1
                        events = d.get("events", [])
                        churn_signals = [e for e in events if e.get("type") == "churn_signal"]
                        dur = d.get("duration", 0) or 0
                        scroll = d.get("scroll_max", 0) or 0

                        # 이탈 위험 판단
                        risk = 0
                        if churn_signals:
                            risk += len(churn_signals) * 2
                        if dur < 30:
                            risk += 3
                        if scroll < 25:
                            risk += 2

                        if risk >= 4:
                            churn_sessions.append({
                                "session_id": d.get("session_id"),
                                "risk_score": risk,
                                "duration": dur,
                                "scroll_max": scroll,
                                "device": d.get("device"),
                                "segment": d.get("yolo", {}).get("segment")
                            })
                    except:
                        pass
    except Exception as e:
        print(f"[Churn Error] {e}")

    churn_rate = round(len(churn_sessions) / total * 100, 1) if total else 0

    return JSONResponse({
        "total_sessions": total,
        "churn_sessions": len(churn_sessions),
        "churn_rate_pct": churn_rate,
        "high_risk_sessions": sorted(churn_sessions, key=lambda x: -x["risk_score"])[:10]
    })


# ─── 디렉토리 구조 ──────────────────────────────────────────
# 이 파일(analytics_api.py)은 backend/ 폴더 안에 있고, 그 한 단계 위가
# 프로젝트 루트입니다. index.html, css/, js/, assets/ 가 모두 이 루트에
# 있는 구조이므로(서버 배포 시 바로 가동되도록 frontend/ 폴더를 없애고
# 루트로 옮긴 구조), 어디서 이 스크립트를 실행하든 항상 올바른 절대경로를
# 계산하도록 __file__ 기준으로 ROOT_DIR을 구합니다.
ROOT_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT_DIR / "assets"


# ─── 엔드포인트: assets 자동 스캔 (이미지/특허/영상 폴더에 파일만 넣으면 자동 노출) ────
ASSET_CATEGORIES = {
    "images": {
        "dir": ASSETS_DIR / "images",
        "exts": {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    },
    "patents": {
        "dir": ASSETS_DIR / "patents",
        "exts": {".jpg", ".jpeg", ".png", ".webp"}
    },
    "videos": {
        "dir": ASSETS_DIR / "videos",
        "exts": {".mp4", ".webm", ".mov"}
    }
}


def _scan_category(category: str):
    """assets/<category> 폴더를 스캔해 파일 목록을 만든다.
    파일명을 그대로 표시 라벨로 사용하되, 확장자를 제거하고
    언더스코어/하이픈을 공백으로 바꿔 사람이 읽기 좋은 형태로 가공한다.
    수정시각(mtime) 내림차순으로 정렬해 최신 업로드가 먼저 보이게 한다."""
    cfg = ASSET_CATEGORIES.get(category)
    if not cfg:
        return []

    folder: Path = cfg["dir"]
    if not folder.exists():
        return []

    items = []
    for f in folder.iterdir():
        if not f.is_file():
            continue
        if f.suffix.lower() not in cfg["exts"]:
            continue
        try:
            stat = f.stat()
        except OSError:
            continue

        label = f.stem.replace("_", " ").replace("-", " ").strip()
        items.append({
            "filename": f.name,
            "url": f"./assets/{category}/{f.name}",
            "label": label or f.name,
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
        })

    items.sort(key=lambda x: x["modified_at"], reverse=True)
    return items


@app.get("/api/assets/{category}")
async def list_assets(category: str):
    """카테고리(images/patents/videos)의 실제 파일 목록을 반환한다.
    프론트엔드는 이 응답으로 갤러리/특허/영상 목록을 동적으로 구성하므로,
    서버의 assets/<category> 폴더에 파일을 추가/삭제하기만 하면
    코드 수정 없이 화면에 즉시 반영된다."""
    if category not in ASSET_CATEGORIES:
        raise HTTPException(status_code=404, detail=f"알 수 없는 카테고리: {category}")

    items = _scan_category(category)
    return JSONResponse({"category": category, "count": len(items), "items": items})


@app.get("/api/assets")
async def list_all_assets():
    """모든 카테고리를 한 번에 반환 (초기 로딩 시 호출 1회로 충분)."""
    return JSONResponse({
        cat: _scan_category(cat) for cat in ASSET_CATEGORIES
    })


# ─── 엔드포인트: 프론트엔드 정적 파일 서빙 ────────────────────────────
# 주의: API 라우트(/api/...)들을 먼저 등록한 뒤 마지막에 정적 파일을
# 마운트해야 합니다. FastAPI/Starlette는 라우트를 등록 순서대로 매칭하므로,
# 정적 마운트가 먼저 등록되면 /api/* 요청까지 정적 파일 핸들러가 가로채려
# 시도해 404가 날 수 있습니다.

@app.get("/")
async def root():
    """루트 접속 시 index.html을 직접 반환합니다.
    (StaticFiles의 html=True 옵션도 이를 처리하지만, 루트 경로를
    명시적으로 한 번 더 핸들링해 어떤 배포 환경에서도 안정적으로 동작하게 합니다.)"""
    index_path = ROOT_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="index.html을 찾을 수 없습니다.")
    return FileResponse(str(index_path))


# css/, js/, assets/ 를 각각 그 이름 그대로의 URL 경로에 마운트합니다.
# index.html이 './css/style.css', './js/main.js', './assets/...' 같은
# 상대경로를 그대로 쓰므로, 이 마운트들이 있어야 브라우저 요청이 정상 응답됩니다.
if (ROOT_DIR / "css").exists():
    app.mount("/css", StaticFiles(directory=str(ROOT_DIR / "css")), name="css")
if (ROOT_DIR / "js").exists():
    app.mount("/js", StaticFiles(directory=str(ROOT_DIR / "js")), name="js")
if (ROOT_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(ROOT_DIR / "assets")), name="assets")


# ─── 실행 ────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  부광솔라 백엔드 서버 시작")
    print(f"  루트 디렉토리: {ROOT_DIR}")
    print("  http://localhost:8000")
    print("  API 문서: http://localhost:8000/docs")
    print("=" * 50)
    uvicorn.run("analytics_api:app", host="0.0.0.0", port=8000, reload=True)
