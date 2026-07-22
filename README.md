# DiscoBeat - 디스코드 리듬게임 봇

D · F · J · K 키를 사용하는 리듬게임이에요. 디스코드 봇에서 노래(채보)를 관리하고,
실제 게임은 **웹사이트**에서 플레이해요 (음성채널 필요 없음, 그냥 링크 클릭하면 끝).
**노래(채보) 추가/수정/삭제는 디스코드 서버(방)의 주인만** 할 수 있도록 만들었어요.

## 구성

```
discobeat/
├── bot/          # 디스코드 봇 (Python, discord.py) - 슬래시 명령어 처리
├── server/       # 리듬게임 웹사이트 + 채보 API 서버 (FastAPI)
├── activity/     # 실제 게임 화면 (HTML/CSS/JS) - server가 그대로 서빙함
├── charts/       # 채보 JSON 예시 파일
└── data/songs.json   # 노래/채보가 저장되는 파일 (bot, server가 공유)
```

## 어떻게 동작하나요

1. `server/`를 켜두면 `http://내주소:8787` 자체가 리듬게임 웹사이트예요. 브라우저로 그냥 들어가면 곡 목록이 보이고 플레이할 수 있어요.
2. 디스코드 봇의 `/play` 명령어는 그 웹사이트로 가는 **링크 버튼**을 채팅에 보내줘요. 누르면 브라우저(또는 디스코드 앱 안 브라우저)로 열려요.
3. 음성채널, Discord Activity 등록, Developer Portal의 복잡한 설정 전부 필요 없어요.

## 1. 설치

```bash
# 봇
cd bot
pip install -r requirements.txt
cp .env.example .env   # 토큰/SITE_URL 채워넣기

# API 서버
cd ../server
pip install -r requirements.txt
```

## 2. Discord Developer Portal 설정 (간단해요)

1. https://discord.com/developers/applications 에서 애플리케이션 생성
2. **Bot** 탭에서 봇 생성 후 토큰 복사 → `bot/.env` 의 `DISCORD_TOKEN`
3. **Bot** 탭에서 초대 링크 생성 (권한: `applications.commands`, `bot`) 후 내 서버에 초대
4. 끝! Activity 설정, URL Mappings 같은 건 필요 없어요.

## 3. 실행

```bash
# 터미널 1: 웹사이트 + API 서버
cd server
uvicorn app:app --host 0.0.0.0 --port 8787

# 터미널 2: 디스코드 봇
cd bot
python bot.py
```

로컬 브라우저에서 `http://localhost:8787` 로 접속하면 바로 게임 화면이 떠요.

## 4. 다른 사람들도 쓸 수 있게 공개하기 (선택)

지금은 `localhost`라서 여러분 컴퓨터에서만 열려요. 서버 멤버들도 접속하게 하려면
`server/`를 인터넷에 공개된 주소로 올려야 해요. 방법은 두 가지예요.

**간단한 테스트용 - ngrok**
```bash
ngrok http 8787
```
`https://abcd1234.ngrok-free.app` 같은 주소가 나오면, `bot/.env`의 `SITE_URL`을 이 주소로 바꿔주세요.
(다만 ngrok 무료 버전은 컴퓨터를 끄면 주소가 사라져요.)

**계속 켜두고 싶다면 - 실제 호스팅**
Render, Railway, Fly.io 같은 곳에 `server/` 폴더를 배포하면 24시간 켜둘 수 있는 고정 주소가 생겨요.
그 주소를 `SITE_URL`에 넣어주세요.

```
# bot/.env
SITE_URL=https://내가-배포한-주소.com
```

## 5. 노래(채보) 추가하기 - 서버 주인 전용

채보는 JSON 파일로 만들어서 첨부하는 방식이에요. `charts/example_song.json` 참고:

```json
{
  "title": "노래 제목",
  "artist": "아티스트",
  "bpm": 120,
  "difficulty": "Normal",
  "duration_ms": 8000,
  "audio_url": null,
  "notes": [
    { "time_ms": 1000, "lane": "d" },
    { "time_ms": 1500, "lane": "f" }
  ]
}
```

채보를 직접 손으로 타이핑하는 건 번거로우니, **`activity/editor.html`** 을 브라우저로 그냥 열어서
두 가지 방법 중 편한 걸로 채보를 만들 수 있게 해뒀어요.

- **자동 생성 (제일 쉬움)**: BPM과 노래 길이(초)만 입력하면 박자에 맞춰 노트를 자동으로 깔아줘요.
  노래를 직접 들으며 키를 누를 필요가 없어요. "패턴 난이도"로 노트 밀도(한 박자/반 박자/4분박)를 조절할 수 있어요.
- **직접 녹음**: 노래를 들으며 D/F/J/K를 눌러서 정확한 타이밍의 채보를 만들고 싶을 때 사용해요.

둘 다 마지막엔 "JSON으로 내보내기"로 파일을 받아서 `/song add`에 첨부하면 돼요.
(이 에디터는 디스코드와 무관한 순수 로컬 도구예요.)

디스코드에서:

```
/song add id:my_song chart_file:[example_song.json 첨부]
/song list
/song info id:my_song
/song edit id:my_song title:새제목
/song remove id:my_song
```

- `/song add`, `/song edit`, `/song remove` → **서버 주인만** 실행 가능 (다른 사람이 시도하면 거부 메시지)
- `/song list`, `/song info`, `/play` → 아무나 사용 가능

## 5-1. 큰 오디오 파일 올리기 (디스코드 첨부 용량 제한 우회)

디스코드는 서버 부스트 레벨에 따라 첨부파일 용량이 10MB~100MB로 제한돼요. 오디오 파일을 디스코드에
직접 첨부하는 대신, **서버 폴더에 바로 넣어두는 방식**을 쓰면 이 제한과 무관하게 큰 파일도 쓸 수 있어요.

1. mp3/ogg 파일을 `server/static/audio/` 폴더 안에 복사해 넣기 (예: `neonpulse.mp3`)
2. 브라우저에서 `http://localhost:8787/api/audio` 접속하면 지금 폴더에 있는 파일 목록이 보여요
3. 디스코드에서 아래처럼 `audio_url`을 상대 경로로 지정

   ```
   /song edit id:my_song audio_url:/static/audio/neonpulse.mp3
   ```

웹사이트 방식이라 별도 URL 매핑 설정 없이, 서버가 실행되는 주소에서 바로 재생돼요.

### 유튜브 링크도 오디오로 쓸 수 있어요

`audio_url`에 mp3 직링크 대신 유튜브 주소를 넣어도 돼요 (`youtube.com/watch?v=...`, `youtu.be/...` 형식 모두 인식).

```
/song edit id:my_song audio_url:https://youtu.be/영상ID
```

게임 화면 오른쪽 위에 작은 영상 플레이어가 뜨면서 노래에 맞춰 재생되고, 그 재생 시간에 맞춰 노트가 올라와요.
`activity/editor.html` 채보 에디터에서도 유튜브 링크를 넣으면 그 영상을 보면서 채보를 만들 수 있어요.

**참고**: 이건 영상을 다운로드하거나 오디오를 추출하는 게 아니라, 유튜브가 공식으로 제공하는 임베드 플레이어(IFrame API)를
그대로 띄우는 방식이에요. 업로더가 퍼가기(임베드)를 막아둔 영상은 재생이 안 될 수 있어요.

## 6. 게임 플레이

```
/play id:my_song
```

디스코드가 "🎮 my_song 플레이하기" 버튼을 채팅에 보내줘요. 누르면 브라우저(또는 디스코드 앱 안 웹뷰)로
게임 화면이 열리고, 곧바로 그 노래를 시작할 수 있는 카드가 떠요. `id` 없이 그냥 `/play`만 치면 전체 곡 목록
페이지로 가는 링크를 보내줘요.

## 게임 시스템 (Friday Night Funkin' 스타일)

- 노트가 레인 **아래에서 위로** 올라와서 상단 리셉터에 맞춰 눌러요.
- **4단계 판정 - SICK / GOOD / BAD / SHIT**: 타이밍이 정확할수록 SICK, 많이 어긋날수록 BAD·SHIT이 떠요.
  이 넷은 전부 "맞춘 것"으로 쳐서 콤보가 이어지고, 판정 범위(SHIT)를 완전히 벗어나면 그때 **MISS**가 되면서 콤보가 끊겨요.
- 상단 **체력바(밀당 게이지)**: SICK/GOOD은 체력을 올리고(플레이어 쪽으로 밀림), SHIT/MISS는 깎아요(상대 쪽으로 밀림).
  체력이 0이 되면 **GAME OVER** 화면이 뜨고, 다 채우고 곡이 끝나면 RESULT 화면이 떠요.
- 양옆 아바타가 노래 **박자(BPM)에 맞춰 통통** 튀어요. SICK/GOOD/BAD를 맞히면 내 캐릭터가, SHIT/MISS면 상대 캐릭터가 반응해요.
- 점수/체력 값은 `activity/game.js` 상단의 `SCORE_TABLE`, `HEALTH_DELTA`에서 조절할 수 있어요.

## 판정 기준 (game.js 의 JUDGE_WINDOW 에서 조정 가능)

| 판정 | 오차 범위 | 점수 |
|---|---|---|
| SICK | ±45ms | 350점 |
| GOOD | ±90ms | 200점 |
| BAD | ±135ms | 100점 |
| SHIT | ±180ms | 50점 |
| MISS | 그 외 (완전히 놓침) | 0점 |

## 알아두면 좋은 한계점

- 지금 저장소는 `data/songs.json` 파일 하나를 씁니다. 노래 수가 아주 많아지면 SQLite 등으로 바꾸는 걸 추천해요.
- `SITE_URL`을 실제 배포 주소로 바꾸지 않으면 `/play`가 `localhost` 링크를 보내는데, 이건 봇을 실행 중인
  컴퓨터에서만 열려요. 다른 사람도 쓰게 하려면 4번 항목대로 공개 주소를 설정해주세요.
