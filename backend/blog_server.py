#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
부광솔라 블로그 데이터 API 서버
- /api/blog/latest      : 최신 크롤링 데이터 JSON 반환
- /api/blog/search      : 키워드 검색
- /api/blog/crawl       : 즉시 크롤링 트리거
- /api/blog/status      : 크롤링 상태

실행: python3 blog_server.py --port 5001
"""

import os
import sys
import json
import threading
from pathlib import Path
from datetime import datetime

try:
    from flask import Flask, jsonify, request
    from flask_cors import CORS
except ImportError:
    os.system('pip install flask flask-cors --break-system-packages -q')
    from flask import Flask, jsonify, request
    from flask_cors import CORS

# blog_crawler 임포트
sys.path.insert(0, str(Path(__file__).parent))
from blog_crawler import run_crawler, DATA_DIR, SCHEDULE_DAYS

app = Flask(__name__)
CORS(app)

API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

def load_latest() -> dict:
    latest = DATA_DIR / 'latest.json'
    if latest.exists():
        with open(latest, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'posts': [], 'updated_at': None}


@app.route('/api/blog/latest', methods=['GET'])
def get_latest():
    """최신 블로그 데이터 반환"""
    data = load_latest()
    return jsonify({
        'success': True,
        'updated_at': data.get('updated_at'),
        'post_count': len(data.get('posts', [])),
        'posts': data.get('posts', [])
    })


@app.route('/api/blog/search', methods=['GET'])
def search_posts():
    """키워드 검색"""
    query = request.args.get('q', '').lower()
    if not query:
        return jsonify({'success': False, 'error': 'q 파라미터 필요'}), 400

    data = load_latest()
    results = []
    for post in data.get('posts', []):
        text = (post.get('title','') + post.get('description','') + post.get('content','')).lower()
        if query in text:
            results.append(post)

    return jsonify({
        'success': True,
        'query': query,
        'count': len(results),
        'posts': results[:10]
    })


@app.route('/api/blog/crawl', methods=['POST'])
def trigger_crawl():
    """크롤링 즉시 트리거 (비동기)"""
    force = request.json.get('force', False) if request.json else False

    def do_crawl():
        run_crawler(api_key=API_KEY, force=force)

    t = threading.Thread(target=do_crawl, daemon=True)
    t.start()

    return jsonify({
        'success': True,
        'message': '크롤링 시작됨 (백그라운드)',
        'force': force
    })


@app.route('/api/blog/status', methods=['GET'])
def get_status():
    """크롤링 상태"""
    meta_path = DATA_DIR / 'update_meta.json'
    if meta_path.exists():
        with open(meta_path) as f:
            meta = json.load(f)
        return jsonify({'success': True, **meta})
    return jsonify({'success': False, 'message': '아직 크롤링 없음'})


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5001)
    parser.add_argument('--api-key', default=API_KEY)
    args = parser.parse_args()
    API_KEY = args.api_key or API_KEY
    print(f'서버 시작: http://localhost:{args.port}')
    app.run(host='0.0.0.0', port=args.port, debug=False)
