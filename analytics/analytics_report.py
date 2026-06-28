#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
부광솔라 방문자 분석 자동 보고서 시스템
- localStorage(bk_solar_analytics) 데이터를 JSON으로 수신
- 15일 주기 이메일 보고서 자동 발송 (EmailJS REST API)
- 실행: python3 analytics_report.py [--send] [--schedule]

사용법:
  python3 analytics_report.py             # 보고서 생성 (발송 안 함)
  python3 analytics_report.py --send      # 즉시 발송
  python3 analytics_report.py --schedule  # 15일 주기 자동 발송
"""

import json, os, sys, time, argparse
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR   = Path(__file__).parent.parent / 'data'
REPORT_DIR = DATA_DIR / 'reports'
META_FILE  = DATA_DIR / 'report_meta.json'
REPORT_DIR.mkdir(parents=True, exist_ok=True)

EMAILJS_SERVICE_ID  = 'service_23hd17n'
EMAILJS_TEMPLATE_ID = 'template_1h4x2yq'
EMAILJS_PUBLIC_KEY  = 'EKZKrQa8dovHr1AI9'
TO_EMAIL            = 'bk_solar@naver.com'
INTERVAL_DAYS       = 15


def load_analytics():
    """data/blog_cache 또는 외부 JSON에서 방문자 데이터 로드"""
    cache_file = DATA_DIR / 'analytics_cache.json'
    if cache_file.exists():
        with open(cache_file, encoding='utf-8') as f:
            return json.load(f)
    return {'sessions': [], 'events': []}


def build_report(data):
    """분석 데이터 → 보고서 텍스트 생성"""
    sessions = data.get('sessions', [])
    events   = data.get('events', [])
    now      = datetime.now()

    # 지표 집계
    seg_cnt   = {}
    view_cnt  = {}
    chat_cnt  = 0
    profit_cnt= 0

    for s in sessions:
        yolo = s.get('yolo') or {}
        seg  = yolo.get('segment', 'unknown')
        seg_cnt[seg] = seg_cnt.get(seg, 0) + 1

    for e in events:
        t = e.get('type', '')
        v = e.get('value', '')
        if t == 'view_switch':     view_cnt[v] = view_cnt.get(v, 0) + 1
        if t == 'profit_analysis': profit_cnt  += 1
        if 'chat' in t:            chat_cnt    += 1

    top_view = max(view_cnt, key=view_cnt.get) if view_cnt else '(없음)'
    seg_str  = '\n'.join(f'  {k}: {v}건' for k,v in sorted(seg_cnt.items(), key=lambda x:-x[1])) or '  (없음)'
    view_str = '\n'.join(f'  {k}: {v}회' for k,v in sorted(view_cnt.items(), key=lambda x:-x[1])) or '  (없음)'

    return f"""━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 부광솔라 홈페이지 방문자 분석 보고서
발행일: {now.strftime('%Y년 %m월 %d일 %H:%M')} | 주기: {INTERVAL_DAYS}일
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【 핵심 지표 】
• 총 세션 수: {len(sessions):,}건
• AI 챗봇 이용: {chat_cnt}회
• 수익분석 실행: {profit_cnt}회
• 가장 많이 본 화면: {top_view}

【 방문자 유형 (YOLO 분석) 】
{seg_str}

【 화면별 조회 현황 】
{view_str}

【 종합 의견 】
{'✅ 수익분석 수요 높음 → 통합수익분석 UX 점검 권장' if profit_cnt > 5 else '📌 수익분석 유도 강화 필요'}
{'✅ 챗봇 활용도 좋음 → 답변 품질 유지' if chat_cnt > 10 else '📌 AI 챗봇 노출 강화 권장'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
부광솔라 | 042-584-5017 | bk_solar@naver.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""


def send_email(report_text):
    """EmailJS REST API로 이메일 발송"""
    try:
        import urllib.request
        payload = json.dumps({
            'service_id':  EMAILJS_SERVICE_ID,
            'template_id': EMAILJS_TEMPLATE_ID,
            'user_id':     EMAILJS_PUBLIC_KEY,
            'template_params': {
                'from_name': '부광솔라 AI 분석 시스템',
                'reply_to':  'bk_solar@naver.com',
                'message':   report_text,
                'to_email':  TO_EMAIL,
            }
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://api.emailjs.com/api/v1.0/email/send',
            data=payload,
            headers={'Content-Type': 'application/json', 'origin': 'http://localhost'}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f'✅ 이메일 발송 성공: {r.status}')
            return True
    except Exception as e:
        print(f'❌ 이메일 발송 실패: {e}')
        return False


def save_meta(sent=False):
    now = datetime.now()
    meta = {
        'last_run':     now.isoformat(),
        'last_sent':    now.isoformat() if sent else None,
        'next_send':    (now + timedelta(days=INTERVAL_DAYS)).isoformat(),
        'interval_days': INTERVAL_DAYS
    }
    with open(META_FILE, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def needs_send():
    if not META_FILE.exists():
        return True
    with open(META_FILE) as f:
        meta = json.load(f)
    last = meta.get('last_sent')
    if not last:
        return True
    return datetime.now() > datetime.fromisoformat(meta['next_send'])


def run(send=False, schedule=False):
    if schedule:
        print(f'[스케줄 모드] {INTERVAL_DAYS}일 주기 자동 발송 시작')
        while True:
            if needs_send():
                data    = load_analytics()
                report  = build_report(data)
                success = send_email(report)
                save_meta(sent=success)
                ts = datetime.now().strftime('%Y-%m-%d %H:%M')
                print(f'[{ts}] 발송 {"성공" if success else "실패"}')
            time.sleep(3600)  # 1시간마다 체크
        return

    data   = load_analytics()
    report = build_report(data)

    # 파일 저장
    fname = REPORT_DIR / f'report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.txt'
    with open(fname, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f'보고서 저장: {fname}')
    print(report)

    if send:
        success = send_email(report)
        save_meta(sent=success)
    else:
        save_meta(sent=False)
        print('\n이메일 발송하려면 --send 옵션을 추가하세요.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='부광솔라 분석 보고서')
    parser.add_argument('--send',     action='store_true', help='즉시 이메일 발송')
    parser.add_argument('--schedule', action='store_true', help='15일 주기 자동 발송')
    args = parser.parse_args()
    run(send=args.send, schedule=args.schedule)
