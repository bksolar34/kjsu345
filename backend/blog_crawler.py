#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
부광솔라 블로그 크롤러 v2.0
blog.naver.com/bk_solar  →  JSON / CSV / Text 저장

실행 방법:
  python3 blog_crawler.py                # 1회 실행
  python3 blog_crawler.py --schedule     # 15일 주기 스케줄 실행
  python3 blog_crawler.py --force        # 강제 새로고침
  python3 blog_crawler.py --api-key YOUR_KEY  # API 키 직접 전달

크롤링 전략:
  1단계: RSS  https://rss.blog.naver.com/bk_solar.xml  (직접 파싱)
  2단계: 실패 시 Claude API web_search 도구로 블로그 내용 수집
  3단계: 개별 포스트 링크 → BeautifulSoup 크롤링 (성공 시)
  4단계: 결과를 JSON, CSV, Text로 저장 + 타임스탬프 관리
============================================================
"""

import os
import sys
import json
import csv
import time
import logging
import argparse
import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    os.system('pip install requests beautifulsoup4 lxml --break-system-packages -q')
    import requests
    from bs4 import BeautifulSoup

# ──────────────────────────────────────────────
#  설정
# ──────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.parent
DATA_DIR   = BASE_DIR / 'data' / 'blog_cache'
LOG_DIR    = BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)

BLOG_ID    = 'bk_solar'
RSS_URL    = f'https://rss.blog.naver.com/{BLOG_ID}.xml'
BLOG_URL   = f'https://blog.naver.com/{BLOG_ID}'
SCHEDULE_DAYS = 15          # 발송 주기
MAX_POSTS  = 30             # 최대 수집 포스트 수

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_DIR / 'crawler.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger('BKCrawler')

# ──────────────────────────────────────────────
#  HTTP 세션 (브라우저 위장)
# ──────────────────────────────────────────────
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/125.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://blog.naver.com/',
    })
    return s

SESSION = make_session()

# ──────────────────────────────────────────────
#  1단계: RSS 직접 파싱
# ──────────────────────────────────────────────
def fetch_rss() -> list[dict]:
    """
    RSS를 직접 파싱. 네이버는 서버 사이드 봇을 차단하므로
    여러 User-Agent / 프록시를 순차적으로 시도.
    """
    log.info(f'[1단계] RSS 직접 파싱 시도: {RSS_URL}')

    # 시도할 접근 방식들
    attempts = [
        # 직접 접근
        lambda: SESSION.get(RSS_URL, timeout=12),
        # 다른 UA
        lambda: requests.get(RSS_URL, timeout=12, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
        }),
        # allorigins 프록시
        lambda: requests.get(
            f'https://api.allorigins.win/raw?url={RSS_URL}',
            timeout=12
        ),
        # corsproxy
        lambda: requests.get(
            f'https://corsproxy.io/?{RSS_URL}',
            timeout=12
        ),
    ]

    for i, attempt in enumerate(attempts):
        try:
            resp = attempt()
            if resp.status_code == 200 and '<item>' in resp.text:
                log.info(f'  ✅ 시도 {i+1} 성공, len={len(resp.text)}')
                return _parse_rss_xml(resp.text)
            else:
                log.warning(f'  ❌ 시도 {i+1}: status={resp.status_code}')
        except Exception as e:
            log.warning(f'  ❌ 시도 {i+1}: {e}')
        time.sleep(1)

    log.warning('[1단계] RSS 직접 파싱 실패 → 2단계로 이동')
    return []


def _parse_rss_xml(xml_text: str) -> list[dict]:
    """RSS XML → 포스트 목록 파싱"""
    posts = []
    try:
        root = ET.fromstring(xml_text)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        items = root.findall('.//item')
        for item in items[:MAX_POSTS]:
            title = item.findtext('title', '').strip()
            link  = item.findtext('link', '').strip()
            desc  = item.findtext('description', '').strip()
            pub   = item.findtext('pubDate', '').strip()
            # HTML 태그 제거
            desc_clean = re.sub(r'<[^>]+>', ' ', desc).strip()
            desc_clean = re.sub(r'\s+', ' ', desc_clean)
            posts.append({
                'title':       title,
                'link':        link,
                'description': desc_clean[:800],
                'pubDate':     pub,
                'source':      'rss',
                'content':     '',
                'crawled_at':  '',
                'hash':        hashlib.md5(link.encode()).hexdigest()[:8]
            })
        log.info(f'  RSS 파싱 완료: {len(posts)}개 포스트')
    except Exception as e:
        log.error(f'  RSS XML 파싱 오류: {e}')
    return posts


# ──────────────────────────────────────────────
#  2단계: Claude API web_search로 블로그 내용 수집
# ──────────────────────────────────────────────
def fetch_via_claude_api(api_key: str) -> list[dict]:
    """
    Claude API의 web_search 도구를 사용해 블로그 포스트 내용 수집.
    네이버 직접 접근 불가 시 가장 신뢰할 수 있는 대안.
    """
    log.info('[2단계] Claude API web_search 도구로 블로그 수집 시작')

    if not api_key:
        log.warning('  API 키 없음 → 2단계 스킵')
        return []

    headers = {
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
    }

    # 검색 쿼리 목록 (주요 주제별)
    queries = [
        f'site:blog.naver.com/bk_solar 최신 포스팅 목록 제목 날짜',
        f'부광솔라 bk_solar 영농형태양광 ESS 스마트팜 블로그',
        f'부광솔라 태양광 ESS BESS 보조금 수익분석 최신',
        f'blog.naver.com/bk_solar 입지분석 통합수익 태양광',
    ]

    all_posts = []
    seen_hashes = set()

    for q_idx, query in enumerate(queries):
        log.info(f'  검색 쿼리 [{q_idx+1}/{len(queries)}]: {query[:50]}')
        payload = {
            'model': 'claude-sonnet-4-6',
            'max_tokens': 2000,
            'system': (
                '당신은 부광솔라 블로그(blog.naver.com/bk_solar) 데이터 수집 봇입니다.\n'
                '웹 검색 결과에서 블로그 포스트 정보를 JSON 배열로만 반환하세요.\n'
                '각 항목: {"title":"제목","link":"URL","description":"본문요약200자","pubDate":"날짜","tags":["태그"]}\n'
                '반드시 JSON 배열만 반환, 마크다운 코드블록 없이.'
            ),
            'messages': [{
                'role': 'user',
                'content': (
                    f'웹 검색으로 다음을 찾아주세요: {query}\n'
                    '부광솔라 네이버 블로그(blog.naver.com/bk_solar)의 포스팅 내용을 최대한 많이 수집해서 '
                    'JSON 배열로 반환해주세요. 검색 결과 URL, 제목, 요약, 날짜 포함.'
                )
            }],
            'tools': [{'type': 'web_search_20250305', 'name': 'web_search'}]
        }

        try:
            resp = requests.post(
                'https://api.anthropic.com/v1/messages',
                headers=headers,
                json=payload,
                timeout=60
            )

            if resp.status_code != 200:
                log.warning(f'  API 오류: {resp.status_code} → {resp.text[:200]}')
                continue

            data = resp.json()
            # 텍스트 블록에서 JSON 추출
            for block in data.get('content', []):
                if block.get('type') != 'text':
                    continue
                text = block['text']
                # JSON 배열 추출 시도
                parsed = _extract_json_from_text(text)
                if parsed:
                    for post in parsed:
                        h = hashlib.md5(post.get('link', post.get('title', '')).encode()).hexdigest()[:8]
                        if h not in seen_hashes:
                            seen_hashes.add(h)
                            post.update({
                                'source': 'claude_websearch',
                                'content': post.get('description', ''),
                                'crawled_at': datetime.now().isoformat(),
                                'hash': h
                            })
                            all_posts.append(post)
                    log.info(f'  ✅ 쿼리 {q_idx+1}: {len(parsed)}개 포스트 추출')

        except Exception as e:
            log.error(f'  Claude API 호출 오류: {e}')

        time.sleep(2)  # API rate limit 방지

    log.info(f'[2단계] 완료: 총 {len(all_posts)}개 포스트 수집')
    return all_posts


def _extract_json_from_text(text: str) -> list:
    """텍스트에서 JSON 배열 추출"""
    # 코드블록 제거
    text = re.sub(r'```(?:json)?\s*', '', text).strip()
    # JSON 배열 찾기
    patterns = [
        r'\[\s*\{.*?\}\s*\]',  # [...] 형태
    ]
    for pat in patterns:
        matches = re.findall(pat, text, re.DOTALL)
        for m in matches:
            try:
                result = json.loads(m)
                if isinstance(result, list) and result:
                    return result
            except:
                continue
    # 전체 텍스트 JSON 파싱 시도
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
    except:
        pass
    return []


# ──────────────────────────────────────────────
#  3단계: 개별 포스트 상세 크롤링
# ──────────────────────────────────────────────
def crawl_post_detail(url: str) -> str:
    """
    개별 포스트 링크에서 본문 텍스트 추출.
    네이버 블로그 구조에 맞게 셀렉터 최적화.
    """
    if not url or 'naver' not in url:
        return ''

    # 모바일 URL로 변환 (봇 차단 우회 시도)
    mobile_url = url.replace('blog.naver.com', 'm.blog.naver.com')

    for attempt_url in [url, mobile_url]:
        try:
            resp = SESSION.get(attempt_url, timeout=10)
            if resp.status_code != 200:
                continue

            soup = BeautifulSoup(resp.text, 'lxml')

            # 네이버 블로그 본문 셀렉터 (버전별)
            selectors = [
                'div.se-main-container',        # 스마트에디터 ONE
                'div#postViewArea',             # 구버전
                'div.post-view',                # 모바일
                'div[id*="NPostViewArea"]',     # 레거시
                'div.se_component_wrap',        # SE3
                'div.entry-content',            # 일반
                'article',
            ]
            for sel in selectors:
                el = soup.select_one(sel)
                if el:
                    text = el.get_text(separator=' ', strip=True)
                    text = re.sub(r'\s+', ' ', text)
                    if len(text) > 100:
                        return text[:2000]

        except Exception as e:
            log.debug(f'  크롤링 실패 {attempt_url[:50]}: {e}')
        time.sleep(0.5)

    return ''


def enrich_posts_with_content(posts: list[dict]) -> list[dict]:
    """포스트 목록의 link를 따라가서 본문 내용 추가"""
    log.info(f'[3단계] 개별 포스트 상세 크롤링: {len(posts)}개')
    enriched = []
    for i, post in enumerate(posts):
        link = post.get('link', '')
        if link and not post.get('content'):
            log.info(f'  [{i+1}/{len(posts)}] {post.get("title","")[:40]}')
            content = crawl_post_detail(link)
            post['content'] = content
            post['crawled_at'] = datetime.now().isoformat()
        enriched.append(post)
        time.sleep(0.3)
    return enriched


# ──────────────────────────────────────────────
#  저장 (JSON / CSV / Text)
# ──────────────────────────────────────────────
def save_all_formats(posts: list[dict], label: str = '') -> dict:
    """JSON, CSV, Text 3가지 형식으로 저장"""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    label = label or ts

    paths = {}

    # ── JSON (풀 데이터)
    json_path = DATA_DIR / f'blog_posts_{label}.json'
    meta = {
        'blog_id':    BLOG_ID,
        'blog_url':   BLOG_URL,
        'updated_at': datetime.now().isoformat(),
        'post_count': len(posts),
        'posts':      posts
    }
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    paths['json'] = str(json_path)
    log.info(f'✅ JSON 저장: {json_path}')

    # ── 최신 버전 심링크 (latest.json 덮어쓰기)
    latest_json = DATA_DIR / 'latest.json'
    with open(latest_json, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    paths['latest_json'] = str(latest_json)

    # ── CSV (요약 데이터)
    csv_path = DATA_DIR / f'blog_posts_{label}.csv'
    fields = ['title', 'link', 'pubDate', 'source', 'crawled_at',
              'description', 'content', 'hash']
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(posts)
    paths['csv'] = str(csv_path)
    log.info(f'✅ CSV 저장: {csv_path}')

    # ── Text (사람이 읽기 쉬운 형태 + AI 컨텍스트용)
    txt_path = DATA_DIR / f'blog_posts_{label}.txt'
    latest_txt = DATA_DIR / 'latest.txt'
    txt_content = _build_text_report(posts)
    for p in [txt_path, latest_txt]:
        with open(p, 'w', encoding='utf-8') as f:
            f.write(txt_content)
    paths['txt'] = str(txt_path)
    paths['latest_txt'] = str(latest_txt)
    log.info(f'✅ Text 저장: {txt_path}')

    # ── 업데이트 메타데이터 기록
    meta_path = DATA_DIR / 'update_meta.json'
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump({
            'last_update': datetime.now().isoformat(),
            'next_update': (datetime.now() + timedelta(days=SCHEDULE_DAYS)).isoformat(),
            'post_count':  len(posts),
            'latest_json': 'data/blog_cache/latest.json',
            'latest_txt':  'data/blog_cache/latest.txt',
        }, f, ensure_ascii=False, indent=2)
    paths['meta'] = str(meta_path)

    return paths


def _build_text_report(posts: list[dict]) -> str:
    lines = [
        '=' * 60,
        f'부광솔라 블로그 크롤링 결과 (blog.naver.com/bk_solar)',
        f'수집일시: {datetime.now().strftime("%Y년 %m월 %d일 %H:%M")}',
        f'포스트 수: {len(posts)}개',
        '=' * 60,
        '',
    ]
    for i, p in enumerate(posts, 1):
        lines += [
            f'[{i}] {p.get("title", "(제목없음)")}',
            f'    날짜: {p.get("pubDate", "")}',
            f'    링크: {p.get("link", "")}',
            f'    출처: {p.get("source", "")}',
            f'    요약: {(p.get("description") or p.get("content",""))[:300]}',
            '',
        ]
    return '\n'.join(lines)


# ──────────────────────────────────────────────
#  업데이트 필요 여부 판단
# ──────────────────────────────────────────────
def needs_update(force: bool = False) -> bool:
    if force:
        return True
    meta_path = DATA_DIR / 'update_meta.json'
    if not meta_path.exists():
        return True
    try:
        with open(meta_path) as f:
            meta = json.load(f)
        next_update = datetime.fromisoformat(meta['next_update'])
        if datetime.now() < next_update:
            log.info(f'업데이트 불필요 (다음 예정: {next_update.strftime("%Y-%m-%d %H:%M")})')
            return False
    except Exception:
        pass
    return True


# ──────────────────────────────────────────────
#  메인 크롤러
# ──────────────────────────────────────────────
def run_crawler(api_key: str = '', force: bool = False) -> dict:
    """
    전체 크롤링 파이프라인 실행.
    Returns: {'posts': [...], 'paths': {...}, 'success': bool}
    """
    if not needs_update(force):
        # 기존 데이터 반환
        latest = DATA_DIR / 'latest.json'
        if latest.exists():
            with open(latest) as f:
                data = json.load(f)
            return {'posts': data.get('posts', []), 'paths': {}, 'success': True, 'cached': True}

    log.info('=' * 50)
    log.info('부광솔라 블로그 크롤링 시작')
    log.info(f'대상: {BLOG_URL}')
    log.info('=' * 50)

    posts = []

    # 1단계: RSS 직접 파싱
    rss_posts = fetch_rss()
    posts.extend(rss_posts)

    # 2단계: Claude API (API 키 있을 때 / RSS 실패 시)
    if api_key and len(posts) < 5:
        claude_posts = fetch_via_claude_api(api_key)
        # 중복 제거 (hash 기준)
        existing_hashes = {p['hash'] for p in posts}
        for p in claude_posts:
            if p.get('hash') not in existing_hashes:
                posts.append(p)
                existing_hashes.add(p['hash'])

    # API 키가 있으면 항상 Claude로 보완
    elif api_key:
        claude_posts = fetch_via_claude_api(api_key)
        existing_hashes = {p['hash'] for p in posts}
        for p in claude_posts:
            if p.get('hash') not in existing_hashes:
                posts.append(p)
                existing_hashes.add(p['hash'])

    # 3단계: 개별 포스트 상세 내용 수집
    if posts:
        posts = enrich_posts_with_content(posts)

    # 데이터 없으면 Claude API로 마지막 시도
    if not posts and api_key:
        log.info('[최종] Claude API 단독으로 블로그 내용 재수집 시도')
        posts = fetch_via_claude_api(api_key)

    # 결과 없으면 빈 구조라도 저장
    if not posts:
        posts = [{
            'title': '(크롤링 실패)',
            'link': BLOG_URL,
            'description': '네이버 블로그 서버 정책으로 직접 수집 불가. Claude API 웹검색으로 대체.',
            'pubDate': datetime.now().isoformat(),
            'source': 'fallback',
            'content': '',
            'crawled_at': datetime.now().isoformat(),
            'hash': 'fallback00'
        }]

    # 저장
    label = datetime.now().strftime('%Y%m%d_%H%M%S')
    paths = save_all_formats(posts, label)

    log.info(f'크롤링 완료: {len(posts)}개 포스트 수집')
    return {'posts': posts, 'paths': paths, 'success': len(posts) > 0}


# ──────────────────────────────────────────────
#  스케줄러 (15일 주기)
# ──────────────────────────────────────────────
def run_scheduler(api_key: str = ''):
    """15일 주기로 자동 크롤링"""
    log.info(f'스케줄러 시작: {SCHEDULE_DAYS}일 주기')
    while True:
        try:
            result = run_crawler(api_key=api_key, force=False)
            log.info(f'스케줄 실행 완료: {len(result.get("posts",[]))}개')
        except Exception as e:
            log.error(f'스케줄 실행 오류: {e}')

        next_run = datetime.now() + timedelta(days=SCHEDULE_DAYS)
        log.info(f'다음 실행: {next_run.strftime("%Y-%m-%d %H:%M")}')
        time.sleep(SCHEDULE_DAYS * 24 * 3600)


# ──────────────────────────────────────────────
#  CLI 진입점
# ──────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='부광솔라 블로그 크롤러')
    parser.add_argument('--schedule', action='store_true', help='15일 주기 스케줄 실행')
    parser.add_argument('--force', action='store_true', help='강제 새로고침')
    parser.add_argument('--api-key', default=os.environ.get('ANTHROPIC_API_KEY', ''),
                        help='Anthropic API 키 (환경변수 ANTHROPIC_API_KEY 또는 직접 전달)')
    args = parser.parse_args()

    if args.schedule:
        run_scheduler(api_key=args.api_key)
    else:
        result = run_crawler(api_key=args.api_key, force=args.force)
        print(f"\n✅ 크롤링 결과:")
        print(f"   포스트 수: {len(result.get('posts', []))}")
        print(f"   저장 경로:")
        for k, v in result.get('paths', {}).items():
            print(f"     {k}: {v}")
        if result.get('success'):
            print("\n📄 최신 포스트 미리보기:")
            for p in result['posts'][:3]:
                print(f"  [{p.get('pubDate','')[:10]}] {p.get('title','')[:50]}")
                print(f"    {(p.get('description') or p.get('content',''))[:100]}")
