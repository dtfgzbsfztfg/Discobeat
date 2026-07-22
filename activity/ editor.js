const LANES = ["d", "f", "j", "k"];
const el = (id) => document.getElementById(id);

let recording = false;
let startTime = null;
let notes = []; // {time_ms, lane}
const player = el("player");

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
    if (window.YT && window.YT.Player) { resolve(); return; }
    window.onYouTubeIframeAPIReady = () => resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiReadyPromise;
}

let ytPlayer = null;
async function ensureYouTubePlayer(videoId) {
  await loadYouTubeApi();
  if (ytPlayer) {
    ytPlayer.loadVideoById(videoId);
    return ytPlayer;
  }
  return new Promise((resolve) => {
    ytPlayer = new YT.Player("yt-player", {
      videoId,
      width: "100%",
      height: "220",
      events: { onReady: () => resolve(ytPlayer) },
    });
  });
}

el("f-audio").addEventListener("input", () => {
  const url = el("f-audio").value.trim();
  const ytId = extractYouTubeId(url);
  if (ytId) {
    player.style.display = "none";
    el("yt-player-wrap").style.display = "block";
    ensureYouTubePlayer(ytId);
  } else if (url) {
    el("yt-player-wrap").style.display = "none";
    player.style.display = "block";
    player.src = url;
  } else {
    player.style.display = "none";
    el("yt-player-wrap").style.display = "none";
  }
});

el("btn-start").addEventListener("click", () => {
  recording = true;
  startTime = performance.now();
  notes = [];
  renderLog();
  el("btn-start").disabled = true;
  el("btn-stop").disabled = false;
  const status = el("rec-status");
  status.textContent = "녹음 중... D / F / J / K 를 눌러 노트를 기록하세요.";
  status.classList.add("on");

  if (player.src && player.style.display !== "none") {
    player.currentTime = 0;
    player.play().catch(() => {});
  }
  if (ytPlayer && el("yt-player-wrap").style.display !== "none") {
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
  }
});

el("btn-stop").addEventListener("click", stopRecording);

function stopRecording() {
  recording = false;
  player.pause();
  if (ytPlayer) ytPlayer.pauseVideo();
  el("btn-start").disabled = false;
  el("btn-stop").disabled = true;
  const status = el("rec-status");
  status.textContent = `녹음 종료 - 노트 ${notes.length}개 기록됨.`;
  status.classList.remove("on");
}

el("btn-undo").addEventListener("click", () => {
  notes.pop();
  renderLog();
});

el("btn-clear").addEventListener("click", () => {
  notes = [];
  renderLog();
});

document.addEventListener("keydown", (e) => {
  if (e.repeat || !recording) return;
  const key = e.key.toLowerCase();
  if (!LANES.includes(key)) return;
  const time_ms = Math.round(performance.now() - startTime);
  notes.push({ time_ms, lane: key });
  renderLog();
});

function renderLog() {
  const log = el("note-log");
  log.innerHTML = notes
    .slice()
    .sort((a, b) => a.time_ms - b.time_ms)
    .map((n) => `<div><span>${n.time_ms} ms</span><span>${n.lane.toUpperCase()}</span></div>`)
    .join("") || "<div>아직 기록된 노트가 없어요.</div>";
}

function buildChart() {
  const sorted = notes.slice().sort((a, b) => a.time_ms - b.time_ms);
  const duration = sorted.length ? sorted[sorted.length - 1].time_ms + 1500 : 0;
  return {
    id: el("f-id").value.trim() || "untitled",
    title: el("f-title").value.trim() || "제목 없음",
    artist: el("f-artist").value.trim() || "",
    bpm: Number(el("f-bpm").value) || null,
    difficulty: el("f-difficulty").value,
    duration_ms: duration,
    audio_url: el("f-audio").value.trim() || null,
    offset_ms: 0,
    notes: sorted,
  };
}

el("btn-export").addEventListener("click", () => {
  const chart = buildChart();
  const json = JSON.stringify(chart, null, 2);
  el("output").value = json;

  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${chart.id || "chart"}.json`;
  a.click();
});

el("btn-copy").addEventListener("click", async () => {
  const json = el("output").value || JSON.stringify(buildChart(), null, 2);
  el("output").value = json;
  try {
    await navigator.clipboard.writeText(json);
    el("rec-status").textContent = "클립보드에 복사했어요.";
  } catch {
    el("rec-status").textContent = "복사에 실패했어요. 직접 선택해서 복사해주세요.";
  }
});

el("btn-autogen").addEventListener("click", () => {
  const bpm = Number(el("f-bpm").value);
  const durationSec = Number(el("auto-duration").value);
  const density = Number(el("auto-density").value); // 1=한박자, 2=반박자, 4=4분박

  if (!bpm || bpm <= 0) {
    alert("먼저 BPM을 입력해주세요.");
    return;
  }
  if (!durationSec || durationSec <= 0) {
    alert("노래 길이(초)를 입력해주세요.");
    return;
  }

  const beatMs = 60000 / bpm;
  const stepMs = beatMs / density;
  const totalMs = durationSec * 1000;

  const generated = [];
  let lastLane = null;
  let sameLaneStreak = 0;

  for (let t = beatMs; t < totalMs; t += stepMs) {
    // 같은 레인이 3번 연속 나오지 않도록 살짝 제어
    let lane;
    do {
      lane = LANES[Math.floor(Math.random() * LANES.length)];
    } while (lane === lastLane && sameLaneStreak >= 2);

    sameLaneStreak = lane === lastLane ? sameLaneStreak + 1 : 1;
    lastLane = lane;

    generated.push({ time_ms: Math.round(t), lane });
  }

  notes = generated;
  renderLog();
  el("rec-status").textContent = `자동 생성 완료 - 노트 ${notes.length}개 (BPM ${bpm}, ${durationSec}초).`;
  el("rec-status").classList.remove("on");
});
