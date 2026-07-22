"""
Discord Activity 프론트엔드(activity/)가 불러오는 API 서버.

로컬 실행:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8787 --reload

Discord Activity로 배포할 때는 이 서버를 공개 HTTPS 주소로 올린 뒤,
Discord Developer Portal > Activities > URL Mappings 에서
"/api" 같은 경로를 이 서버의 실제 주소로 매핑해야 합니다.
(Activity 안에서는 항상 /.proxy/... 경로로 요청해야 하며, 프론트엔드 game.js 의
API_BASE 상수에서 이 부분을 안내하고 있습니다.)
"""
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "songs.json"
ACTIVITY_DIR = BASE_DIR / "activity"
AUDIO_DIR = Path(__file__).resolve().parent / "static" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="DiscoBeat API")

# Discord Activity(iframe)는 discordsays.com 도메인에서 프록시로 요청을 보내기 때문에
# 개발 단계에서는 모든 출처를 허용해두고, 운영 시 필요하면 좁혀도 됩니다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_songs() -> dict:
    if not DATA_FILE.exists():
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f).get("songs", {})


@app.get("/api/songs")
def list_songs():
    """노래 목록(메타데이터만, 채보 제외)."""
    songs = _read_songs()
    return [
        {
            "id": song_id,
            "title": s.get("title"),
            "artist": s.get("artist"),
            "bpm": s.get("bpm"),
            "difficulty": s.get("difficulty"),
            "duration_ms": s.get("duration_ms"),
            "note_count": len(s.get("notes", [])),
        }
        for song_id, s in songs.items()
    ]


@app.get("/api/songs/{song_id}")
def get_song(song_id: str):
    """게임 실행에 필요한 전체 채보 데이터."""
    songs = _read_songs()
    song = songs.get(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="노래를 찾을 수 없어요.")
    return song


@app.get("/api/audio")
def list_audio_files():
    """server/static/audio 폴더에 직접 넣어둔 오디오 파일 목록.
    /song edit 에서 audio_url 값을 정할 때 참고용."""
    if not AUDIO_DIR.exists():
        return []
    return sorted(p.name for p in AUDIO_DIR.iterdir() if p.is_file())


# server/static/audio/ 에 직접 넣어둔 오디오 파일을 서빙한다.
# 디스코드에 파일을 첨부할 필요 없이, 이 폴더에 mp3/ogg 파일을 복사해두면
# "/static/audio/파일명.mp3" 형태의 URL로 접근할 수 있다.
app.mount("/static/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

# activity/ 폴더의 정적 파일(HTML/CSS/JS)을 그대로 서빙한다. (반드시 마지막에 마운트)
app.mount("/", StaticFiles(directory=ACTIVITY_DIR, html=True), name="activity")
