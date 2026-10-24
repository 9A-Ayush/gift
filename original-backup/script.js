(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const VIDEO_IDS = [
    "QzglAEnoItc",
    "j-QKwKd_zCc",
    "nfWV_-BKxVs",
    "Th6cjjS2KTY",
    "Vxcrer2Dw2k",
    "zQ3MjNbE24k"
  ];
  const scene = $("scene");
  const gift = $("gift");
  const openButton = $("giftButton");
  const status = $("status");
  const fill = $("progressFill");
  const percent = $("percent");
  const progressTrack = $("progressTrack");
  const countdown = $("countdown");
  const loadingTask = $("loadingTask");
  const playerPanel = $("playerPanel");
  const playerHost = $("playerHost");

  let secondsLeft = 15;
  let countdownTimer = null;
  let loadingTimer = null;
  let progress = 0;
  let soundEnabled = false;
  let audioContext = null;
  let player = null;
  let playerReady = false;
  let playOrder = [];
  let orderIndex = 0;
  let currentVideoId = null;
  let shuffledButtonTimer = null;
  let hasStarted = false;

  const tasks = [
    "Polishing the gift ribbon…",
    "Asking the diyas to cooperate…",
    "Installing premium sparkle…",
    "Wrapping the same gift again…",
    "Checking whether you are still watching…",
    "99%. We live here now…"
  ];

  function shuffle(array) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function setProgress(value) {
    progress = Math.max(0, Math.min(100, value));
    fill.style.width = `${progress}%`;
    percent.textContent = `${Math.floor(progress)}%`;
    progressTrack.setAttribute("aria-valuenow", String(Math.floor(progress)));
    loadingTask.textContent = progress >= 99 && progress < 100
      ? tasks[5]
      : tasks[Math.min(4, Math.floor(progress / 20))];

    [
      ["check1", 20, "🎁 Wrapping with love"],
      ["check2", 42, "✨ Adding sparkle"],
      ["check3", 67, "🪔 Lighting the diyas"],
      ["check4", 100, "🤡 Preparing the surprise"]
    ].forEach(([id, threshold, label]) => {
      const done = progress >= threshold;
      $(id).textContent = `${done ? "✅" : "⏳"} ${label}: ${done ? "done" : "pending"}`;
      $(id).style.borderColor = done ? "#62b96a" : "#795037";
    });
  }

  function chime() {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext = audioContext || new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = [660, 880, 523, 784][Math.floor(Math.random() * 4)];
      gain.gain.setValueAtTime(0.025, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.16);
    } catch (_) { /* Sound is optional. */ }
  }

  function startLoadingAnimation() {
    let ticks = 0;
    loadingTimer = window.setInterval(() => {
      ticks++;
      const step = progress < 58
        ? Math.random() * 5 + 1.5
        : progress < 88
          ? Math.random() * 1.5 + 0.25
          : Math.random() * 0.18 + 0.02;
      setProgress(Math.min(99, progress + step));

      if (ticks % 3 === 0) {
        scene.classList.remove("shake");
        void scene.offsetWidth;
        scene.classList.add("shake");
        chime();
      }
      if (progress >= 98) {
        setProgress(99);
        status.textContent = [
          "Still tying the ribbon…",
          "A tiny diya has gone missing…",
          "Verifying the gift is gift-shaped…",
          "99%. We have decided to stay here."
        ][ticks % 4];
      }
      if (ticks >= 45) {
        window.clearInterval(loadingTimer);
        loadingTimer = null;
        setProgress(100);
        status.textContent = "Gift unwrapped. The meme parade has begun. There is no playlist menu here. 😈";
      }
    }, 350);
  }

  function startCountdown() {
    if (countdownTimer) return;
    startLoadingAnimation();
    countdownTimer = window.setInterval(() => {
      secondsLeft--;
      countdown.textContent = String(Math.max(0, secondsLeft));
      if (secondsLeft > 0) {
        status.textContent = [
          "Your gift is getting gift-wrapped again…",
          "Checking the festive vibes…",
          "Asking the internet for permission…",
          "Still loading. Looking festive, though."
        ][secondsLeft % 4];
      } else {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        countdown.textContent = "🎁";
        startVideoShow();
      }
    }, 1000);
  }

  function newShuffledCycle() {
    playOrder = shuffle(VIDEO_IDS);
    orderIndex = 0;
  }

  function loadCurrentVideo() {
    if (!playerReady || !player) return;
    if (orderIndex >= playOrder.length) newShuffledCycle();
    currentVideoId = playOrder[orderIndex++];
    $("playCount").textContent = `MEME ${orderIndex} / ${playOrder.length}`;
    $("playerStatus").textContent = "Loading a randomly shuffled meme… enjoy the festive confusion.";
    player.loadVideoById({ videoId: currentVideoId });
    // YouTube may block audible autoplay; volume is set high but not forced above 100%.
    try { player.setVolume(100); } catch (_) {}
  }

  function startVideoShow() {
    playerPanel.classList.remove("hidden");
    playerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    if (playerReady) {
      newShuffledCycle();
      loadCurrentVideo();
      return;
    }
    $("playerStatus").textContent = "Connecting to YouTube… if autoplay is blocked, the browser may require a tap.";
  }

  function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      createPlayer();
      return;
    }
    window.onYouTubeIframeAPIReady = createPlayer;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  }

  function createPlayer() {
    if (player) return;
    player = new YT.Player("playerHost", {
      width: "100%",
      height: "100%",
      videoId: VIDEO_IDS[0],
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        playsinline: 1,
        rel: 0,
        enablejsapi: 1,
        origin: location.protocol === "file:" ? undefined : location.origin
      },
      events: {
        onReady: event => {
          playerReady = true;
          try { event.target.setVolume(100); } catch (_) {}
          if (secondsLeft <= 0) {
            newShuffledCycle();
            loadCurrentVideo();
          } else {
            event.target.cueVideoById(VIDEO_IDS[0]);
          }
        },
        onStateChange: event => {
          if (event.data === YT.PlayerState.PLAYING) {
            $("playerStatus").textContent = "Now playing. Your gift keeps giving. And giving. And giving.";
          }
          if (event.data === YT.PlayerState.ENDED) {
            // Cycle through every supplied link in random order, then reshuffle indefinitely.
            window.setTimeout(loadCurrentVideo, 350);
          }
        },
        onError: () => {
          $("playerStatus").textContent = "This clip could not be embedded. Skipping to another meme…";
          window.setTimeout(loadCurrentVideo, 1200);
        },
        onAutoplayBlocked: () => {
          $("playerStatus").textContent = "Your browser blocked autoplay with sound. Tap the player once to allow playback.";
        }
      }
    });
  }

  function shuffleButtonLabels() {
    const buttons = [
      $("giftButton"), $("statusButton"), $("mysteryButton"),
      $("loadingButton"), $("bonusButton")
    ].filter(Boolean);
    const labels = [
      "UNWRAP GIFT 🎁", "Check gift status", "Claim extra gift?",
      "Fix the loading", "Check bonus sparkle", "Almost there…",
      "One tiny second…", "Try your luck ✨", "Festive verification"
    ];
    buttons.forEach(button => {
      if (Math.random() < 0.6) {
        button.textContent = labels[Math.floor(Math.random() * labels.length)];
      }
    });
    const zone = $("shuffleZone");
    if (zone && Math.random() < 0.55) {
      const children = Array.from(zone.children);
      zone.appendChild(children[Math.floor(Math.random() * children.length)]);
    }
  }

  function enableShufflingButtons() {
    const statusButton = $("statusButton");
    statusButton.addEventListener("click", () => {
      const messages = [
        "Gift status: still being dramatic.",
        "Status: 99% festive. 1% common sense.",
        "Please hold. A diya is on another call.",
        "Your gift has requested an extension.",
        "Status: everything is under control. Probably."
      ];
      status.textContent = messages[Math.floor(Math.random() * messages.length)];
      scene.classList.remove("shake");
      void scene.offsetWidth;
      scene.classList.add("shake");
      chime();
    });
    ["mysteryButton", "loadingButton", "bonusButton"].forEach(id => {
      const button = $(id);
      if (!button) return;
      button.addEventListener("click", () => {
        const messages = [
          "Bonus unlocked: absolutely nothing. 🎉",
          "You found a secret. The secret is more loading.",
          "The gift committee has noticed your enthusiasm.",
          "Extra sparkle has been delayed due to sparkle traffic.",
          "Congratulations! You pressed a button."
        ];
        $("playerStatus").textContent = messages[Math.floor(Math.random() * messages.length)];
        shuffleButtonLabels();
        chime();
      });
    });
  }

  openButton.addEventListener("click", () => {
    if (!hasStarted) {
      hasStarted = true;
      // This user gesture unlocks audio where the browser allows it.
      soundEnabled = true;
      chime();
      startCountdown();
      openButton.textContent = "GIFT IS LOADING…";
    } else {
      status.textContent = "You already unwrapped it. The surprise is in progress. 😈";
      shuffleButtonLabels();
    }
  });

  $("soundButton").addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    $("soundButton").textContent = soundEnabled ? "🔔 Chime enabled" : "🔕 Chime muted";
    if (soundEnabled) chime();
  });

  // Start countdown only after a click, giving the visitor a clear start gesture.
  // No in-page video controls are provided; leaving the page/tab stops the experience.
  enableShufflingButtons();
  setProgress(0);
  loadYouTubeAPI();

  // Once the video is running, UI labels and button order become unpredictably silly.
  shuffledButtonTimer = window.setInterval(shuffleButtonLabels, 4200);
})();
