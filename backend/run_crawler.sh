#!/bin/bash
# ============================================================
# 부광솔라 블로그 크롤러 실행 스크립트
# ============================================================
#
# 사용법:
#   ./run_crawler.sh                         # 1회 실행
#   ./run_crawler.sh --schedule              # 15일 주기 자동 실행
#   ./run_crawler.sh --force                 # 강제 갱신
#   ANTHROPIC_API_KEY=sk-... ./run_crawler.sh  # API 키와 함께 실행
#
# crontab 설정 (15일마다 자동 실행):
#   0 9 */15 * * /path/to/run_crawler.sh >> /path/to/data/crawler_cron.log 2>&1
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo " 부광솔라 블로그 크롤러"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# Python 가상환경 활성화 (있으면)
if [ -f "../venv/bin/activate" ]; then
    source ../venv/bin/activate
fi

# 패키지 확인 & 설치
python3 -c "import requests, bs4" 2>/dev/null || \
    pip3 install requests beautifulsoup4 lxml --break-system-packages -q

# 크롤러 실행
if [ "$1" = "--schedule" ]; then
    echo "스케줄 모드: 15일 주기 실행"
    python3 blog_crawler.py --schedule ${ANTHROPIC_API_KEY:+--api-key $ANTHROPIC_API_KEY}
elif [ "$1" = "--force" ]; then
    echo "강제 갱신 모드"
    python3 blog_crawler.py --force ${ANTHROPIC_API_KEY:+--api-key $ANTHROPIC_API_KEY}
else
    echo "1회 실행 모드"
    python3 blog_crawler.py ${ANTHROPIC_API_KEY:+--api-key $ANTHROPIC_API_KEY}
fi

echo ""
echo "완료: $(date '+%Y-%m-%d %H:%M:%S')"
