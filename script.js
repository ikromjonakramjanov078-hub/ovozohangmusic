
const $ = id => document.getElementById(id);

const startMicBtn = $("startMic");
const stopMicBtn = $("stopMic");
const startMusicBtn = $("startMusic");
const stopMusicBtn = $("stopMusic");
const canvas = $("wave");
const ctx = canvas.getContext("2d");

let audioCtx = null;
let micStream = null;
let micSource = null;
let analyser = null;
let micData = null;
let musicMaster = null;
let musicTimer = null;
let musicRunning = false;
let selectedMood = "auto";
let bpm = 72;
let volume = 0;
let smoothVolume = 0;
let recording = false;
let recorder = null;
let chunks = [];
let recordStream = null;
let recordSamples = [];
let recordPeak = 0;
let recordStart = 0;
let recordClock = null;
let recordedBlob = null;
let recordedUrl = null;
let waveFrame = null;

function setStatus(text, active = false) {
  $("status").textContent = text;
  $("statusDot").classList.toggle("active", active);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawIdle();
}

function drawIdle() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255,210,31,.10)";
  for (let x = 0; x < w; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const y = h / 2 + Math.sin(x * .035) * 3;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(255,210,31,.6)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawWave() {
  if (!analyser || !micData) {
    drawIdle();
    return;
  }

  analyser.getByteTimeDomainData(micData);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  for (let i = 0; i < micData.length; i++) {
    const x = i / (micData.length - 1) * w;
    const y = micData[i] / 255 * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = "#ffd21f";
  ctx.lineWidth = 2;
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#ffd21f";
  ctx.stroke();
  ctx.shadowBlur = 0;

  waveFrame = requestAnimationFrame(drawWave);
}

async function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") await audioCtx.resume();
}

async function startMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Mikrofon uchun Chrome yoki Edge brauzeridan localhost/HTTPS orqali foydalan.");
    return;
  }

  try {
    await getAudioContext();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    });

    micSource = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    micSource.connect(analyser);

    micData = new Uint8Array(analyser.fftSize);

    startMicBtn.disabled = true;
    stopMicBtn.disabled = false;
    $("micBadge").textContent = "JONLI";
    $("micBadge").classList.add("active");
    setStatus("Mikrofon faol", true);

    cancelAnimationFrame(waveFrame);
    drawWave();
    analyseLoop();
  } catch (error) {
    console.error(error);
    alert("Mikrofon ruxsatini tekshir. (" + error.name + ")");
  }
}

function stopMic() {
  if (micStream) micStream.getTracks().forEach(track => track.stop());
  micStream = null;
  micSource = null;
  analyser = null;
  micData = null;
  cancelAnimationFrame(waveFrame);

  startMicBtn.disabled = false;
  stopMicBtn.disabled = true;
  $("micBadge").textContent = "KUTISHDA";
  $("micBadge").classList.remove("active");
  $("volume").textContent = "0%";
  $("volumeBar").style.width = "0%";
  $("orb").style.transform = "translate(-50%, -50%) scale(1)";
  drawIdle();
  setStatus(musicRunning ? "Musiqa ijro etilmoqda" : "Tizim tayyor", musicRunning);
}

function analyseLoop() {
  if (!analyser || !micData) return;

  analyser.getByteTimeDomainData(micData);
  let sum = 0;

  for (let i = 0; i < micData.length; i++) {
    const value = (micData[i] - 128) / 128;
    sum += value * value;
  }

  const rms = Math.sqrt(sum / micData.length);
  const raw = Math.min(100, Math.round(rms * 360));
  smoothVolume = smoothVolume * 0.72 + raw * 0.28;
  volume = Math.round(smoothVolume);

  $("volume").textContent = volume + "%";
  $("volumeBar").style.width = volume + "%";
  $("orb").style.transform =
    `translate(-50%, -50%) scale(${1 + volume / 180})`;

  // Taxminiy gapirish faolligi, so‘zlar soni emas.
  const activity = volume > 7 ? Math.min(100, Math.round(volume * 1.4)) : 0;
  $("speed").textContent = activity ? activity + "%" : "—";
  $("speedBar").style.width = activity + "%";

  if (recording) {
    recordSamples.push(volume);
    recordPeak = Math.max(recordPeak, volume);
  }

  if (musicRunning && selectedMood === "auto") {
    bpm = volume > 5
      ? Math.round(Math.max(62, Math.min(150, 68 + volume * 0.55)))
      : 66;
    $("bpm").innerHTML = `${bpm} <small>BPM</small>`;
    $("bpmBar").style.width = ((bpm - 60) / 100 * 100) + "%";
    updateAutoMood();
  }

  requestAnimationFrame(analyseLoop);
}

function updateAutoMood() {
  if (volume > 48) {
    $("moodName").textContent = "Jo‘shqin ritm";
    $("musicHint").textContent = "Ovoz kuchaydi — ritm tezlashdi";
  } else if (volume < 8) {
    $("moodName").textContent = "Mayin kuy";
    $("musicHint").textContent = "Sokin ovoz — mayin ohang";
  } else {
    $("moodName").textContent = "Orzuviy elektron";
    $("musicHint").textContent = "Ovozga mos ritm";
  }
}

const notes = [130.81, 146.83, 164.81, 196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25];

function playTone(frequency, duration, when, loudness = 0.08, type = "sine") {
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, loudness), when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  oscillator.connect(gain);
  gain.connect(musicMaster);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.03);
}

function playKick(when, loudness = 0.2) {
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(120, when);
  oscillator.frequency.exponentialRampToValueAtTime(40, when + 0.14);
  gain.gain.setValueAtTime(loudness, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.17);

  oscillator.connect(gain);
  gain.connect(musicMaster);
  oscillator.start(when);
  oscillator.stop(when + 0.18);
}

function playHat(when) {
  const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.1, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();

  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = 6000;
  gain.gain.setValueAtTime(0.025, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.08);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(musicMaster);
  source.start(when);
  source.stop(when + 0.09);
}

function scheduleMusic() {
  if (!musicRunning) return;

  const now = audioCtx.currentTime;
  let beatBpm = bpm;

  if (selectedMood === "calm") beatBpm = 68;
  if (selectedMood === "energy") beatBpm = 128;
  if (selectedMood === "dream") beatBpm = 88;

  const beat = 60 / beatBpm;
  let mood = selectedMood;

  if (mood === "auto") {
    mood = volume > 48 ? "energy" : volume < 8 ? "calm" : "dream";
  }

  for (let i = 0; i < 4; i++) {
    const time = now + i * beat;

    if (mood === "energy") {
      if (i === 0 || i === 2) playKick(time, 0.22);
      playHat(time + beat / 2);
      playTone(notes[(i * 2 + 3) % notes.length], 0.12, time + 0.02, 0.045, "triangle");
    } else if (mood === "calm") {
      playTone([261.63, 329.63, 392, 329.63][i], beat * 0.85, time, 0.07);
      if (i === 0) playTone(130.81, beat * 1.5, time, 0.04, "triangle");
    } else {
      if (i === 0 || i === 2) playKick(time, 0.1);
      playTone(notes[[0, 3, 5, 7][i]], beat * 0.8, time, 0.045);
      playHat(time + beat / 2);
    }
  }

  musicTimer = setTimeout(scheduleMusic, beat * 4 * 1000 - 25);
}

async function startMusic() {
  try {
    await getAudioContext();
    if (musicRunning) return;

    musicMaster = audioCtx.createGain();
    musicMaster.gain.value = Number($("musicVolume").value) / 100;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 5;
    musicMaster.connect(compressor);
    compressor.connect(audioCtx.destination);

    musicRunning = true;
    startMusicBtn.disabled = true;
    stopMusicBtn.disabled = false;
    setStatus(micStream ? "Mikrofon va musiqa faol" : "Musiqa ijro etilmoqda", true);
    scheduleMusic();
  } catch (error) {
    console.error(error);
    alert("Musiqani boshlashda xatolik yuz berdi.");
  }
}

function stopMusic() {
  musicRunning = false;
  clearTimeout(musicTimer);
  if (musicMaster) {
    try { musicMaster.disconnect(); } catch (error) {}
    musicMaster = null;
  }
  startMusicBtn.disabled = false;
  stopMusicBtn.disabled = true;
  setStatus(micStream ? "Mikrofon faol" : "Tizim tayyor", !!micStream);
  $("musicHint").textContent = "Musiqa to‘xtatildi";
}

function chooseMood(mood) {
  selectedMood = mood;

  document.querySelectorAll(".mood").forEach(button => {
    button.classList.toggle("selected", button.dataset.mood === mood);
  });

  const names = {
    auto: "Moslashuv rejimi",
    calm: "Mayin kuy",
    energy: "Jo‘shqin ritm",
    dream: "Orzuviy elektron"
  };

  $("moodName").textContent = names[mood];
  $("musicHint").textContent = mood === "auto"
    ? "Ovozga qarab o‘zgaradi"
    : "Tanlangan musiqa uslubi";

  if (musicRunning) {
    stopMusic();
    startMusic();
  }
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("Ovoz yozish uchun yangiroq Chrome yoki Edge brauzeridan foydalan.");
    return;
  }

  try {
    recordStream = micStream || await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recordSamples = [];
    recordPeak = 0;
    recording = true;
    recordStart = Date.now();

    const options = {};
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      options.mimeType = "audio/webm;codecs=opus";
    }

    recorder = new MediaRecorder(recordStream, options);
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };

    recorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });

      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      recordedUrl = URL.createObjectURL(recordedBlob);
      $("audioPlayer").src = recordedUrl;
      $("audioPlayer").hidden = false;
      $("playRecord").disabled = false;
      $("downloadRecord").disabled = false;

      const average = recordSamples.length
        ? Math.round(recordSamples.reduce((a, b) => a + b, 0) / recordSamples.length)
        : 0;

      $("avg").textContent = average + "%";
      $("peak").textContent = recordPeak + "%";
      $("analysis").textContent = average < 8 ? "Sokin" : average > 35 ? "Kuchli" : "O‘rtacha";
      $("results").hidden = false;
      $("recordState").textContent = "Yozuv tayyor";
      $("recordCircle").classList.remove("active");
      $("recordBtn").disabled = false;
      $("finishRecord").disabled = true;

      if (!micStream && recordStream) {
        recordStream.getTracks().forEach(track => track.stop());
        recordStream = null;
      }
    };

    recorder.start(250);
    $("recordBtn").disabled = true;
    $("finishRecord").disabled = false;
    $("recordState").textContent = "Yozilmoqda…";
    $("recordCircle").classList.add("active");

    recordClock = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordStart) / 1000);
      $("timer").textContent =
        String(Math.floor(seconds / 60)).padStart(2, "0") + ":" +
        String(seconds % 60).padStart(2, "0");
    }, 250);
  } catch (error) {
    console.error(error);
    alert("Mikrofon ruxsatini tekshir. (" + error.name + ")");
    recording = false;
  }
}

function stopRecording() {
  if (!recorder || recorder.state === "inactive") return;
  recording = false;
  clearInterval(recordClock);
  recorder.stop();
}

function downloadRecording() {
  if (!recordedBlob) return;
  const url = URL.createObjectURL(recordedBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ovoz-dj-yozuv.webm";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

startMicBtn.addEventListener("click", startMic);
stopMicBtn.addEventListener("click", stopMic);
startMusicBtn.addEventListener("click", startMusic);
stopMusicBtn.addEventListener("click", stopMusic);

$("musicVolume").addEventListener("input", () => {
  const value = Number($("musicVolume").value);
  $("volumeLabel").textContent = value + "%";
  if (musicMaster && audioCtx) {
    musicMaster.gain.setTargetAtTime(value / 100, audioCtx.currentTime, 0.05);
  }
});

document.querySelectorAll(".mood").forEach(button => {
  button.addEventListener("click", () => chooseMood(button.dataset.mood));
});

$("recordBtn").addEventListener("click", startRecording);
$("finishRecord").addEventListener("click", stopRecording);
$("playRecord").addEventListener("click", () => $("audioPlayer").play());
$("downloadRecord").addEventListener("click", downloadRecording);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", () => {
  if (micStream) micStream.getTracks().forEach(track => track.stop());
  if (recordStream && !micStream) recordStream.getTracks().forEach(track => track.stop());
  if (audioCtx) audioCtx.close();
});

resizeCanvas();
drawIdle();
