(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const { ORIGINAL_IDS, Queue, validId } = window.GiftPlaylist;
  const queue = new Queue();
  const blocked = new Set();
  const timers = new Map();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let phase = 'idle', paused = false, elapsed = 0, revealElapsed = 0;
  let loop = null, lastTick = 0, session = 0, player = null, playerReady = false;
  let apiPromise = null, apiFailed = false, apiCancel = null, creating = false, currentId = null;
  let attempt = 0, countedAttempt = -1, count = 0, watchTime = 0, currentState = -1;
  let sound = false, volume = 60, awaitingPlay = false, audio = null;
  let lastMessage = -1, lastShuffle = 0, lastNotification = 0, lastSync = 0, lastSoundSync = 0;
  let syncing = false, syncController = null;
  let initialCollection = true;
  const CACHE_KEY = 'diwali-approved-playlist';
  function publicRecords(items) {
    return items.filter(item => validId(item?.id)).map(item => ({
      id: item.id, availability: ['available','unavailable','unknown'].includes(item.availability) ? item.availability : 'unknown'
    }));
  }
  // Migrate older browser caches before any asynchronous request. Titles,
  // channel names and discovery metadata belong only in the owner interface.
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached && Array.isArray(cached.videos)) localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: cached.savedAt, videos: publicRecords(cached.videos) }));
  } catch { /* Storage may be unavailable or contain an invalid old entry. */ }
  const tasks = [
    'Preparing your special Diwali gift…', 'Polishing the happiness…',
    'Removing unnecessary happiness…', 'Asking a diya for a second opinion…',
    'Verifying your festive vibes…', '99%. A perfectly good place to live.',
    'Authenticity verified. Common sense not found.'
  ];
  const notices = ['A diya has approved your life choices. 🪔', 'Premium sparkle installed. No refunds.',
    'Your gift passed the vibe check. Barely.', 'The ribbon was more expensive than the gift.',
    'Festive support says: have you tried more patience?'];
  function later(name, callback, ms) {
    cancel(name);
    const generation = session;
    timers.set(name, setTimeout(() => {
      timers.delete(name);
      if (generation === session) callback();
    }, ms));
  }
  function cancel(name) { clearTimeout(timers.get(name)); timers.delete(name); }
  function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
  function active() { return phase === 'countdown' || phase === 'reveal' || phase === 'playing'; }
  function toast(message) {
    if (paused || phase === 'stopped') return;
    $('toast').textContent = message; $('toast').classList.remove('hidden');
    later('toast', () => $('toast').classList.add('hidden'), 3800);
  }
  function chime() {
    if (!sound || paused || phase === 'stopped') return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      void audio.resume().catch(() => {});
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'triangle'; oscillator.frequency.value = 660 + Math.random() * 220;
      gain.gain.setValueAtTime(volume / 100 * .035, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .16);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(); oscillator.stop(audio.currentTime + .18);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch { /* Chimes are optional. */ }
  }
  function applySound() {
    $('soundButton').textContent = sound ? 'Sound on' : 'Sound off';
    $('soundButton').setAttribute('aria-pressed', String(sound));
    if (playerReady) {
      try { player.setVolume(volume); sound && volume > 0 ? player.unMute() : player.mute(); }
      catch { /* A pending iframe may not yet accept commands. */ }
    }
  }
  function mediaState(state, message) {
    $('videoLoading').setAttribute('data-state', state);
    $('videoLoadingText').textContent = message;
  }
  function syncSoundFromPlayer() {
    if (!playerReady) return;
    try {
      sound = !player.isMuted(); volume = player.getVolume();
      $('volume').value = String(volume);
      $('soundButton').textContent = sound ? 'Sound on' : 'Sound off';
      $('soundButton').setAttribute('aria-pressed', String(sound));
    } catch { /* Player state is not available during navigation. */ }
  }
  function setProgress(value) {
    value = Math.max(0, Math.min(100, value));
    $('progressFill').style.width = value + '%';
    $('percent').textContent = Math.floor(value) + '%';
    $('progressTrack').setAttribute('aria-valuenow', String(Math.floor(value)));
    [20,45,70,100].forEach((threshold, index) => $('check' + (index + 1)).classList.toggle('done', value >= threshold));
  }
  function startLoop() {
    if (loop) return;
    lastTick = performance.now();
    loop = setInterval(tick, 250);
  }
  function tick() {
    const now = performance.now(), delta = now - lastTick; lastTick = now;
    if (paused || !active()) return;
    if (phase === 'countdown') {
      elapsed = Math.min(15000, elapsed + delta);
      $('countdown').textContent = String(Math.ceil((15000 - elapsed) / 1000));
      // The fake progress races ahead, then gets suspiciously comfortable at 99%.
      setProgress(Math.min(99, 100 * (1 - Math.pow(1 - elapsed / 15000, 2.5))));
      const messageIndex = Math.min(5, Math.floor(elapsed / 2500));
      if (lastMessage !== messageIndex) {
        lastMessage = messageIndex; $('status').textContent = tasks[messageIndex];
        $('loadingTask').textContent = tasks[messageIndex];
        $('gift').classList.toggle('verifying', messageIndex === 3);
        if (messageIndex === 3) { toast('Gift authenticity: 100% gift-shaped.'); burst(24); }
      }
      if (elapsed >= 15000) beginReveal();
    } else if (phase === 'reveal') {
      revealElapsed += delta;
      if (revealElapsed >= 1600) beginVideos();
    } else if (phase === 'playing' && currentState === 1) {
      watchTime += delta;
      if (watchTime >= 120000) $('finalMessage').classList.remove('hidden');
    }
    const time = elapsed + revealElapsed + watchTime;
    if (time - lastShuffle >= 4200) { lastShuffle = time; shuffleButtons(); }
    if (time - lastNotification >= 10500) { lastNotification = time; toast(notices[Math.floor(Math.random() * notices.length)]); }
    if (phase === 'playing' && now - lastSync > 60000) { lastSync = now; void syncPlaylist(); }
    if (phase === 'playing' && now - lastSoundSync > 1000) { lastSoundSync = now; syncSoundFromPlayer(); }
  }
  function openGift() {
    if (phase !== 'idle') return; // One opening attempt owns exactly one countdown.
    phase = 'countdown'; $('giftButton').disabled = true;
    $('giftButton').textContent = 'A little patience…';
    $('pauseButton').disabled = false; $('stopButton').disabled = false;
    $('giftLabel').textContent = 'AUTHENTICITY CHECK IN PROGRESS';
    startLoop(); startEffects(); chime();
  }
  function beginReveal() {
    if (phase !== 'countdown') return;
    phase = 'reveal'; revealElapsed = 0; setProgress(100);
    $('gift').classList.remove('verifying'); $('gift').classList.add('opened');
    $('giftLabel').textContent = 'THE RIBBON WAS A DISTRACTION';
    $('status').textContent = 'Authentic gift. Unexpected contents.';
    $('loadingTask').textContent = tasks[6];
    $('reveal').classList.remove('hidden'); burst(100, true); chime();
  }
  function beginVideos() {
    if (phase !== 'reveal') return;
    phase = 'playing'; $('reveal').classList.add('hidden');
    $('playerPanel').classList.remove('hidden');
    $('surpriseTitle').focus({ preventScroll: true });
    $('playerPanel').scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'start' });
    void ensurePlayer();
  }
  function loadAPI() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('YouTube API timed out')), 12000);
      let finished = false;
      function finish(error) {
        if (finished) return;
        finished = true; clearTimeout(timeout); apiCancel = null;
        if (error) { apiFailed = true; reject(error); } else { apiFailed = false; resolve(); }
      }
      apiCancel = () => finish(new Error('YouTube API request cancelled'));
      window.onYouTubeIframeAPIReady = () => finish();
      let tag = $('youtube-api');
      if (tag && apiFailed) { tag.remove(); tag = null; }
      if (!tag) {
        tag = document.createElement('script'); tag.id = 'youtube-api';
        tag.src = 'https://www.youtube.com/iframe_api'; tag.async = true;
        tag.onerror = () => finish(new Error('YouTube API unavailable')); document.head.appendChild(tag);
      }
    }).catch(error => { apiPromise = null; throw error; });
    return apiPromise;
  }
  async function ensurePlayer() {
    if (creating || player || phase !== 'playing') return;
    creating = true; const generation = session;
    $('playerStatus').textContent = 'Connecting to YouTube…';
    mediaState('loading', 'Connecting your next surprise…');
    try {
      await loadAPI();
      if (generation !== session || phase !== 'playing') return;
      player = new YT.Player('playerHost', {
        width: '100%', height: '100%',
        playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: event => {
            if (generation !== session || phase !== 'playing' || event.target !== player) { event.target.destroy(); return; }
            cancel('init'); playerReady = true; creating = false; applySound();
            event.target.getIframe().title = 'Festive surprise — YouTube video player';
            event.target.getIframe().setAttribute?.('aria-label', 'Festive surprise video');
            if (!paused) nextVideo();
          },
          onStateChange: event => {
            if (generation === session && event.target === player) onPlayerState(event);
          },
          onError: event => { if (generation === session && event.target === player) onPlayerError(event); },
          onAutoplayBlocked: () => {
            if (generation !== session || !active()) return;
            cancel('watchdog'); awaitingPlay = true;
            mediaState('paused', 'Ready when you are. Tap Play video.');
            $('playerStatus').textContent = 'Your browser needs a tap. Choose Play video or use the player controls.';
          }
        }
      });
      later('init', () => {
        if (!playerReady) { destroyPlayer(); fallback('YouTube did not connect. Check your connection, then choose Play video to retry.'); }
      }, 15000);
    } catch {
      if (generation === session) fallback('YouTube could not load. Check your connection, disable blocking extensions if you wish, or watch the clip on YouTube.');
    } finally { if (generation === session && !playerReady) creating = false; }
  }
  function destroyPlayer() {
    try { player?.destroy(); } catch { /* Detached iframe. */ }
    player = null; playerReady = false; creating = false; currentState = -1;
    const host = $('playerHost');
    if (!host) { const replacement = document.createElement('div'); replacement.id = 'playerHost'; document.querySelector('.video-player').replaceChildren(replacement); }
  }
  function fallback(message) {
    cancel('watchdog'); cancel('advance'); awaitingPlay = true;
    mediaState('error', 'A little help is needed. See the playback message.');
    $('playerStatus').textContent = message;
  }
  function nextVideo() {
    if (phase !== 'playing' || paused || !playerReady) return;
    cancel('advance'); cancel('watchdog');
    const id = queue.next(blocked);
    if (!id) {
      try { player.pauseVideo(); } catch {}
      fallback('No playable clips are available right now. Try Play video again later, or open a clip on YouTube.');
      return;
    }
    currentId = id; attempt++; currentState = -1; awaitingPlay = false;
    $('watchLink').href = 'https://www.youtube.com/watch?v=' + id;
    $('playerStatus').textContent = 'Loading your next festive surprise…';
    mediaState('loading', 'Your next surprise is connecting…');
    try { player.loadVideoById({ videoId: id }); applySound(); }
    catch { onPlayerError({ data: 5 }); return; }
    later('watchdog', () => {
      // Do not churn through the playlist when the browser simply requires a gesture.
      fallback('Playback has not started. Choose Play video. If this clip is unavailable, choose Next clip.');
    }, 20000);
  }
  function isCurrentEvent() {
    try { const id = player?.getVideoData()?.video_id; return !id || id === currentId; }
    catch { return true; }
  }
  function onPlayerState(event) {
    if (phase !== 'playing' || !playerReady || !isCurrentEvent()) return;
    if (paused) { if (event.data === 1) player.pauseVideo(); return; }
    currentState = event.data;
    if (event.data === 1) {
      cancel('advance'); cancel('watchdog'); awaitingPlay = false;
      if (countedAttempt !== attempt) {
        countedAttempt = attempt; count++; $('playCount').textContent = String(count);
        if (count >= 5) $('finalMessage').classList.remove('hidden');
      }
      $('playerStatus').textContent = 'Now playing. Your gift keeps giving. And giving.';
      mediaState('ready', 'The surprise is now playing.');
      syncSoundFromPlayer();
    } else if (event.data === 0) {
      cancel('watchdog');
      if (!timers.has('advance')) later('advance', nextVideo, 450);
    } else if (event.data === 2) {
      cancel('watchdog');
      mediaState('paused', 'Taking a little festive break.');
      $('playerStatus').textContent = 'Video paused. Use Play video to continue.';
    } else if (event.data === 3) {
      mediaState('loading', 'Buffering on YouTube…');
    }
  }
  function onPlayerError(event) {
    // A failed load can leave getVideoData() describing the previous clip.
    // The event's player identity is checked by the registered handler instead.
    if (phase !== 'playing' || !playerReady) return;
    cancel('watchdog');
    if (event.data === 153) {
      fallback('YouTube requires a valid website referrer. Run this app using npm start, then open its localhost address.'); return;
    }
    if (currentId) blocked.add(currentId);
    $('playerStatus').textContent = 'This clip is unavailable or cannot be embedded. Trying another…';
    mediaState('loading', 'One clip missed its cue. Trying another…');
    if (!paused && !timers.has('advance')) later('advance', nextVideo, 1000);
  }
  function setPaused(value) {
    if (!active()) return;
    paused = value; lastTick = performance.now();
    document.body.classList.toggle('is-paused', paused);
    $('pauseButton').textContent = paused ? 'Resume' : 'Pause';
    if (paused) {
      cancel('advance'); cancel('watchdog'); cancel('toast'); $('toast').classList.add('hidden');
      try { player?.pauseVideo(); } catch {}
      stopEffects(false); if (audio) void audio.suspend().catch(() => {});
      $('status').textContent = 'Festive chaos paused. Take your time.';
      if (phase === 'playing') mediaState('paused', 'Taking a little festive break.');
    } else {
      startEffects();
      $('status').textContent = phase === 'playing' ? 'The meme parade continues.' : tasks[Math.max(0,lastMessage)];
      if (phase === 'playing' && playerReady) {
        if (!currentId || blocked.has(currentId) || currentState === 0) nextVideo();
        else try { player.playVideo(); } catch { fallback('Choose Play video to resume.'); }
      }
    }
  }
  function stop() {
    session++; phase = 'stopped'; paused = false;
    apiCancel?.();
    clearInterval(loop); loop = null; clearTimers(); destroyPlayer();
    syncController?.abort(); stopEffects(true);
    if (audio) { void audio.close().catch(() => {}); audio = null; }
    document.body.classList.remove('is-paused'); document.body.classList.add('is-stopped');
    $('reveal').classList.add('hidden'); $('toast').classList.add('hidden');
    $('status').textContent = 'Gift closed. Your peace and quiet has been restored.';
    $('playerStatus').textContent = 'Stopped. Restart whenever you feel brave enough.';
    mediaState('stopped', 'Playback stopped. Peace and quiet, restored.');
    $('pauseButton').textContent = 'Pause'; $('pauseButton').disabled = true;
    $('stopButton').disabled = true; $('playButton').disabled = true; $('skipButton').disabled = true;
  }
  function restart() {
    stop(); phase = 'idle'; elapsed = 0; revealElapsed = 0; watchTime = 0;
    count = 0; currentId = null; attempt = 0; countedAttempt = -1; lastMessage = -1;
    lastShuffle = 0; lastNotification = 0; blocked.clear(); queue.bag = []; queue.last = null;
    document.body.classList.remove('is-stopped');
    $('gift').classList.remove('opened','verifying'); $('giftLabel').textContent = 'HANDLE WITH CURIOSITY';
    $('giftButton').disabled = false; $('giftButton').textContent = 'Unwrap my gift ↗';
    $('countdown').textContent = '15'; $('playCount').textContent = '0';
    $('playerPanel').classList.add('hidden'); $('finalMessage').classList.add('hidden');
    $('playButton').disabled = false; $('skipButton').disabled = false; setProgress(0);
    $('status').textContent = 'Fresh ribbon. Same questionable intentions.';
    $('loadingTask').textContent = 'Authenticity check: suspiciously gift-shaped';
    mediaState('loading', 'The next surprise is on its way.');
    startEffects(); $('giftButton').focus();
  }
  function shuffleButtons() {
    const zone = $('shuffleZone');
    const buttons = [...zone.children];
    const labels = ['Claim extra happiness','Verify my festive vibes','Request a refund','Unlock premium patience','Continue being festive','One more tiny second'];
    buttons.forEach(button => { if (Math.random() < .5) button.textContent = labels[Math.floor(Math.random()*labels.length)]; });
    // Never move a focused/hovered control or any essential playback control.
    if (!motion.matches && !zone.contains(document.activeElement) && !zone.matches(':hover') && Math.random() < .4) {
      zone.append(buttons[Math.floor(Math.random()*buttons.length)]);
    }
  }
  async function syncPlaylist() {
    if (syncing || phase === 'stopped') return;
    syncing = true; syncController = new AbortController();
    try {
      const response = await fetch('/api/playlist', { signal: AbortSignal.any([syncController.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error('Collection unavailable');
      const data = await response.json();
      if (!Array.isArray(data.videos)) throw new Error('Invalid collection');
      const records = publicRecords(data.videos);
      const ids = records.filter(item => item.availability !== 'unavailable').map(item => item.id);
      queue.update(ids);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), videos: records })); } catch {}
      initialCollection = false;
    } catch {
      // A network failure preserves the known queue and the original collection.
      if (initialCollection) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
          if (cached && Date.now()-cached.savedAt < 7*86400000 && Array.isArray(cached.videos)) {
            const records = publicRecords(cached.videos).filter(item => item.availability !== 'unavailable');
            queue.update([...ORIGINAL_IDS,...records.map(item=>item.id)]);
          }
        } catch {}
      }
    } finally { syncing = false; }
  }
  // A single bounded canvas, with no growing DOM nodes or unbounded animation queues.
  const canvas = $('celebration'), context = canvas.getContext('2d');
  let raf = null, width = innerWidth, height = innerHeight, sprites = [], lastFrame = 0;
  const motes = Array.from({length:22},()=>({x:Math.random(),y:Math.random(),r:Math.random()*1.4+.5,s:Math.random()*.12+.04}));
  function resize() {
    width = innerWidth; height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1,1.5);
    canvas.width = width*dpr; canvas.height = height*dpr; context?.setTransform(dpr,0,0,dpr,0,0);
  }
  function burst(amount, fireworks = false) {
    if (!context || motion.matches || paused || phase === 'stopped') return;
    const x = width*(.3+Math.random()*.4), y = height*.35;
    for (let i=0;i<amount && sprites.length<140;i++) {
      const angle = Math.random()*Math.PI*2, speed = 2+Math.random()*5;
      sprites.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-2,life:100+Math.random()*30,color:['#f3cc83','#ed8e50','#b590dc','#fff0c5'][i%4],fireworks});
    }
  }
  function frame(time) {
    raf = null;
    if (motion.matches || paused || phase === 'stopped' || document.hidden || !context) return;
    if (time-lastFrame>30) {
      lastFrame=time; context.clearRect(0,0,width,height);
      context.fillStyle='#f3cc83';
      motes.forEach(p=>{p.y-=p.s/1000;if(p.y<0)p.y=1;context.globalAlpha=.25;context.beginPath();context.arc(p.x*width,p.y*height,p.r,0,Math.PI*2);context.fill();});
      sprites=sprites.filter(p=>p.life>0);
      sprites.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=p.fireworks?.035:.07;p.life--;context.globalAlpha=Math.min(1,p.life/30);context.fillStyle=p.color;if(p.fireworks){context.beginPath();context.arc(p.x,p.y,2,0,Math.PI*2);context.fill();}else context.fillRect(p.x,p.y,4,7);});
      context.globalAlpha=1;
    }
    raf=requestAnimationFrame(frame);
  }
  function startEffects() { if (!raf && !motion.matches && !paused && phase!=='stopped' && !document.hidden) raf=requestAnimationFrame(frame); }
  function stopEffects(clear) { cancelAnimationFrame(raf);raf=null;if(clear){sprites=[];context?.clearRect(0,0,width,height);} }
  $('giftButton').addEventListener('click',openGift);
  $('pauseButton').addEventListener('click',()=>setPaused(!paused));
  $('stopButton').addEventListener('click',stop);
  $('finalStop').addEventListener('click',stop);
  $('restartButton').addEventListener('click',restart);
  $('soundButton').addEventListener('click',()=>{sound=!sound;applySound();if(sound)chime();});
  $('volume').addEventListener('input',event=>{volume=Number(event.target.value);applySound();});
  $('playButton').addEventListener('click',()=>{
    if (phase!=='playing') return;
    if (paused) setPaused(false);
    if (!playerReady) { void ensurePlayer(); return; }
    if (!currentId || blocked.size>=queue.ids.length) { blocked.clear(); nextVideo(); }
    else { try { applySound(); player.playVideo(); } catch { fallback('YouTube is not ready. Try Next clip.'); } }
  });
  $('skipButton').addEventListener('click',()=>{if(paused)setPaused(false);nextVideo();});
  $('statusButton').addEventListener('click',()=>{if(phase==='stopped'||paused)return;toast(notices[Math.floor(Math.random()*notices.length)]);chime();});
  ['mysteryButton','loadingButton','bonusButton'].forEach(id=>$(id).addEventListener('click',()=>{
    if (!active() || paused) return;
    toast(['Verification complete: certified festive human.','Bonus unlocked: absolutely nothing. 🎉','Refund approved: one imaginary rupee.'][Math.floor(Math.random()*3)]);
    burst(28); chime(); shuffleButtons();
  }));
  window.addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>document.hidden?stopEffects(false):startEffects());
  motion.addEventListener('change',()=>{stopEffects(true);startEffects();});
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',event=>{if(event.persisted)restart();});
  resize();setProgress(0);applySound();startEffects();void syncPlaylist();
})();
