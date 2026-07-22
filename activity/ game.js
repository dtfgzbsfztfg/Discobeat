/*
  이 게임은 이제 Discord Activity가 아니라, 그냥 웹사이트로 열려요.
  index.html과 이 API가 같은 서버(server/app.py)에서 같이 서빙되기 때문에
  상대경로("/api")만 쓰면 로컬이든 실제 배포 주소든 항상 정상 동작해요.
*/
const API_BASE = "/api";

const LANES = ["d", "f", "j", "k"];
const APPROACH_MS = 1400;      // 노트가 등장해서 판정선(위쪽)까지 올라오는 시간
const NOTE_HEIGHT = 22;

// FNF 스타일 4단계 판정 - sick(가장 정확) > good > bad > shit(간신히 맞춤)
// 이 범위를 완전히 벗어나면 MISS(놓침) 처리됨
// 모바일 감지
const isMobile = window.innerWidth <= 480;

// PC: 엄격한 판정, 모바일: 후한 판정
const JUDGE_WINDOW = isMobile
  ? { sick: 70, good: 140, bad: 210, shit: 280 }
  : { sick: 45, good: 90, bad: 135, shit: 180 };

const SCORE_TABLE = { sick: 350, good: 200, bad: 100, shit: 50, miss: 0 };

const HEALTH_START = 80;
const HEALTH_MAX = 100;
const HEALTH_DELTA = { sick: 3, good: 2, bad: 0.5, shit: -0.3, miss: -2 };

const el = (id) => document.getElementById(id);
const screens = {
  menu: el("menu-screen"),
  game: el("game-screen"),
  gameover: el("gameover-screen"),
  result: el("result-screen"),
};

// ---------------------------------------------------------------------
// 유튜브 지원
// ---------------------------------------------------------------------

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/watch\?v=([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

let ytApiReadyPromise = null;
function loadYouTubeApi() {
  if (ytApiReadyPromise) return ytApiReadyPromise;
  ytApiReadyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    window.onYouTubeIframeAPIReady = () => resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiReadyPromise;
}

let ytPlayer = null;
function createOrLoadYouTubePlayer(videoId) {
  return new Promise((resolve) => {
    if (ytPlayer) {
      ytPlayer.loadVideoById(videoId);
      resolve(ytPlayer);
      return;
    }
    ytPlayer = new YT.Player("yt-player", {
      videoId,
      playerVars: { controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: () => resolve(ytPlayer),
      },
    });
  });
}

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  if (name === "menu") {
    el("bg-video").pause();
  }
}

// ---------------------------------------------------------------------
// 곡 목록
// ---------------------------------------------------------------------

async function loadSongList() {
  const listEl = el("song-list");
  try {
    const res = await fetch(`${API_BASE}/songs`);
    const songs = await res.json();
    // 제목 순서로 정렬
    songs.sort((a, b) => (a.title || "").localeCompare(b.title || "", 'ko'));
    if (!songs.length) {
      listEl.innerHTML = `<div class="empty-state">아직 등록된 노래가 없어요.<br/>서버 주인이 디스코드에서 <b>/song add</b> 로 노래를 추가하면 여기 보여요.</div>`;
      return;
    }
    listEl.innerHTML = "";
    songs.forEach((song) => {
      const card = document.createElement("div");
      card.className = "song-card";
      card.innerHTML = `
        <div>
          <div class="title">${escapeHtml(song.title)}</div>
          <div class="meta">${escapeHtml(song.artist || "Unknown")} · BPM ${song.bpm ?? "?"} · 노트 ${song.note_count}개</div>
        </div>
        <div class="diff">${escapeHtml(song.difficulty || "Normal")}</div>
      `;
      card.addEventListener("click", () => startGame(song.id));
      listEl.appendChild(card);
    });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">노래 목록을 불러오지 못했어요.<br/>서버가 켜져 있는지 확인해주세요. (${escapeHtml(String(e))})</div>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------
// 게임 상태
// ---------------------------------------------------------------------

let game = null;

async function startGame(songId) {
  const res = await fetch(`${API_BASE}/songs/${encodeURIComponent(songId)}`);
  if (!res.ok) return;
  const song = await res.json();

  game = {
    song,
    notes: song.notes
      .map((n) => ({ ...n, lane: String(n.lane || "").trim().toLowerCase(), state: "pending" }))
      .filter((n) => LANES.includes(n.lane) && typeof n.time_ms === "number"), // 잘못된 노트(오타 등)는 걸러냄
    score: 0,
    combo: 0,
    maxCombo: 0,
    sick: 0,
    good: 0,
    bad: 0,
    shit: 0,
    miss: 0,
    health: HEALTH_START,
    beatMs: song.bpm ? 60000 / song.bpm : null,
    lastBeatIndex: -1,
    startTime: null,
    laneEls: {},
    noteEls: new Map(),
    audio: null,
    rafId: null,
  };

  el("hud-title").textContent = `${song.title} - ${song.artist || ""}`;
  el("hud-score").textContent = "0";
  el("hud-combo").classList.remove("show");
  updateHealthUI();

  LANES.forEach((lane) => {
    game.laneEls[lane] = document.querySelector(`.lane[data-lane="${lane}"]`);
    game.laneEls[lane].innerHTML = "";
  });

  showScreen("game");
  runCountdown(3, async () => {
    const ytId = extractYouTubeId(song.audio_url);

    if (ytId) {
      el("yt-player-box").style.display = "block";
      await loadYouTubeApi();
      const player = await createOrLoadYouTubePlayer(ytId);
      player.seekTo(0, true);
      player.playVideo();

      // 실제로 재생이 시작된 시점을 기준으로 게임 시계를 맞춘다 (버퍼링 지연 보정).
      const waitPlaying = () =>
        new Promise((resolve) => {
          const onChange = (e) => {
            if (e.data === YT.PlayerState.PLAYING) {
              player.removeEventListener("onStateChange", onChange);
              resolve();
            }
          };
          player.addEventListener("onStateChange", onChange);
        });
      await waitPlaying();
      game.startTime = performance.now() - player.getCurrentTime() * 1000 - (song.offset_ms || 0);
      game.ytPlayer = player;
    } else {
      el("yt-player-box").style.display = "none";
      if (song.audio_url) {
        // MP4 파일이면 비디오에도 로드
        const bgVideo = el("bg-video");
        if (song.audio_url.includes('.mp4') || song.audio_url.includes('.webm')) {
          bgVideo.src = song.audio_url;
        } else {
          bgVideo.src = "";
        }
        game.audio = new Audio(song.audio_url);
        game.audio.play().catch(() => {});
      }
      game.startTime = performance.now() - (song.offset_ms || 0);
    }

    game.rafId = requestAnimationFrame(tick);
  });
}

function runCountdown(n, done) {
  const cd = el("countdown");
  cd.style.display = "flex";
  cd.textContent = n > 0 ? n : "GO!";
  if (n <= 0) {
    setTimeout(() => {
      cd.style.display = "none";
      done();
    }, 500);
    return;
  }
  setTimeout(() => runCountdown(n - 1, done), 700);
}

function tick(now) {
  const elapsed = now - game.startTime;

  // 박자에 맞춰 캐릭터 통통 튀기기
  if (game.beatMs) {
    const beatIndex = Math.floor(elapsed / game.beatMs);
    if (beatIndex > game.lastBeatIndex) {
      game.lastBeatIndex = beatIndex;
      bounceAvatar("player");
      bounceAvatar("opponent");
    }
  }

  for (const note of game.notes) {
    if (note.state !== "pending") continue;

    const progress = (elapsed - (note.time_ms - APPROACH_MS)) / APPROACH_MS;

    if (progress < -0.05) continue; // 아직 등장 전

    let noteEl = game.noteEls.get(note);
    if (!noteEl && progress >= -0.05 && progress <= 1.3) {
      noteEl = document.createElement("div");
      noteEl.className = `note lane-${note.lane}`;
      game.laneEls[note.lane].appendChild(noteEl);
      game.noteEls.set(note, noteEl);
    }

    if (noteEl) {
      // 노트가 위에서 아래로 내려온다 (progress 0 = 위쪽, 1 = 판정선 아래)
      const laneHeight = game.laneEls[note.lane].clientHeight;
      const clamped = Math.min(Math.max(progress, 0), 1);
      const top = clamped * (laneHeight - NOTE_HEIGHT);
      noteEl.style.top = `${top}px`;
    }

    // 판정 범위(SHIT)를 완전히 넘어서면 아무 입력 없이도 자동 MISS 처리
    if (elapsed - note.time_ms > JUDGE_WINDOW.shit) {
      judge(note, "miss");
    }
  }

  if (game.health <= 0) {
    gameOver();
    return;
  }

  if (game.notes.every((n) => n.state !== "pending") &&
      elapsed > (game.song.duration_ms || 0) + 500) {
    endGame();
    return;
  }

  game.rafId = requestAnimationFrame(tick);
}

function handleKeyLane(lane) {
  if (!game) return;
  const elapsed = performance.now() - game.startTime;

  // 해당 레인에서 판정 가능한(시간상 가장 가까운) pending 노트 찾기
  let best = null;
  let bestDiff = Infinity;
  for (const note of game.notes) {
    if (note.state !== "pending" || note.lane !== lane) continue;
    const diff = Math.abs(elapsed - note.time_ms);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = note;
    }
  }

  flashKeycap(lane);

  if (!best || bestDiff > JUDGE_WINDOW.shit) return; // 판정권 밖 입력은 그냥 무시

  if (bestDiff <= JUDGE_WINDOW.sick) judge(best, "sick");
  else if (bestDiff <= JUDGE_WINDOW.good) judge(best, "good");
  else if (bestDiff <= JUDGE_WINDOW.bad) judge(best, "bad");
  else judge(best, "shit");
}

function judge(note, result) {
  note.state = result;
  const noteEl = game.noteEls.get(note);
  if (noteEl) noteEl.remove();

  game.score += SCORE_TABLE[result];

  if (result === "miss") {
    game.combo = 0;
    game.miss += 1;
  } else {
    game.combo += 1;
    game[result] += 1; // sick / good / bad / shit 카운터 증가
  }
  game.maxCombo = Math.max(game.maxCombo, game.combo);
  game.health = Math.min(HEALTH_MAX, Math.max(0, game.health + HEALTH_DELTA[result]));

  el("hud-score").textContent = game.score;
  showJudgment(result);
  showCombo();
  updateHealthUI();

  if (result === "miss" || result === "shit") bounceAvatar("opponent");
  else bounceAvatar("player");
}

function updateHealthUI() {
  const pct = game.health;
  el("healthbar-fill").style.width = `${pct}%`;
  el("healthbar-marker").style.left = `${pct}%`;
}

function bounceAvatar(who) {
  const avatar = el(`avatar-${who}`);
  avatar.classList.remove("bop");
  void avatar.offsetWidth;
  avatar.classList.add("bop");
}

function showJudgment(result) {
  const j = el("judgment");
  j.textContent = result.toUpperCase();
  j.className = `judgment show ${result}`;
  // 리플로우 트릭으로 애니메이션 재시작
  void j.offsetWidth;
  j.classList.add("show");
}

function showCombo() {
  const c = el("hud-combo");
  if (game.combo >= 2) {
    c.textContent = `${game.combo} COMBO`;
    c.classList.add("show");
  } else {
    c.classList.remove("show");
  }
}

function flashKeycap(lane) {
  const receptor = document.querySelector(`.receptor.${lane}`);
  if (!receptor) return;
  receptor.classList.add("hit");
  setTimeout(() => receptor.classList.remove("hit"), 120);
}

function endGame() {
  cancelAnimationFrame(game.rafId);
  if (game.audio) game.audio.pause();
  if (game.ytPlayer) game.ytPlayer.pauseVideo();
  el("bg-video").pause();

  el("result-score").textContent = game.score;
  el("stat-sick").textContent = game.sick;
  el("stat-good").textContent = game.good;
  el("stat-bad").textContent = game.bad;
  el("stat-shit").textContent = game.shit;
  el("stat-miss").textContent = game.miss;
  el("stat-max-combo").textContent = game.maxCombo;

  showScreen("result");
}

function gameOver() {
  cancelAnimationFrame(game.rafId);
  if (game.audio) game.audio.pause();
  if (game.ytPlayer) game.ytPlayer.pauseVideo();
  el("bg-video").pause();
  showScreen("gameover");
}

// ---------------------------------------------------------------------
// 입력 처리
// ---------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (LANES.includes(key)) handleKeyLane(key);
});

document.querySelectorAll(".receptor").forEach((r) => {
  r.addEventListener("pointerdown", () => handleKeyLane(r.dataset.lane));
});

el("retry-btn").addEventListener("click", () => startGame(game.song.id));
el("back-btn").addEventListener("click", () => {
  showScreen("menu");
  loadSongList();
});
el("gameover-retry-btn").addEventListener("click", () => startGame(game.song.id));
el("gameover-back-btn").addEventListener("click", () => {
  showScreen("menu");
  loadSongList();
});

// ---------------------------------------------------------------------
// 디스코드 /play 명령어에서 보내주는 링크(?song=id) 처리
// ---------------------------------------------------------------------

async function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const directId = params.get("song");

  if (!directId) {
    loadSongList();
    return;
  }

  const listEl = el("song-list");
  listEl.innerHTML = `<div class="empty-state">노래 정보를 불러오는 중...</div>`;

  try {
    const res = await fetch(`${API_BASE}/songs/${encodeURIComponent(directId)}`);
    if (!res.ok) throw new Error("not found");
    const song = await res.json();

    listEl.innerHTML = "";
    const card = document.createElement("div");
    card.className = "song-card";
    card.innerHTML = `
      <div>
        <div class="title">${escapeHtml(song.title)}</div>
        <div class="meta">${escapeHtml(song.artist || "Unknown")} · BPM ${song.bpm ?? "?"} · 노트 ${song.notes.length}개</div>
      </div>
      <div class="diff">▶ 시작하기</div>
    `;
    card.addEventListener("click", () => startGame(directId));
    listEl.appendChild(card);

    const viewAll = document.createElement("div");
    viewAll.style.cssText = "text-align:center; margin-top:10px;";
    viewAll.innerHTML = `<button class="ghost" id="view-all-btn">다른 곡도 보기</button>`;
    listEl.appendChild(viewAll);
    el("view-all-btn").addEventListener("click", () => {
      history.replaceState(null, "", location.pathname);
      loadSongList();
    });
  } catch {
    listEl.innerHTML = `<div class="empty-state">'${escapeHtml(directId)}' 노래를 찾을 수 없어요.</div>`;
    setTimeout(loadSongList, 1500);
  }
}

// ---------------------------------------------------------------------
initFromUrl();
