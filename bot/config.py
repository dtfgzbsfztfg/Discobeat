import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# 디스코드 봇 토큰 (Developer Portal > Bot > Token)
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")

# 디스코드 애플리케이션(클라이언트) ID - (현재는 사용 안 하지만 남겨둠)
APPLICATION_ID = os.getenv("APPLICATION_ID")

# 리듬게임 웹사이트 주소 (server/ 를 배포한 공개 URL). 예: https://discobeat.example.com
# 로컬 테스트 중이면 http://localhost:8787 로 두면 되고, 실제 배포 후에는 공개 도메인으로 바꿔주세요.
SITE_URL = os.getenv("SITE_URL", "http://localhost:8787").rstrip("/")

# bot/ 과 server/ 가 공유하는 노래 데이터 파일
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = Path(os.getenv("DATA_FILE", BASE_DIR / "data" / "songs.json"))

# 채보(JSON) 첨부파일 최대 용량 (바이트) - 너무 큰 파일 방지
MAX_CHART_SIZE = 512 * 1024  # 512KB
