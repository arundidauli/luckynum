const ROUND_MS = 70;
const BET_SEC = 45;
const CLOSE_DELAY = 6;
const BET_AMOUNTS = [10, 20, 50, 100];
const WIN_MULT = 1.8;
const STORAGE_KEY_PREFIX = "luckynum_ui_flow_v2";
const SUPABASE_URL = "https://pggdyjjwwvzwiscsqqas.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_J8Lollpoo9c-b8dv0Gy2wA_R5QKtPnQ";
const AUDIO_MASTER_GAIN = 0.16;

const dom = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  usernameInput: document.getElementById("usernameInput"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  signInButton: document.getElementById("signInButton"),
  signUpButton: document.getElementById("signUpButton"),
  signOutButton: document.getElementById("signOutButton"),
  authMessage: document.getElementById("authMessage"),
  soundButton: document.getElementById("soundButton"),
  playerName: document.getElementById("playerName"),
  inlinePlayerName: document.getElementById("inlinePlayerName"),
  avatarBadge: document.getElementById("avatarBadge"),
  balanceValue: document.getElementById("balanceValue"),
  statsBalance: document.getElementById("statsBalance"),
  statsRecord: document.getElementById("statsRecord"),
  statsBest: document.getElementById("statsBest"),
  statsWinRate: document.getElementById("statsWinRate"),
  phaseLabel: document.getElementById("phaseLabel"),
  roundLabel: document.getElementById("roundLabel"),
  timerLabel: document.getElementById("timerLabel"),
  timerFill: document.getElementById("timerFill"),
  statusCard: document.getElementById("statusCard"),
  resultShuffle: document.getElementById("resultShuffle"),
  resultTitle: document.getElementById("resultTitle"),
  resultCopy: document.getElementById("resultCopy"),
  lastResultChip: document.getElementById("lastResultChip"),
  selectionChip: document.getElementById("selectionChip"),
  numbersGrid: document.getElementById("numbersGrid"),
  coinsRow: document.getElementById("coinsRow"),
  activeBetText: document.getElementById("activeBetText"),
  potentialWinText: document.getElementById("potentialWinText"),
  placeButtonWrap: document.getElementById("placeButtonWrap"),
  streakIcons: document.getElementById("streakIcons"),
  streakText: document.getElementById("streakText"),
  historyList: document.getElementById("historyList"),
  hashBox: document.getElementById("hashBox"),
  closedOverlay: document.getElementById("closedOverlay"),
  toast: document.getElementById("toast"),
};

const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
let masterGainNode = null;
if (AudioContextCtor) {
  try {
    audioContext = new AudioContextCtor();
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = AUDIO_MASTER_GAIN;
    masterGainNode.connect(audioContext.destination);
  } catch (error) {
    console.error("Audio context init failed", error);
  }
}
const createClient = window.supabase?.createClient;
const supabaseConfigured =
  typeof createClient === "function" &&
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_ANON_KEY) &&
  !SUPABASE_ANON_KEY.startsWith("REPLACE_WITH_");
const supabaseClient = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

let state = createDefaultState();
let authUser = null;
let pendingSeed = "";
let loopInterval;
let toastTimer;
let shuffleInterval;
let saveTimer;
let authSubscription;
let currentSessionToken = "";
let hasShownPersistenceWarning = false;
let isHydratingSession = false;
let authSettings = null;

function createDefaultState(user = {}) {
  return {
    user: {
      id: user.id || "",
      email: user.email || "",
      name: user.name || "",
      balance: 500,
      wins: 0,
      losses: 0,
      bestStreak: 0,
    },
    soundOn: true,
    round: 1,
    phase: "betting",
    tick: 0,
    selectedNumber: null,
    selectedAmount: null,
    currentBet: null,
    history: [],
    recentWinners: [],
    streak: [],
    currentStreak: 0,
    lastResult: null,
    commitHash: "",
    savedAt: null,
  };
}

function formatCurrency(value) {
  return `₹${Number(value || 0)}`;
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 2200);
}

async function ensureAudioReady() {
  if (!audioContext || !masterGainNode) {
    return false;
  }

  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (error) {
      console.error("Audio resume failed", error);
      return false;
    }
  }

  return audioContext.state === "running";
}

function createNoiseBuffer() {
  if (!audioContext) {
    return null;
  }

  const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.18, audioContext.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playTone({
  freq,
  type = "sine",
  duration = 0.12,
  volume = 0.1,
  attack = 0.01,
  release = 0.12,
  detune = 0,
  endFreq = freq,
}) {
  if (!state.soundOn || !audioContext || !masterGainNode || audioContext.state !== "running") {
    return;
  }

  try {
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(masterGainNode);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), now + duration);
    oscillator.detune.setValueAtTime(detune, now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);
    oscillator.start(now);
    oscillator.stop(now + duration + release);
  } catch (error) {
    console.error("Audio failed", error);
  }
}

function playNoiseBurst({ duration = 0.08, volume = 0.035, highpass = 700 }) {
  if (!state.soundOn || !audioContext || !masterGainNode || audioContext.state !== "running") {
    return;
  }

  try {
    const now = audioContext.currentTime;
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gainNode = audioContext.createGain();
    const noiseBuffer = createNoiseBuffer();
    if (!noiseBuffer) {
      return;
    }

    source.buffer = noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(highpass, now);
    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(masterGainNode);
    gainNode.gain.setValueAtTime(volume, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.start(now);
    source.stop(now + duration);
  } catch (error) {
    console.error("Noise burst failed", error);
  }
}

function sfx(type) {
  if (type === "tick") {
    playTone({
      freq: 880,
      endFreq: 760,
      type: "triangle",
      duration: 0.025,
      release: 0.05,
      volume: 0.018,
    });
  }
  if (type === "place") {
    playTone({
      freq: 420,
      endFreq: 690,
      type: "triangle",
      duration: 0.08,
      release: 0.1,
      volume: 0.08,
    });
    setTimeout(() => {
      playTone({
        freq: 820,
        endFreq: 980,
        type: "sine",
        duration: 0.06,
        release: 0.08,
        volume: 0.06,
      });
    }, 45);
  }
  if (type === "win") {
    [
      [523, 659],
      [659, 784],
      [784, 1046],
    ].forEach(([startFreq, endFreq], index) => {
      setTimeout(() => {
        playTone({
          freq: startFreq,
          endFreq,
          type: "sine",
          duration: 0.14,
          release: 0.12,
          volume: 0.11,
        });
      }, index * 95);
    });
    setTimeout(() => playNoiseBurst({ duration: 0.11, volume: 0.015, highpass: 1800 }), 40);
  }
  if (type === "loss") {
    playTone({
      freq: 260,
      endFreq: 120,
      type: "sawtooth",
      duration: 0.14,
      release: 0.14,
      volume: 0.075,
    });
  }
  if (type === "close") {
    playTone({
      freq: 320,
      endFreq: 160,
      type: "square",
      duration: 0.12,
      release: 0.08,
      volume: 0.05,
    });
    setTimeout(() => {
      playTone({
        freq: 210,
        endFreq: 130,
        type: "triangle",
        duration: 0.12,
        release: 0.08,
        volume: 0.045,
      });
    }, 90);
  }
  if (type === "toggleOn") {
    playTone({
      freq: 520,
      endFreq: 780,
      type: "sine",
      duration: 0.06,
      release: 0.07,
      volume: 0.06,
    });
  }
  if (type === "toggleOff") {
    playTone({
      freq: 460,
      endFreq: 260,
      type: "triangle",
      duration: 0.05,
      release: 0.06,
      volume: 0.045,
    });
  }
}

async function sha256(value) {
  if (!crypto?.subtle) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return Array.from({ length: 8 }, (_, index) =>
      ((hash >>> ((index % 4) * 8)) & 255).toString(16).padStart(2, "0")
    ).join("");
  }

  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function commitHash() {
  pendingSeed = `${Math.random().toString(36).slice(2)}${Date.now()}`;
  state.commitHash = await sha256(pendingSeed);
  dom.hashBox.textContent = state.commitHash;
}

async function revealWinningNumber() {
  const hash = await sha256(pendingSeed);
  return (parseInt(hash.slice(0, 8), 16) % 10) + 1;
}

function getUserStorageKey(userId) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function exportPersistedState() {
  return {
    user: {
      balance: state.user.balance,
      wins: state.user.wins,
      losses: state.user.losses,
      bestStreak: state.user.bestStreak,
      name: state.user.name,
    },
    soundOn: state.soundOn,
    round: state.round,
    history: state.history,
    recentWinners: state.recentWinners,
    streak: state.streak,
    currentStreak: state.currentStreak,
    lastResult: state.lastResult,
    savedAt: new Date().toISOString(),
  };
}

function applyPersistedState(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const nextState = createDefaultState(state.user);
  state = {
    ...nextState,
    ...payload,
    user: {
      ...nextState.user,
      ...(payload.user || {}),
      id: state.user.id,
      email: state.user.email,
      name: state.user.name || payload.user?.name || nextState.user.name,
    },
    phase: "betting",
    tick: 0,
    selectedNumber: null,
    selectedAmount: null,
    currentBet: null,
    commitHash: "",
  };
}

function chooseLatestState(localPayload, remotePayload) {
  if (!localPayload) {
    return remotePayload;
  }
  if (!remotePayload) {
    return localPayload;
  }

  const localTime = Date.parse(localPayload.savedAt || 0);
  const remoteTime = Date.parse(remotePayload.savedAt || 0);
  return remoteTime > localTime ? remotePayload : localPayload;
}

function loadLocalState(userId) {
  if (!userId) {
    return null;
  }

  try {
    const saved = localStorage.getItem(getUserStorageKey(userId));
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.error("Local load failed", error);
    return null;
  }
}

function warnPersistenceIssue(context, error) {
  console.error(context, error);
  if (hasShownPersistenceWarning) {
    return;
  }
  hasShownPersistenceWarning = true;
  showToast("Supabase tables are not ready. Run `supabase db push` after linking.");
}

async function loadRemoteState(userId) {
  if (!supabaseClient || !userId) {
    return null;
  }

  const { data, error } = await supabaseClient
    .from("game_states")
    .select("payload")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    warnPersistenceIssue("Remote state load failed", error);
    return null;
  }

  return data?.payload || null;
}

function queueRemoteSave() {
  if (!supabaseClient || !authUser?.id) {
    return;
  }

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void syncStateToSupabase();
  }, 400);
}

function saveState({ syncRemote = true } = {}) {
  if (!authUser?.id) {
    return;
  }

  try {
    const payload = exportPersistedState();
    state.savedAt = payload.savedAt;
    localStorage.setItem(getUserStorageKey(authUser.id), JSON.stringify(payload));
    if (syncRemote) {
      queueRemoteSave();
    }
  } catch (error) {
    console.error("Local save failed", error);
  }
}

async function syncStateToSupabase() {
  if (!supabaseClient || !authUser?.id) {
    return;
  }

  const { error } = await supabaseClient.from("game_states").upsert(
    {
      user_id: authUser.id,
      payload: exportPersistedState(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    warnPersistenceIssue("Remote state save failed", error);
  }
}

function getDisplayName(user = authUser, profile = null) {
  return (
    profile?.username ||
    user?.user_metadata?.username ||
    user?.email?.split("@")[0] ||
    "Player"
  );
}

function updatePlayerUI() {
  dom.playerName.textContent = state.user.name || "Player";
  dom.inlinePlayerName.textContent = state.user.name || "Player";
  dom.avatarBadge.textContent = state.user.name ? state.user.name[0].toUpperCase() : "?";
  dom.balanceValue.textContent = formatCurrency(state.user.balance);
  dom.statsBalance.textContent = formatCurrency(state.user.balance);
  dom.soundButton.textContent = state.soundOn ? "🔊" : "🔇";
}

function updateStatsUI() {
  const totalGames = state.user.wins + state.user.losses;
  dom.statsRecord.textContent = `${state.user.wins}/${state.user.losses}`;
  dom.statsBest.textContent = state.user.bestStreak;
  dom.statsWinRate.textContent = totalGames
    ? `${Math.round((state.user.wins / totalGames) * 100)}%`
    : "-";
  updatePlayerUI();
}

function updateSelectionUI() {
  if (!state.selectedNumber || !state.selectedAmount) {
    dom.selectionChip.textContent = state.selectedNumber
      ? `Selected #${state.selectedNumber}`
      : "No number selected";
    dom.selectionChip.classList.toggle("selected", Boolean(state.selectedNumber));
    return;
  }

  dom.selectionChip.textContent = `#${state.selectedNumber} · ${formatCurrency(
    state.selectedAmount
  )}`;
  dom.selectionChip.classList.add("selected");
}

function updateActiveBetUI() {
  if (!state.currentBet) {
    dom.activeBetText.textContent = "No active bet";
    dom.potentialWinText.textContent = "-";
    return;
  }

  dom.activeBetText.textContent = `#${state.currentBet.num} for ${formatCurrency(
    state.currentBet.amount
  )}`;
  dom.potentialWinText.textContent = formatCurrency(
    Math.round(state.currentBet.amount * WIN_MULT)
  );
}

function renderNumbers() {
  dom.numbersGrid.innerHTML = "";
  const heats = Array(10).fill(0);
  state.recentWinners.forEach((winner) => {
    heats[winner - 1] += 1;
  });
  const maxHeat = Math.max(...heats, 1);

  for (let number = 1; number <= 10; number += 1) {
    const button = document.createElement("button");
    const heatPercent = Math.round((heats[number - 1] / maxHeat) * 100);
    button.className = `number-btn${state.selectedNumber === number ? " selected" : ""}`;
    button.disabled = state.phase !== "betting";
    button.innerHTML = `
      <span class="num-value">${number}</span>
      <span class="num-heat">${heatPercent}% heat</span>
    `;
    button.addEventListener("click", () => {
      if (state.phase !== "betting") {
        return;
      }
      state.selectedNumber = number;
      renderNumbers();
      updateSelectionUI();
      updatePlaceButton();
      button.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }],
        { duration: 180, easing: "ease-out" }
      );
    });
    dom.numbersGrid.appendChild(button);
  }
}

function renderCoins() {
  dom.coinsRow.innerHTML = "";
  BET_AMOUNTS.forEach((amount) => {
    const button = document.createElement("button");
    button.className = `coin-btn${state.selectedAmount === amount ? " selected" : ""}`;
    button.disabled = state.phase !== "betting";
    button.textContent = formatCurrency(amount);
    button.addEventListener("click", () => {
      if (state.phase !== "betting") {
        return;
      }
      state.selectedAmount = amount;
      renderCoins();
      updateSelectionUI();
      updatePlaceButton();
    });
    dom.coinsRow.appendChild(button);
  });
}

function updatePlaceButton() {
  if (state.phase !== "betting") {
    dom.placeButtonWrap.innerHTML =
      '<button class="btn-primary" disabled>Betting Closed</button>';
    return;
  }

  if (!state.selectedNumber || !state.selectedAmount) {
    dom.placeButtonWrap.innerHTML =
      '<button class="btn-primary" disabled>Choose number and amount</button>';
    return;
  }

  const refunded = state.currentBet ? state.currentBet.amount : 0;
  const available = state.user.balance + refunded;
  if (available < state.selectedAmount) {
    dom.placeButtonWrap.innerHTML =
      '<button class="btn-primary" disabled>Balance too low</button>';
    return;
  }

  const label = state.currentBet ? "Update Bet" : "Place Bet";
  dom.placeButtonWrap.innerHTML = `<button class="btn-primary" id="placeBetButton">${label}</button>`;
  document.getElementById("placeBetButton").addEventListener("click", applyBet);
}

function applyBet() {
  if (state.phase !== "betting" || !state.selectedNumber || !state.selectedAmount) {
    return;
  }

  const previousAmount = state.currentBet ? state.currentBet.amount : 0;
  const available = state.user.balance + previousAmount;
  if (available < state.selectedAmount) {
    showToast("Balance too low for this bet.");
    return;
  }

  state.user.balance = available - state.selectedAmount;
  state.currentBet = { num: state.selectedNumber, amount: state.selectedAmount };
  updatePlayerUI();
  updateStatsUI();
  updateActiveBetUI();
  updatePlaceButton();
  dom.resultTitle.textContent = `Bet placed on ${state.currentBet.num} for ${formatCurrency(
    state.currentBet.amount
  )}`;
  dom.resultCopy.textContent = "You can still change number or amount until betting closes.";
  sfx("place");
  showToast(
    `Bet placed on ${state.currentBet.num} for ${formatCurrency(state.currentBet.amount)}`
  );
  saveState();
}

function updateStatusUI() {
  dom.roundLabel.textContent = `Round #${state.round}`;

  if (state.phase === "betting") {
    dom.statusCard.className = "card status-card status-open";
    dom.phaseLabel.textContent = "Betting Open";
    return;
  }
  if (state.phase === "closed") {
    dom.statusCard.className = "card status-card status-closed";
    dom.phaseLabel.textContent = "Betting Closed";
    return;
  }
  dom.statusCard.className = "card status-card status-reveal";
  dom.phaseLabel.textContent = "Result Reveal";
}

function updateTimerUI() {
  if (state.phase === "betting") {
    const left = BET_SEC - state.tick;
    dom.timerLabel.textContent = `Betting closes in: 00:${String(left).padStart(2, "0")}`;
    dom.timerFill.style.width = `${(left / BET_SEC) * 100}%`;
    if (left <= 10 && left > 0) {
      sfx("tick");
    }
    return;
  }

  if (state.phase === "closed") {
    dom.timerLabel.textContent = "Betting closed";
    dom.timerFill.style.width = "0%";
    return;
  }

  const left = Math.max(0, ROUND_MS - state.tick);
  dom.timerLabel.textContent = `New round starts in: 00:${String(left).padStart(2, "0")}`;
  dom.timerFill.style.width = `${Math.max(0, (left / (ROUND_MS - BET_SEC)) * 100)}%`;
}

function renderHistory() {
  if (!state.history.length) {
    dom.historyList.innerHTML = '<div class="empty-state">No completed rounds yet.</div>';
    return;
  }

  dom.historyList.innerHTML = state.history
    .slice(0, 12)
    .map((entry) => {
      const badgeType = entry.userWon ? "win" : entry.userBet ? "loss" : "skip";
      const badgeLabel = entry.userWon ? "Won" : entry.userBet ? "Lost" : "Skipped";
      const winnerLine = entry.userWon
        ? `${state.user.name} won ${formatCurrency(entry.payout)}`
        : "No winner";

      return `
        <div class="history-item">
          <div class="history-ball">${entry.winningNumber}</div>
          <div class="history-copy">
            <div class="history-round">Round #${entry.round}</div>
            <div class="history-meta">${winnerLine}</div>
          </div>
          <div class="history-badge ${badgeType}">${badgeLabel}</div>
        </div>
      `;
    })
    .join("");
}

function renderStreak() {
  const recent = state.streak.slice(-5);
  while (recent.length < 5) {
    recent.unshift("N");
  }

  dom.streakIcons.innerHTML = recent
    .map((item) => {
      if (item === "W") {
        return '<span class="streak-dot win">W</span>';
      }
      if (item === "L") {
        return '<span class="streak-dot loss">L</span>';
      }
      return '<span class="streak-dot">-</span>';
    })
    .join("");

  dom.streakText.textContent =
    state.currentStreak > 0
      ? `🔥 ${state.currentStreak} wins`
      : state.currentStreak < 0
        ? `${Math.abs(state.currentStreak)} losses`
        : "-";
}

function startShuffleAnimation() {
  clearInterval(shuffleInterval);
  dom.resultShuffle.classList.add("shuffling");
  shuffleInterval = setInterval(() => {
    dom.resultShuffle.textContent = String(1 + Math.floor(Math.random() * 10));
  }, 100);
}

function stopShuffleAnimation(finalNumber) {
  clearInterval(shuffleInterval);
  dom.resultShuffle.classList.remove("shuffling");
  dom.resultShuffle.textContent = String(finalNumber);
}

async function revealResult() {
  state.phase = "reveal";
  updateStatusUI();
  updateTimerUI();
  dom.closedOverlay.classList.add("hidden");
  dom.resultTitle.textContent = "Revealing winning number...";
  dom.resultCopy.textContent = "Lottery style shuffle chal raha hai.";
  startShuffleAnimation();

  const winningNumber = await revealWinningNumber();
  setTimeout(() => {
    stopShuffleAnimation(winningNumber);

    const userWon = Boolean(state.currentBet && state.currentBet.num === winningNumber);
    const payout = userWon ? Math.round(state.currentBet.amount * WIN_MULT) : 0;

    if (userWon) {
      state.user.balance += payout;
      state.user.wins += 1;
      state.currentStreak = state.currentStreak > 0 ? state.currentStreak + 1 : 1;
      state.user.bestStreak = Math.max(state.user.bestStreak, state.currentStreak);
      state.streak.push("W");
      dom.resultTitle.textContent = `🎉 Winning Number: ${winningNumber}`;
      dom.resultCopy.textContent = `You won ${formatCurrency(payout)}!`;
      sfx("win");
    } else if (state.currentBet) {
      state.user.losses += 1;
      state.currentStreak = state.currentStreak < 0 ? state.currentStreak - 1 : -1;
      state.streak.push("L");
      dom.resultTitle.textContent = `Winning Number: ${winningNumber}`;
      dom.resultCopy.textContent = "Better luck next round.";
      sfx("loss");
    } else {
      state.streak.push("N");
      dom.resultTitle.textContent = `Winning Number: ${winningNumber}`;
      dom.resultCopy.textContent = "No bet this round.";
    }

    state.lastResult = winningNumber;
    state.recentWinners.push(winningNumber);
    if (state.recentWinners.length > 20) {
      state.recentWinners.shift();
    }
    dom.lastResultChip.textContent = `Last: ${winningNumber}`;

    state.history.unshift({
      round: state.round,
      winningNumber,
      userBet: state.currentBet ? { ...state.currentBet } : null,
      userWon,
      payout,
    });
    if (state.history.length > 30) {
      state.history.pop();
    }

    updatePlayerUI();
    updateStatsUI();
    renderStreak();
    renderHistory();
    renderNumbers();
    renderCoins();
    saveState();
  }, 1800);
}

async function resetRound() {
  state.round += 1;
  state.phase = "betting";
  state.tick = 0;
  state.selectedNumber = null;
  state.selectedAmount = null;
  state.currentBet = null;
  await commitHash();
  updateStatusUI();
  updateTimerUI();
  updateSelectionUI();
  updateActiveBetUI();
  renderNumbers();
  renderCoins();
  updatePlaceButton();
  dom.resultShuffle.textContent = "?";
  dom.resultTitle.textContent = "New round started";
  dom.resultCopy.textContent = "Place a fresh bet for this round.";
  showToast("New round started");
  saveState();
}

function tick() {
  state.tick += 1;
  updateTimerUI();

  if (state.phase === "betting" && state.tick === BET_SEC) {
    state.phase = "closed";
    updateStatusUI();
    updateTimerUI();
    renderNumbers();
    renderCoins();
    updatePlaceButton();
    dom.closedOverlay.classList.remove("hidden");
    dom.resultTitle.textContent = "Betting closed";
    dom.resultCopy.textContent = "Wait for the reveal.";
    sfx("close");
    setTimeout(() => {
      void revealResult();
    }, CLOSE_DELAY * 1000);
  }

  if (state.phase === "reveal" && state.tick >= ROUND_MS) {
    void resetRound();
  }
}

function startLoop() {
  clearInterval(loopInterval);
  loopInterval = setInterval(tick, 1000);
}

function stopLoop() {
  clearInterval(loopInterval);
}

function renderApp() {
  updatePlayerUI();
  updateStatsUI();
  updateSelectionUI();
  updateActiveBetUI();
  updateStatusUI();
  updateTimerUI();
  renderNumbers();
  renderCoins();
  renderHistory();
  renderStreak();
  updatePlaceButton();
  dom.lastResultChip.textContent = state.lastResult ? `Last: ${state.lastResult}` : "Last: -";
  dom.hashBox.textContent = state.commitHash || "Waiting for authenticated session...";
  dom.resultShuffle.textContent = state.lastResult ? String(state.lastResult) : "?";
  if (!state.history.length && !state.currentBet) {
    dom.resultTitle.textContent = "Select a number and place your bet";
    dom.resultCopy.textContent = "Reveal will show here after betting closes.";
  }
}

function showEntryScreen() {
  dom.entryScreen.classList.add("screen-active");
  dom.gameScreen.classList.remove("screen-active");
}

function showGameScreen() {
  dom.entryScreen.classList.remove("screen-active");
  dom.gameScreen.classList.add("screen-active");
}

function setAuthButtonsDisabled(disabled) {
  dom.signInButton.disabled = disabled;
  dom.signUpButton.disabled = disabled;
  dom.usernameInput.disabled = disabled;
  dom.emailInput.disabled = disabled;
  dom.passwordInput.disabled = disabled;
}

function setAuthMessage(message) {
  dom.authMessage.textContent = message;
}

function setNetworkMessage() {
  if (!navigator.onLine) {
    setAuthMessage("You are offline. Reconnect to use Supabase auth and sync.");
    return;
  }

  if (authSettings?.mailer_autoconfirm === false) {
    setAuthMessage("New accounts must confirm email before they can sign in.");
    return;
  }

  setAuthMessage("New users need a username. Existing users can sign in with email and password.");
}

async function fetchAuthSettings() {
  if (!supabaseConfigured) {
    return null;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Auth settings fetch failed", error);
    return null;
  }
}

async function fetchProfile(userId) {
  if (!supabaseClient || !userId) {
    return null;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    warnPersistenceIssue("Profile fetch failed", error);
    return null;
  }

  return data;
}

async function ensureProfile(user, usernameHint = "") {
  if (!supabaseClient || !user?.id) {
    return null;
  }

  const existingProfile = await fetchProfile(user.id);
  if (existingProfile?.username) {
    return existingProfile;
  }

  const username = usernameHint.trim() || getDisplayName(user);
  const { data, error } = await supabaseClient
    .from("profiles")
    .upsert({ id: user.id, username }, { onConflict: "id" })
    .select("username")
    .single();

  if (error) {
    warnPersistenceIssue("Profile upsert failed", error);
    return { username };
  }

  return data;
}

function validateEmailPassword() {
  const email = dom.emailInput.value.trim().toLowerCase();
  const password = dom.passwordInput.value;

  if (!email || !password) {
    showToast("Email and password are required.");
    return null;
  }

  return { email, password };
}

async function signIn() {
  if (!supabaseClient) {
    showToast("Set the Supabase anon key in app.js first.");
    return;
  }

  const creds = validateEmailPassword();
  if (!creds) {
    return;
  }

  setAuthButtonsDisabled(true);
  try {
    const { error } = await supabaseClient.auth.signInWithPassword(creds);
    if (error) {
      if (/email.*confirm/i.test(error.message)) {
        setAuthMessage("This project requires email confirmation before sign in. Confirm from your inbox, then sign in.");
      }
      showToast(error.message);
      return;
    }

    dom.passwordInput.value = "";
  } catch (error) {
    console.error("Sign in failed", error);
    showToast("Sign in failed. Check console and Supabase config.");
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signUp() {
  if (!supabaseClient) {
    showToast("Set the Supabase anon key in app.js first.");
    return;
  }

  const username = dom.usernameInput.value.trim();
  const creds = validateEmailPassword();
  if (!creds) {
    return;
  }
  if (username.length < 2) {
    dom.usernameInput.focus();
    showToast("Username must be at least 2 characters.");
    return;
  }

  setAuthButtonsDisabled(true);
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      ...creds,
      options: {
        data: {
          username,
        },
      },
    });

    if (error) {
      showToast(error.message);
      return;
    }

    if (data.user && data.session) {
      showToast("Account created.");
    } else {
      const confirmationMessage = authSettings?.mailer_autoconfirm === false
        ? "Account created. Confirm your email, then sign in."
        : "Check your email to confirm the account.";
      setAuthMessage(confirmationMessage);
      showToast(confirmationMessage);
    }
    dom.passwordInput.value = "";
  } catch (error) {
    console.error("Sign up failed", error);
    showToast("Account creation failed. Check console and Supabase config.");
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signOut() {
  if (!supabaseClient) {
    return;
  }

  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showToast(error.message);
  }
}

function resetSignedOutApp() {
  authUser = null;
  currentSessionToken = "";
  stopLoop();
  clearTimeout(saveTimer);
  dom.closedOverlay.classList.add("hidden");
  dom.passwordInput.value = "";
  state = createDefaultState();
  renderApp();
  showEntryScreen();
  setNetworkMessage();
}

async function hydrateAuthenticatedApp(session) {
  if (!session?.user) {
    resetSignedOutApp();
    return;
  }

  const sessionToken = session.access_token || session.user.id;
  if (isHydratingSession && currentSessionToken === sessionToken) {
    return;
  }

  isHydratingSession = true;
  currentSessionToken = sessionToken;
  authUser = session.user;

  try {
    const profile = await ensureProfile(session.user, dom.usernameInput.value);
    const name = getDisplayName(session.user, profile);
    state = createDefaultState({
      id: session.user.id,
      email: session.user.email || "",
      name,
    });

    const localPayload = loadLocalState(session.user.id);
    const remotePayload = await loadRemoteState(session.user.id);
    const payload = chooseLatestState(localPayload, remotePayload);
    if (payload) {
      applyPersistedState(payload);
    }

    state.user.id = session.user.id;
    state.user.email = session.user.email || "";
    state.user.name = name;
    state.phase = "betting";
    state.tick = 0;
    state.selectedNumber = null;
    state.selectedAmount = null;
    state.currentBet = null;
    await commitHash();
    renderApp();
    showGameScreen();
    dom.usernameInput.value = state.user.name;
    dom.emailInput.value = session.user.email || "";
    dom.passwordInput.value = "";
    startLoop();
    saveState({ syncRemote: false });
    setAuthMessage("Session active. Your game state syncs to Supabase when tables are deployed.");
  } catch (error) {
    console.error("Session hydration failed", error);
    resetSignedOutApp();
    setAuthMessage("Auth succeeded, but app setup failed. Check console for details.");
    showToast("Session setup failed.");
  } finally {
    isHydratingSession = false;
  }
}

function bindEvents() {
  dom.signInButton.addEventListener("click", () => {
    void signIn();
  });
  dom.signUpButton.addEventListener("click", () => {
    void signUp();
  });
  dom.signOutButton.addEventListener("click", () => {
    void signOut();
  });

  dom.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void signIn();
    }
  });

  dom.soundButton.addEventListener("click", () => {
    const nextSoundOn = !state.soundOn;
    state.soundOn = nextSoundOn;
    void ensureAudioReady().then((ready) => {
      if (ready) {
        sfx(nextSoundOn ? "toggleOn" : "toggleOff");
      }
    });
    updatePlayerUI();
    saveState();
  });

  dom.hashBox.addEventListener("click", () => {
    navigator.clipboard?.writeText(state.commitHash).then(
      () => {
        showToast("Hash copied");
      },
      () => {
        showToast("Clipboard blocked");
      }
    );
  });

  document.addEventListener(
    "pointerdown",
    () => {
      void ensureAudioReady();
    },
    { passive: true }
  );
  document.addEventListener("keydown", () => {
    void ensureAudioReady();
  });
  window.addEventListener("online", () => {
    setNetworkMessage();
    showToast("Back online");
  });
  window.addEventListener("offline", () => {
    setNetworkMessage();
    showToast("You are offline");
  });
}

async function bootstrap() {
  bindEvents();
  renderApp();
  resetSignedOutApp();

  if (!supabaseClient) {
    setAuthMessage(
      "Set `SUPABASE_ANON_KEY` in app.js, then run `supabase login`, `supabase link --project-ref pggdyjjwwvzwiscsqqas`, and `supabase db push`."
    );
    return;
  }

  authSettings = await fetchAuthSettings();
  setNetworkMessage();

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("Session restore failed", error);
  }
  if (data?.session) {
    await hydrateAuthenticatedApp(data.session);
  }

  authSubscription = supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      resetSignedOutApp();
      return;
    }
    void hydrateAuthenticatedApp(session);
  });
}

window.addEventListener("beforeunload", () => {
  authSubscription?.data?.subscription?.unsubscribe?.();
});

void bootstrap();
