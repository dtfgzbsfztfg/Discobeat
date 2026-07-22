"""
songs.json 파일을 기반으로 한 아주 단순한 저장소.
서버(FastAPI)와 파일을 공유하기 때문에, 매번 읽고/쓸 때마다 디스크에 반영한다.
동시 쓰기 충돌을 막기 위해 asyncio.Lock 을 사용한다.
"""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import config

_lock = asyncio.Lock()

REQUIRED_NOTE_LANES = {"d", "f", "j", "k"}


def _ensure_file() -> None:
    config.DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not config.DATA_FILE.exists():
        config.DATA_FILE.write_text(json.dumps({"songs": {}}, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_raw() -> dict:
    _ensure_file()
    with open(config.DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_raw(data: dict) -> None:
    with open(config.DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


class ChartValidationError(Exception):
    pass


def validate_chart(chart: dict) -> None:
    """/song add, /song edit 에서 업로드된 채보 JSON 의 형식을 검사하고,
    lane 값의 공백/대소문자를 자동으로 정리한다 (예: " D " -> "d")."""
    if not isinstance(chart, dict):
        raise ChartValidationError("채보 파일은 JSON 객체여야 해요.")

    notes = chart.get("notes")
    if not isinstance(notes, list) or len(notes) == 0:
        raise ChartValidationError("`notes` 배열이 비어있거나 없어요.")

    cleaned = []
    for i, note in enumerate(notes):
        if not isinstance(note, dict):
            raise ChartValidationError(f"{i}번째 노트가 객체가 아니에요.")
        lane = note.get("lane")
        time_ms = note.get("time_ms")
        if isinstance(lane, str):
            lane = lane.strip().lower()
        if lane not in REQUIRED_NOTE_LANES:
            raise ChartValidationError(f"{i}번째 노트의 lane 값은 d/f/j/k 중 하나여야 해요. (받은 값: {note.get('lane')!r})")
        if not isinstance(time_ms, (int, float)) or time_ms < 0:
            raise ChartValidationError(f"{i}번째 노트의 time_ms 값이 올바르지 않아요. (받은 값: {time_ms})")
        cleaned.append({"time_ms": time_ms, "lane": lane})

    chart["notes"] = cleaned


async def list_songs() -> dict:
    async with _lock:
        data = _read_raw()
        return data["songs"]


async def get_song(song_id: str) -> Optional[dict]:
    async with _lock:
        data = _read_raw()
        return data["songs"].get(song_id)


async def add_song(song_id: str, chart: dict, created_by: int) -> None:
    async with _lock:
        data = _read_raw()
        if song_id in data["songs"]:
            raise ChartValidationError(f"이미 같은 id('{song_id}')의 노래가 있어요. 다른 id를 쓰거나 /song edit 을 사용하세요.")
        chart = dict(chart)
        chart["id"] = song_id
        chart.setdefault("audio_url", None)
        chart.setdefault("offset_ms", 0)
        chart["created_by"] = str(created_by)
        chart["created_at"] = datetime.now(timezone.utc).isoformat()
        chart["notes"] = sorted(chart["notes"], key=lambda n: n["time_ms"])
        data["songs"][song_id] = chart
        _write_raw(data)


async def update_song(song_id: str, updates: dict) -> dict:
    async with _lock:
        data = _read_raw()
        if song_id not in data["songs"]:
            raise ChartValidationError(f"'{song_id}' 노래를 찾을 수 없어요.")
        song = data["songs"][song_id]
        song.update(updates)
        if "notes" in updates:
            song["notes"] = sorted(song["notes"], key=lambda n: n["time_ms"])
        song["updated_at"] = datetime.now(timezone.utc).isoformat()
        data["songs"][song_id] = song
        _write_raw(data)
        return song


async def delete_song(song_id: str) -> bool:
    async with _lock:
        data = _read_raw()
        if song_id not in data["songs"]:
            return False
        del data["songs"][song_id]
        _write_raw(data)
        return True
