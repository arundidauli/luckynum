const BET_SEC = 45;
const ROUND_MS = 70;
const WIN_MULT = 1.8;
const BET_AMOUNTS = [10, 20, 50, 100];
const ROUND_SYNC_MS = 1000;
const SUPABASE_URL = "https://pggdyjjwwvzwiscsqqas.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_J8Lollpoo9c-b8dv0Gy2wA_R5QKtPnQ";
const SOUND_STORAGE_KEY = "luckynum:sound";

const dom = {
  entryScreen: document.getElementById("entryScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nameField: document.getElementById("nameField"),
  usernameInput: document.getElementById("usernameInput"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  signInButton: document.getElementById("signInButton"),
  signUpButton: document.getElementById("signUpButton"),
  signOutButton: document.getElementById("signOutButton"),
  authMessage: document.getElementById("authMessage"),
  soundButton: document.getElementById("soundButton"),
  avatarBadge: document.getElementById("avatarBadge"),
  playerName: document.getElementById("playerName"),
  balanceValue: document.getElementById("balanceValue"),
  phaseLabel: document.getElementById("phaseLabel"),
  roundLabel: document.getElementById("roundLabel"),
  timerLabel: document.getElementById("timerLabel"),
  timerFill: document.getElementById("timerFill"),
  resultBall: document.getElementById("resultBall"),
  resultTitle: document.getElementById("resultTitle"),
  resultCopy: document.getElementById("resultCopy"),
  resultBox: document.querySelector(".result-box"),
  hashBox: document.getElementById("hashBox"),
  betStatus: document.getElementById("betStatus"),
  numbersGrid: document.getElementById("numbersGrid"),
  amountRow: document.getElementById("amountRow"),
  activeBetText: document.getElementById("activeBetText"),
  potentialWinText: document.getElementById("potentialWinText"),
  placeButtonWrap: document.getElementById("placeButtonWrap"),
  historyList: document.getElementById("historyList"),
  toast: document.getElementById("toast"),
};

const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
let masterGainNode = null;
if (AudioContextCtor) {
  try {
    audioContext = new AudioContextCtor();
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = 0.15;
    masterGainNode.connect(audioContext.destination);
  } catch (error) {
    console.error("Audio init failed", error);
  }
}

const createClient = window.supabase?.createClient;
const supabaseClient =
  typeof createClient === "function" && SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

let state = {
  user: {
    id: "",
    email: "",
    name: "Player",
    balance: 500,
    wins: 0,
    losses: 0,
  },
  soundOn: readSoundPreference(),
  selectedNumber: null,
  selectedAmount: null,
  myBet: null,
  round: null,
  history: [],
  authSettings: null,
};

let authUser = null;
let loopInterval;
let toastTimer;
let authSubscription;
let syncInFlight = false;
let lastPhaseKey = "";
let isPlacingBet = false;
let authMode = "signin";

function readSoundPreference() {
  try {
    const saved = localStorage.getItem(SOUND_STORAGE_KEY);
    return saved == null ? true : saved === "1";
  } catch {
    return true;
  }
}

function persistSoundPreference() {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, state.soundOn ? "1" : "0");
  } catch {
    // ignore local storage failures
  }
}

function formatCurrency(value) {
  return `₹${Number(value || 0)}`;
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove("show");
  }, 2200);
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

function playTone({ freq, endFreq = freq, type = "sine", duration = 0.08, volume = 0.1 }) {
  if (!state.soundOn || !audioContext || !masterGainNode || audioContext.state !== "running") {
    return;
  }

  try {
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), now + duration);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.08);
    oscillator.connect(gainNode);
    gainNode.connect(masterGainNode);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.08);
  } catch (error) {
    console.error("Audio failed", error);
  }
}

function sfx(type) {
  if (type === "place") {
    playTone({ freq: 420, endFreq: 700, type: "triangle", duration: 0.08, volume: 0.08 });
    setTimeout(() => {
      playTone({ freq: 760, endFreq: 980, duration: 0.05, volume: 0.06 });
    }, 40);
  }
  if (type === "close") {
    [340, 260, 190].forEach((freq, index) => {
      setTimeout(() => {
        playTone({ freq, endFreq: freq * 0.75, type: "square", duration: 0.1, volume: 0.05 });
      }, index * 65);
    });
  }
  if (type === "reveal") {
    [340, 430, 540, 700].forEach((freq, index) => {
      setTimeout(() => {
        playTone({ freq, endFreq: freq * 1.08, type: "triangle", duration: 0.07, volume: 0.06 });
      }, index * 55);
    });
  }
  if (type === "win") {
    [523, 659, 784, 1047].forEach((freq, index) => {
      setTimeout(() => {
        playTone({ freq, endFreq: freq * 1.12, type: "sine", duration: 0.12, volume: 0.11 });
      }, index * 85);
    });
  }
  if (type === "loss") {
    [260, 210, 140].forEach((freq, index) => {
      setTimeout(() => {
        playTone({ freq, endFreq: freq * 0.6, type: "sawtooth", duration: 0.12, volume: 0.07 });
      }, index * 70);
    });
  }
}

function triggerResultFx(effectClass) {
  if (!dom.resultBox) {
    return;
  }
  dom.resultBox.classList.remove("fx-reveal", "fx-win", "fx-loss");
  if (!effectClass) {
    return;
  }
  void dom.resultBox.offsetWidth;
  dom.resultBox.classList.add(effectClass);
}

function getPhase(round, nowMs = Date.now()) {
  if (!round) {
    return "betting";
  }

  const closeMs = Date.parse(round.betting_closes_at);
  const revealMs = Date.parse(round.reveal_at);
  const endMs = Date.parse(round.ends_at);
  if (nowMs < closeMs) {
    return "betting";
  }
  if (nowMs < revealMs) {
    return "closed";
  }
  if (nowMs < endMs) {
    return "reveal";
  }
  return "betting";
}

function secondsLeft(targetAt) {
  return Math.max(0, Math.ceil((Date.parse(targetAt) - Date.now()) / 1000));
}

function updateAuthMessage(message) {
  dom.authMessage.textContent = message;
}

function updateDefaultAuthMessage() {
  if (!navigator.onLine) {
    updateAuthMessage("You are offline. Reconnect to join the live round.");
    return;
  }

  if (state.authSettings?.mailer_autoconfirm === false) {
    updateAuthMessage("New accounts must confirm email before first sign in.");
    return;
  }

  updateAuthMessage("Create an account or sign in to join the live round.");
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "signin";
  const isRegister = authMode === "register";
  dom.nameField.style.display = isRegister ? "block" : "none";
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
  dom.usernameInput.disabled = disabled || authMode !== "register";
  dom.emailInput.disabled = disabled;
  dom.passwordInput.disabled = disabled;
}

async function fetchAuthSettings() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
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
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("username, balance, wins, losses")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function ensureProfile(user, usernameHint = "") {
  const username =
    usernameHint.trim() ||
    user?.user_metadata?.username ||
    user?.email?.split("@")[0] ||
    "Player";

  const { data, error } = await supabaseClient
    .from("profiles")
    .upsert({ id: user.id, username }, { onConflict: "id" })
    .select("username, balance, wins, losses")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

function validateCredentials() {
  const email = dom.emailInput.value.trim().toLowerCase();
  const password = dom.passwordInput.value;
  if (!email || !password) {
    showToast("Email and password are required.");
    return null;
  }
  return { email, password };
}

async function signIn() {
  const creds = validateCredentials();
  if (!creds) {
    return;
  }

  setAuthButtonsDisabled(true);
  try {
    const { error } = await supabaseClient.auth.signInWithPassword(creds);
    if (error) {
      updateAuthMessage(error.message);
      showToast(error.message);
      return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    if (sessionData?.session) {
      showGameScreen();
      await hydrateAuthenticatedApp(sessionData.session);
    }
    dom.passwordInput.value = "";
  } catch (error) {
    console.error("Sign in failed", error);
    showToast("Sign in failed.");
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signUp() {
  const username = dom.usernameInput.value.trim();
  const creds = validateCredentials();
  if (!creds) {
    return;
  }
  if (username.length < 2) {
    showToast("Username must be at least 2 characters.");
    return;
  }

  setAuthButtonsDisabled(true);
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      ...creds,
      options: {
        data: { username },
      },
    });

    if (error) {
      updateAuthMessage(error.message);
      showToast(error.message);
      return;
    }

    if (data.session) {
      showGameScreen();
      await hydrateAuthenticatedApp(data.session);
      showToast("Account created.");
    } else {
      const signInAttempt = await supabaseClient.auth.signInWithPassword(creds);
      if (!signInAttempt.error && signInAttempt.data?.session) {
        showGameScreen();
        await hydrateAuthenticatedApp(signInAttempt.data.session);
        showToast("Account created.");
      } else {
        const message = "Account created. Confirm your email, then sign in.";
        updateAuthMessage(message);
        showToast(message);
      }
    }
    dom.passwordInput.value = "";
  } catch (error) {
    console.error("Sign up failed", error);
    showToast("Account creation failed.");
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showToast(error.message);
  }
}

function renderPlayer() {
  dom.playerName.textContent = state.user.name;
  dom.balanceValue.textContent = formatCurrency(state.user.balance);
  dom.avatarBadge.textContent = state.user.name ? state.user.name[0].toUpperCase() : "?";
  dom.soundButton.textContent = state.soundOn ? "🔊" : "🔇";
}

function renderRound() {
  const round = state.round;
  if (!round) {
    dom.phaseLabel.textContent = "Syncing round";
    dom.roundLabel.textContent = "Round syncing...";
    dom.timerLabel.textContent = "Connecting to shared round...";
    dom.timerFill.style.width = "0%";
    dom.resultBall.textContent = "?";
    dom.resultTitle.textContent = "Waiting for round";
    dom.resultCopy.textContent = "Connect and place your bet before the timer ends.";
    dom.hashBox.textContent = "Waiting...";
    return;
  }

  const phase = getPhase(round);
  dom.resultBox?.classList.remove("phase-betting", "phase-closed", "phase-reveal");
  dom.resultBox?.classList.add(`phase-${phase}`);
  dom.phaseLabel.textContent =
    phase === "betting" ? "Betting Open" : phase === "closed" ? "Betting Closed" : "Result Live";
  dom.roundLabel.textContent = `Round #${round.round_no}`;
  dom.hashBox.textContent = round.commit_hash;

  if (phase === "betting") {
    const left = secondsLeft(round.betting_closes_at);
    dom.timerLabel.textContent = `Betting closes in: 00:${String(left).padStart(2, "0")}`;
    dom.timerFill.style.width = `${(left / BET_SEC) * 100}%`;
    dom.resultBall.textContent = state.myBet ? String(state.myBet.picked_number) : "?";
    dom.resultTitle.textContent = state.myBet ? "Your bet is locked in" : "Pick number and amount";
    dom.resultCopy.textContent = "All players are betting on the same round.";
    return;
  }

  if (phase === "closed") {
    const left = secondsLeft(round.reveal_at);
    dom.timerLabel.textContent = `Reveal in: 00:${String(left).padStart(2, "0")}`;
    dom.timerFill.style.width = "0%";
    dom.resultBall.textContent = "?";
    dom.resultTitle.textContent = "Betting closed";
    dom.resultCopy.textContent = "Shared result is about to reveal.";
    return;
  }

  const left = secondsLeft(round.ends_at);
  dom.timerLabel.textContent = `Next round in: 00:${String(left).padStart(2, "0")}`;
  dom.timerFill.style.width = `${Math.max(0, (left / (ROUND_MS - BET_SEC)) * 100)}%`;
  dom.resultBall.textContent = String(round.winning_number ?? "?");
  dom.resultTitle.textContent = `Winning Number: ${round.winning_number ?? "?"}`;
  dom.resultCopy.textContent = "Same result for every player in this round.";
}

function renderNumbers() {
  dom.numbersGrid.innerHTML = "";
  for (let number = 1; number <= 10; number += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `number-btn${state.selectedNumber === number ? " selected" : ""}`;
    button.disabled = getPhase(state.round) !== "betting";
    button.textContent = String(number);
    button.addEventListener("click", () => {
      state.selectedNumber = number;
      renderNumbers();
      renderBetControls();
    });
    dom.numbersGrid.appendChild(button);
  }
}

function renderAmounts() {
  dom.amountRow.innerHTML = "";
  BET_AMOUNTS.forEach((amount) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `amount-btn${state.selectedAmount === amount ? " selected" : ""}`;
    button.disabled = getPhase(state.round) !== "betting";
    button.textContent = formatCurrency(amount);
    button.addEventListener("click", () => {
      state.selectedAmount = amount;
      renderAmounts();
      renderBetControls();
    });
    dom.amountRow.appendChild(button);
  });
}

function renderBetControls() {
  dom.betStatus.textContent = state.myBet
    ? `Bet on ${state.myBet.picked_number} for ${formatCurrency(state.myBet.amount)}`
    : "No bet placed";

  if (!state.myBet) {
    dom.activeBetText.textContent = "No active bet";
    dom.potentialWinText.textContent = "-";
  } else {
    dom.activeBetText.textContent = `#${state.myBet.picked_number} for ${formatCurrency(state.myBet.amount)}`;
    dom.potentialWinText.textContent = formatCurrency(Math.round(state.myBet.amount * WIN_MULT));
  }

  let placeBetButton = document.getElementById("placeBetButton");
  if (!placeBetButton) {
    dom.placeButtonWrap.innerHTML = "";
    placeBetButton = document.createElement("button");
    placeBetButton.id = "placeBetButton";
    placeBetButton.type = "button";
    placeBetButton.className = "btn btn-primary";
    placeBetButton.addEventListener("click", () => {
      void placeBet();
    });
    dom.placeButtonWrap.appendChild(placeBetButton);
  }

  const isBettingOpen = getPhase(state.round) === "betting";
  const hasSelection = Boolean(state.selectedNumber && state.selectedAmount);
  placeBetButton.disabled = isPlacingBet || !isBettingOpen || !hasSelection;
  if (isPlacingBet) {
    placeBetButton.textContent = "Placing...";
  } else if (!isBettingOpen) {
    placeBetButton.textContent = "Betting Closed";
  } else if (!hasSelection) {
    placeBetButton.textContent = "Choose number and amount";
  } else {
    placeBetButton.textContent = "Place Bet";
  }
}

function renderHistory() {
  if (!state.history.length) {
    dom.historyList.innerHTML = '<div class="empty-state">No finished rounds yet.</div>';
    return;
  }

  dom.historyList.innerHTML = state.history
    .map((entry) => {
      const roundNo = entry._round_no ?? entry.round_no ?? "?";
      const winningNumber = entry._winning_number ?? entry.winning_number ?? "?";
      const winnerCount = entry._winner_count ?? entry.winner_count ?? 0;
      const winnerNames = entry._winner_names ?? entry.winner_names ?? "No winners";
      const winners = winnerCount > 0 ? winnerNames : "No winners";
      return `
        <div class="history-item">
          <div class="history-ball">${winningNumber}</div>
          <div>
            <div class="history-title">Round #${roundNo}</div>
            <div class="history-meta">Winners: ${winners}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAll() {
  renderPlayer();
  renderRound();
  renderNumbers();
  renderAmounts();
  renderBetControls();
  renderHistory();
}

async function placeBet() {
  if (!state.round || !state.selectedNumber || !state.selectedAmount || isPlacingBet) {
    return;
  }

  isPlacingBet = true;
  renderBetControls();
  try {
    const { data, error } = await supabaseClient.rpc("place_round_bet", {
      input_round_no: state.round.round_no,
      input_picked_number: state.selectedNumber,
      input_amount: state.selectedAmount,
    });

    if (error) {
      if (error.message?.toLowerCase().includes("balance") && error.message?.toLowerCase().includes("ambiguous")) {
        showToast("Server bet function needs update. Apply latest SQL migration.");
      } else {
        showToast(error.message);
      }
      return;
    }

    const bet = Array.isArray(data) ? data[0] : data;
    state.myBet = {
      round_no: bet._round_no,
      picked_number: bet._picked_number,
      amount: bet._amount,
    };
    state.user.balance = bet._balance;
    renderAll();
    sfx("place");
    showToast(`Bet placed on ${bet._picked_number} for ${formatCurrency(bet._amount)}`);
  } catch (error) {
    console.error("Place bet failed", error);
    showToast("Could not place bet.");
  } finally {
    isPlacingBet = false;
    renderBetControls();
  }
}

async function syncSnapshot() {
  if (!authUser?.id || syncInFlight) {
    return;
  }

  syncInFlight = true;
  try {
    const { data: currentRoundNo, error: roundNoError } = await supabaseClient.rpc("sync_shared_rounds");
    if (roundNoError) {
      console.error("Round sync failed", roundNoError);
      showToast("Could not sync round state.");
      return;
    }

    const [roundResponse, betResponse, historyResponse, profileResponse] = await Promise.all([
      supabaseClient
        .from("shared_rounds")
        .select("round_no, betting_closes_at, reveal_at, ends_at, commit_hash, winning_number")
        .eq("round_no", currentRoundNo)
        .single(),
      supabaseClient
        .from("round_bets")
        .select("round_no, picked_number, amount, is_winner, payout, settled_at")
        .eq("round_no", currentRoundNo)
        .eq("user_id", authUser.id)
        .maybeSingle(),
      supabaseClient.rpc("get_recent_round_history", { limit_count: 10 }),
      fetchProfile(authUser.id),
    ]);

    if (roundResponse.error) {
      throw roundResponse.error;
    }
    if (betResponse.error) {
      throw betResponse.error;
    }
    if (historyResponse.error) {
      throw historyResponse.error;
    }

    const previousPhaseKey = lastPhaseKey;
    state.round = roundResponse.data;
    state.myBet = betResponse.data;
    state.history = historyResponse.data || [];
    state.user = {
      id: authUser.id,
      email: authUser.email || "",
      name: profileResponse.username || authUser.user_metadata?.username || "Player",
      balance: profileResponse.balance ?? 500,
      wins: profileResponse.wins ?? 0,
      losses: profileResponse.losses ?? 0,
    };

    const currentPhase = getPhase(state.round);
    lastPhaseKey = `${state.round.round_no}:${currentPhase}:${state.round.winning_number || 0}`;
    if (previousPhaseKey && previousPhaseKey !== lastPhaseKey) {
      if (currentPhase === "closed") {
        sfx("close");
      }
      if (currentPhase === "reveal") {
        sfx("reveal");
        if (state.myBet?.is_winner) {
          sfx("win");
          triggerResultFx("fx-win");
        } else if (state.myBet?.settled_at) {
          sfx("loss");
          triggerResultFx("fx-loss");
        } else {
          triggerResultFx("fx-reveal");
        }
      }
    }

    if (state.myBet?.round_no !== state.round.round_no) {
      state.myBet = null;
    }

    if (currentPhase !== "betting") {
      state.selectedNumber = null;
      state.selectedAmount = null;
    }

    renderAll();
  } catch (error) {
    console.error("Snapshot sync failed", error);
  } finally {
    syncInFlight = false;
  }
}

function startLoop() {
  clearInterval(loopInterval);
  void syncSnapshot();
  loopInterval = setInterval(() => {
    void syncSnapshot();
  }, ROUND_SYNC_MS);
}

function stopLoop() {
  clearInterval(loopInterval);
}

function resetSignedOutState() {
  authUser = null;
  lastPhaseKey = "";
  stopLoop();
  state.user = {
    id: "",
    email: "",
    name: "Player",
    balance: 500,
    wins: 0,
    losses: 0,
  };
  state.selectedNumber = null;
  state.selectedAmount = null;
  state.myBet = null;
  state.round = null;
  state.history = [];
  setAuthMode("signin");
  renderAll();
  showEntryScreen();
  updateDefaultAuthMessage();
}

async function hydrateAuthenticatedApp(session) {
  if (!session?.user) {
    resetSignedOutState();
    return;
  }

  authUser = session.user;
  try {
    const profile = await ensureProfile(session.user, dom.usernameInput.value);
    state.user = {
      id: session.user.id,
      email: session.user.email || "",
      name: profile.username || session.user.user_metadata?.username || "Player",
      balance: profile.balance ?? 500,
      wins: profile.wins ?? 0,
      losses: profile.losses ?? 0,
    };
    dom.usernameInput.value = state.user.name;
    dom.emailInput.value = session.user.email || "";
    dom.passwordInput.value = "";
    showGameScreen();
    renderAll();
    startLoop();
  } catch (error) {
    console.error("Session hydrate failed", error);
    showToast("Could not load your profile.");
    resetSignedOutState();
  }
}

function bindEvents() {
  dom.signInButton.addEventListener("click", () => {
    if (authMode !== "signin") {
      setAuthMode("signin");
      dom.emailInput.focus();
      return;
    }
    void signIn();
  });
  dom.signUpButton.addEventListener("click", () => {
    if (authMode !== "register") {
      setAuthMode("register");
      dom.usernameInput.focus();
      return;
    }
    void signUp();
  });
  dom.signOutButton.addEventListener("click", () => {
    void signOut();
  });
  dom.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (authMode === "register") {
        void signUp();
      } else {
        void signIn();
      }
    }
  });
  dom.soundButton.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    persistSoundPreference();
    void ensureAudioReady();
    renderPlayer();
  });
  dom.hashBox.addEventListener("click", () => {
    navigator.clipboard?.writeText(dom.hashBox.textContent || "").then(
      () => showToast("Commit hash copied"),
      () => showToast("Clipboard blocked")
    );
  });
  document.addEventListener("pointerdown", () => {
    void ensureAudioReady();
  }, { passive: true });
  document.addEventListener("keydown", () => {
    void ensureAudioReady();
  });
  window.addEventListener("online", updateDefaultAuthMessage);
  window.addEventListener("offline", updateDefaultAuthMessage);
}

async function bootstrap() {
  bindEvents();
  setAuthMode("signin");
  renderAll();
  resetSignedOutState();

  if (!supabaseClient) {
    updateAuthMessage("Supabase client is not configured.");
    return;
  }

  state.authSettings = await fetchAuthSettings();
  updateDefaultAuthMessage();

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("Session restore failed", error);
  }
  if (data?.session) {
    showGameScreen();
    await hydrateAuthenticatedApp(data.session);
  }

  authSubscription = supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      resetSignedOutState();
      return;
    }
    void hydrateAuthenticatedApp(session);
  });
}

window.addEventListener("beforeunload", () => {
  authSubscription?.data?.subscription?.unsubscribe?.();
});

void bootstrap();
