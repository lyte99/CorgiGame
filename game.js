const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const catchCountEl = document.getElementById("catchCount");
const timerEl = document.getElementById("timer");
const stumbleCountEl = document.getElementById("stumbleCount");
const bestRunEl = document.getElementById("bestRun");
const restartBtn = document.getElementById("restartBtn");
const jumpBtn = document.getElementById("jumpBtn");
const statusLineEl = document.getElementById("statusLine");

const WORLD = {
  width: canvas.width,
  height: canvas.height,
  fenceTop: 104,
  fenceBottom: 180,
  fieldTop: 194,
  margin: 56,
};

const GOAL_CATCHES = 5;
const ROUND_TIME = 60;
const BEST_RUN_KEY = "corgi-fence-chase-best";

const keys = new Set();
const pointer = {
  active: false,
  x: 0,
  y: 0,
};

const state = {
  mode: "menu",
  catches: 0,
  timeLeft: ROUND_TIME,
  elapsed: 0,
  stumbles: 0,
  shake: 0,
  message: "",
  messageTimer: 0,
  particles: [],
  bestRun: loadBestRun(),
  pendingJump: false,
};

const player = {
  x: 140,
  y: 360,
  radius: 24,
  speed: 292,
  facing: 1,
  knockX: 0,
  knockY: 0,
  runCycle: 0,
  stumbleTimer: 0,
  hitCooldown: 0,
  jumpTimer: 0,
  jumpDuration: 0.56,
  jumpHeight: 0,
  jumpCooldown: 0,
};

const blocker = {
  x: 520,
  y: 286,
  radius: 26,
  centerX: 480,
  centerY: 284,
  orbitAngle: 0,
  orbitRadius: 58,
  facing: 1,
  runCycle: 0,
};

const squirrel = {
  x: 760,
  y: 144,
  radius: 15,
  laneY: 146,
  speed: 172,
  baseSpeed: 172,
  direction: -1,
  burst: 0,
  vx: 0,
  feintCooldown: 0.5,
  seed: Math.random() * 1000,
};

restartBtn.addEventListener("click", startGame);
jumpBtn.addEventListener("click", handleJumpInput);
jumpBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  handleJumpInput();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const isJump = isJumpKey(key) || event.code === "Space";

  if (isControlKey(key) || isJump || key === "enter") {
    event.preventDefault();
  }

  if (key === "enter") {
    startGame();
    return;
  }

  if (isJump) {
    if (!event.repeat) {
      handleJumpInput();
    }

    return;
  }

  keys.add(key);

  if (state.mode !== "playing" && shouldStartFromKey(key)) {
    startGame();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener("pointerdown", (event) => {
  pointer.active = true;
  updatePointerPosition(event);
  canvas.setPointerCapture(event.pointerId);

  if (state.mode !== "playing") {
    startGame();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointer.active) {
    return;
  }

  updatePointerPosition(event);
});

window.addEventListener("pointerup", () => {
  pointer.active = false;
});

window.addEventListener("pointercancel", () => {
  pointer.active = false;
});

let lastFrameTime = performance.now();
requestAnimationFrame(loop);
syncHud();
draw(0);

function loop(timestamp) {
  const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.033);
  lastFrameTime = timestamp;

  update(dt);
  draw(timestamp / 1000);
  requestAnimationFrame(loop);
}

function startGame() {
  const preservePendingJump = state.pendingJump;

  state.mode = "playing";
  state.catches = 0;
  state.timeLeft = ROUND_TIME;
  state.elapsed = 0;
  state.stumbles = 0;
  state.shake = 0;
  state.particles = [];
  state.pendingJump = preservePendingJump;

  player.x = 144;
  player.y = 354;
  player.facing = 1;
  player.knockX = 0;
  player.knockY = 0;
  player.runCycle = 0;
  player.stumbleTimer = 0;
  player.hitCooldown = 0;
  player.jumpTimer = 0;
  player.jumpHeight = 0;
  player.jumpCooldown = 0;

  blocker.centerX = 480;
  blocker.centerY = 284;
  blocker.orbitAngle = Math.PI * 0.25;
  blocker.orbitRadius = 58;
  blocker.runCycle = 0;

  spawnSquirrel(true);
  setMessage("Jump the spinning blocker and cut the squirrel off at the fence.", 2.4);
  restartBtn.textContent = "Restart Chase";
  syncHud();
}

function update(dt) {
  updateParticles(dt);
  updateMessage(dt);

  if (state.mode !== "playing") {
    state.shake = Math.max(0, state.shake - dt * 24);
    return;
  }

  state.elapsed += dt;
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  state.shake = Math.max(0, state.shake - dt * 24);

  consumePendingJump();
  updatePlayer(dt);
  updateBlocker(dt);
  updateSquirrel(dt);
  resolveBlockerCollision();

  if (checkSquirrelCatch()) {
    onSquirrelCaught();
  }

  if (state.timeLeft <= 0) {
    finishRound(false);
  }

  syncHud();
}

function updatePlayer(dt) {
  const input = readMovementInput();
  const moveSpeed =
    player.speed *
    (player.stumbleTimer > 0 ? 0.65 : 1) *
    (player.jumpTimer > 0 ? 1.04 : 1);

  player.x += input.x * moveSpeed * dt + player.knockX * dt;
  player.y += input.y * moveSpeed * dt + player.knockY * dt;

  player.knockX *= Math.exp(-dt * 8.5);
  player.knockY *= Math.exp(-dt * 8.5);
  player.stumbleTimer = Math.max(0, player.stumbleTimer - dt);
  player.hitCooldown = Math.max(0, player.hitCooldown - dt);
  player.jumpCooldown = Math.max(0, player.jumpCooldown - dt);

  if (player.jumpTimer > 0) {
    player.jumpTimer = Math.max(0, player.jumpTimer - dt);
    const progress = 1 - player.jumpTimer / player.jumpDuration;
    player.jumpHeight = Math.sin(progress * Math.PI) * 62;
  } else {
    player.jumpHeight = 0;
  }

  player.x = clamp(player.x, WORLD.margin, WORLD.width - WORLD.margin);
  player.y = clamp(player.y, WORLD.fieldTop, WORLD.height - 72);

  const movementMagnitude = Math.hypot(input.x, input.y);
  player.runCycle += dt * (movementMagnitude > 0 ? 11.5 : 4.2) * (player.jumpTimer > 0 ? 0.55 : 1);

  if (input.x > 0.08) {
    player.facing = 1;
  } else if (input.x < -0.08) {
    player.facing = -1;
  } else if (squirrel.x !== player.x) {
    player.facing = squirrel.x > player.x ? 1 : -1;
  }
}

function updateBlocker(dt) {
  blocker.orbitAngle += dt * (3.2 + state.catches * 0.14);
  blocker.orbitRadius = 58 + Math.sin(state.elapsed * 3.2) * 5;
  blocker.x = blocker.centerX + Math.cos(blocker.orbitAngle) * blocker.orbitRadius;
  blocker.y =
    blocker.centerY +
    Math.sin(blocker.orbitAngle) * blocker.orbitRadius * 0.76 +
    Math.cos(blocker.orbitAngle * 2.2) * 4;
  blocker.facing = -Math.sin(blocker.orbitAngle) >= 0 ? 1 : -1;
  blocker.runCycle += dt * 13.2;
}

function updateSquirrel(dt) {
  squirrel.feintCooldown -= dt;
  squirrel.burst = Math.max(0, squirrel.burst - dt * 1.3);

  const playerGapX = Math.abs(player.x - squirrel.x);
  const playerClose = playerGapX < 132 && player.y < 260;

  if (playerClose && squirrel.feintCooldown <= 0) {
    squirrel.direction = player.x < squirrel.x ? 1 : -1;
    squirrel.burst = 0.95;
    squirrel.feintCooldown = 0.82 + Math.random() * 0.45;
    setMessage("The squirrel juked down the rail.", 0.7);
  } else if (Math.random() < dt * 0.8) {
    if (Math.random() < 0.24) {
      squirrel.direction *= -1;
    }

    squirrel.burst = Math.max(squirrel.burst, 0.25 + Math.random() * 0.35);
  }

  const pace = squirrel.baseSpeed + Math.sin(state.elapsed * 2.8 + squirrel.seed) * 16;
  const targetVelocity = pace * (1 + squirrel.burst) * squirrel.direction;
  squirrel.vx = approach(squirrel.vx, targetVelocity, 360 * dt);
  squirrel.x += squirrel.vx * dt;

  if (squirrel.x < WORLD.margin + 4) {
    squirrel.x = WORLD.margin + 4;
    squirrel.direction = 1;
    squirrel.burst = 0.7;
  }

  if (squirrel.x > WORLD.width - WORLD.margin - 4) {
    squirrel.x = WORLD.width - WORLD.margin - 4;
    squirrel.direction = -1;
    squirrel.burst = 0.7;
  }

  squirrel.speed = Math.abs(squirrel.vx);
  squirrel.laneY = 144 + Math.sin(state.elapsed * 7.4 + squirrel.seed) * 7;
  squirrel.y = squirrel.laneY + Math.cos(state.elapsed * 12.8 + squirrel.seed) * 3;
}

function resolveBlockerCollision() {
  if (player.jumpHeight > 28) {
    return;
  }

  const dx = player.x - blocker.x;
  const dy = player.y - blocker.y;
  const distance = Math.hypot(dx, dy) || 1;
  const minDistance = player.radius + blocker.radius;

  if (distance >= minDistance) {
    return;
  }

  const overlap = minDistance - distance;
  const normalX = dx / distance;
  const normalY = dy / distance;

  player.x += normalX * overlap * 0.82;
  player.y += normalY * overlap * 0.82;
  player.knockX += normalX * 160;
  player.knockY += normalY * 160;

  if (player.hitCooldown <= 0) {
    player.hitCooldown = 0.34;
    player.stumbleTimer = 0.24;
    state.stumbles += 1;
    state.shake = 8;
    spawnBurst(player.x, player.y + 18, "#ffe0b2", 8, 48);
    setMessage("The blocker corgi clipped your stride.", 0.9);
  }
}

function attemptJump() {
  if (state.mode !== "playing" || player.jumpTimer > 0 || player.jumpCooldown > 0) {
    return false;
  }

  player.jumpTimer = player.jumpDuration;
  player.jumpCooldown = 0.1;
  player.jumpHeight = 1;
  spawnBurst(player.x, player.y + 20, "#fff4d8", 6, 28);
  return true;
}

function handleJumpInput() {
  state.pendingJump = true;

  if (state.mode !== "playing") {
    startGame();
    return;
  }

  consumePendingJump();
}

function consumePendingJump() {
  if (!state.pendingJump) {
    return;
  }

  if (attemptJump()) {
    state.pendingJump = false;
  }
}

function checkSquirrelCatch() {
  const dx = player.x - squirrel.x;
  const dy = player.y - (squirrel.y + 22);
  return Math.hypot(dx, dy) < player.radius + squirrel.radius + 6;
}

function onSquirrelCaught() {
  state.catches += 1;
  state.shake = 16;
  spawnBurst(squirrel.x, squirrel.y, "#fff2a8", 14, 90);

  if (state.catches >= GOAL_CATCHES) {
    finishRound(true);
    return;
  }

  spawnSquirrel(false);
  setMessage(`Caught one. Squirrel ${state.catches + 1} is already on the fence.`, 1.5);
  syncHud();
}

function finishRound(won) {
  state.mode = won ? "won" : "lost";
  updateBestRun();

  if (won) {
    setMessage(`Fence cleared with ${state.timeLeft.toFixed(1)}s left.`, 8);
  } else {
    setMessage(`Time up. You caught ${state.catches} of ${GOAL_CATCHES}.`, 8);
  }

  restartBtn.textContent = won ? "Run It Again" : "Try Again";
  syncHud();
}

function spawnSquirrel(initialSpawn) {
  squirrel.seed = Math.random() * 1000;
  squirrel.baseSpeed = 172 + state.catches * 24;
  squirrel.speed = squirrel.baseSpeed;
  squirrel.burst = initialSpawn ? 0.2 : 0.38;
  squirrel.feintCooldown = 0.55;
  squirrel.direction = player.x < WORLD.width * 0.5 ? -1 : 1;
  squirrel.x = squirrel.direction > 0 ? WORLD.margin + 18 : WORLD.width - WORLD.margin - 18;
  squirrel.vx = squirrel.direction * squirrel.baseSpeed;
}

function updateParticles(dt) {
  state.particles = state.particles.filter((particle) => {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.exp(-dt * 2.3);
    particle.vy = particle.vy * Math.exp(-dt * 2.3) + 14 * dt;
    return particle.life > 0;
  });
}

function spawnBurst(x, y, color, count, force) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
    const speed = force * (0.35 + Math.random() * 0.9);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 8,
      life: 0.4 + Math.random() * 0.4,
      maxLife: 0.7,
      size: 2 + Math.random() * 4,
      color,
    });
  }
}

function updateMessage(dt) {
  if (state.messageTimer <= 0) {
    return;
  }

  state.messageTimer = Math.max(0, state.messageTimer - dt);

  if (state.messageTimer === 0) {
    statusLineEl.textContent = defaultStatusLine();
  }
}

function setMessage(text, duration) {
  state.message = text;
  state.messageTimer = duration;
  statusLineEl.textContent = text;
}

function defaultStatusLine() {
  if (state.mode === "menu") {
    return "Catch 5 squirrels before the minute runs out, and hop the spinner when it cuts you off.";
  }

  if (state.mode === "playing") {
    return "Stay under the rail, jump the spinning blocker, then cut the squirrel off.";
  }

  if (state.mode === "won") {
    return `You cleared the fence with ${state.timeLeft.toFixed(1)}s remaining.`;
  }

  return `You finished with ${state.catches} catches. Start again and tighten your line.`;
}

function syncHud() {
  catchCountEl.textContent = `${state.catches} / ${GOAL_CATCHES}`;
  timerEl.textContent = `${state.timeLeft.toFixed(1)}s`;
  stumbleCountEl.textContent = `${state.stumbles}`;
  bestRunEl.textContent = formatBestRun();

  if (state.messageTimer <= 0) {
    statusLineEl.textContent = defaultStatusLine();
  }
}

function formatBestRun() {
  if (!state.bestRun || state.bestRun.catches === 0) {
    return "No catches yet";
  }

  return `${state.bestRun.catches} caught, ${state.bestRun.timeLeft.toFixed(1)}s left`;
}

function loadBestRun() {
  try {
    const raw = localStorage.getItem(BEST_RUN_KEY);

    if (!raw) {
      return { catches: 0, timeLeft: 0 };
    }

    const parsed = JSON.parse(raw);
    return {
      catches: Number(parsed.catches) || 0,
      timeLeft: Number(parsed.timeLeft) || 0,
    };
  } catch {
    return { catches: 0, timeLeft: 0 };
  }
}

function updateBestRun() {
  const best = state.bestRun;
  const shouldReplace =
    state.catches > best.catches ||
    (state.catches === best.catches && state.timeLeft > best.timeLeft);

  if (!shouldReplace) {
    return;
  }

  state.bestRun = {
    catches: state.catches,
    timeLeft: Number(state.timeLeft.toFixed(1)),
  };

  try {
    localStorage.setItem(BEST_RUN_KEY, JSON.stringify(state.bestRun));
  } catch {
    return;
  }
}

function readMovementInput() {
  if (pointer.active) {
    const dx = pointer.x - player.x;
    const dy = pointer.y - player.y;
    const distance = Math.hypot(dx, dy);

    if (distance > 10) {
      return {
        x: dx / distance,
        y: dy / distance,
      };
    }
  }

  let x = 0;
  let y = 0;

  if (keys.has("arrowleft") || keys.has("a")) {
    x -= 1;
  }

  if (keys.has("arrowright") || keys.has("d")) {
    x += 1;
  }

  if (keys.has("arrowup") || keys.has("w")) {
    y -= 1;
  }

  if (keys.has("arrowdown") || keys.has("s")) {
    y += 1;
  }

  const magnitude = Math.hypot(x, y);

  if (magnitude === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
  };
}

function shouldStartFromKey(key) {
  return key === "enter" || isControlKey(key) || isJumpKey(key);
}

function isControlKey(key) {
  return ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key);
}

function isJumpKey(key) {
  return key === " " || key === "spacebar" || key === "space";
}

function updatePointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  pointer.x = (event.clientX - rect.left) * scaleX;
  pointer.y = (event.clientY - rect.top) * scaleY;
}

function draw(time) {
  ctx.save();
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);

  if (state.shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * state.shake,
      (Math.random() - 0.5) * state.shake
    );
  }

  drawField(time);
  drawFence(time);
  drawLaneShadow();
  drawParticles();
  drawSquirrel(time);
  drawBlockerGuide();
  drawCorgi(blocker, { accent: "#f07db0", scarf: true, highlight: "#ffd9ea" });
  drawCorgi(player, {
    accent: "#ec6a38",
    scarf: false,
    highlight: "#ffe1c6",
    lift: player.jumpHeight,
  });
  drawFenceGlint(time);
  drawRoundOverlay();

  ctx.restore();
}

function drawField(time) {
  const skyGlow = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  skyGlow.addColorStop(0, "#dbc88f");
  skyGlow.addColorStop(0.24, "#a9c979");
  skyGlow.addColorStop(1, "#7fa35c");
  ctx.fillStyle = skyGlow;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let row = 0; row < 14; row += 1) {
    ctx.fillRect(
      0,
      WORLD.fieldTop + row * 28 + Math.sin(time * 0.7 + row) * 1.6,
      WORLD.width,
      1.5
    );
  }

  ctx.fillStyle = "rgba(88, 64, 31, 0.14)";
  for (let patch = 0; patch < 9; patch += 1) {
    ctx.beginPath();
    ctx.ellipse(
      120 + patch * 98 + Math.sin(time + patch) * 7,
      260 + (patch % 3) * 110,
      42,
      16,
      0.2,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function drawFence(time) {
  ctx.fillStyle = "#7c5b34";
  ctx.fillRect(0, WORLD.fenceBottom - 6, WORLD.width, 18);

  const topRailY = WORLD.fenceTop + 18;
  const middleRailY = WORLD.fenceTop + 44;
  const postTop = WORLD.fenceTop - 18;
  const postHeight = 122;

  ctx.fillStyle = "#f4d5a0";
  ctx.fillRect(0, topRailY, WORLD.width, 10);
  ctx.fillRect(0, middleRailY, WORLD.width, 10);

  for (let x = 18; x <= WORLD.width + 24; x += 64) {
    ctx.fillStyle = "#f0c98d";
    ctx.fillRect(x, postTop, 18, postHeight);

    ctx.fillStyle = "rgba(124, 91, 52, 0.22)";
    ctx.fillRect(x + 13, postTop, 5, postHeight);

    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.fillRect(x, postTop, 3, postHeight);
  }

  ctx.fillStyle = "rgba(70, 97, 44, 0.22)";
  ctx.fillRect(0, WORLD.fieldTop - 26 + Math.sin(time * 0.4) * 2, WORLD.width, 20);
}

function drawLaneShadow() {
  const shadow = ctx.createLinearGradient(0, WORLD.fenceBottom, 0, WORLD.fieldTop + 30);
  shadow.addColorStop(0, "rgba(62, 45, 22, 0.22)");
  shadow.addColorStop(1, "rgba(62, 45, 22, 0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(0, WORLD.fenceBottom, WORLD.width, 54);
}

function drawFenceGlint(time) {
  ctx.strokeStyle = "rgba(255, 248, 219, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, WORLD.fenceTop + 19);
  ctx.lineTo(WORLD.width, WORLD.fenceTop + 19 + Math.sin(time * 0.9) * 0.7);
  ctx.stroke();
}

function drawBlockerGuide() {
  if (state.mode !== "playing") {
    return;
  }

  ctx.strokeStyle = "rgba(109, 181, 214, 0.18)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 10]);
  ctx.beginPath();
  ctx.arc(blocker.centerX, blocker.centerY, blocker.orbitRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(213, 241, 255, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(blocker.centerX, blocker.centerY, 16, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCorgi(corgi, options) {
  const lift = options.lift || 0;
  const runBounce = Math.sin(corgi.runCycle) * (lift > 0 ? 0.9 : 2.2);

  ctx.save();
  ctx.translate(corgi.x, corgi.y + runBounce - lift);
  ctx.scale(corgi.facing, 1);

  ctx.fillStyle = "rgba(50, 34, 18, 0.22)";
  ctx.beginPath();
  ctx.ellipse(
    0,
    30 + lift * 0.22,
    Math.max(18, 34 - lift * 0.19),
    Math.max(5, 10 - lift * 0.08),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  const legSwing = Math.sin(corgi.runCycle) * 4;
  ctx.strokeStyle = "#6b4b27";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  drawLeg(-16, 8, legSwing);
  drawLeg(-4, 11, -legSwing);
  drawLeg(10, 10, -legSwing);
  drawLeg(21, 8, legSwing);

  ctx.fillStyle = "#ce7b3d";
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 22, 0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = options.highlight;
  ctx.beginPath();
  ctx.ellipse(-3, 5, 18, 13, 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ce7b3d";
  ctx.beginPath();
  ctx.arc(28, -9, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = options.highlight;
  ctx.beginPath();
  ctx.arc(31, -3, 8.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#c1652d";
  ctx.beginPath();
  ctx.moveTo(18, -19);
  ctx.lineTo(24, -38);
  ctx.lineTo(33, -18);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(33, -19);
  ctx.lineTo(39, -34);
  ctx.lineTo(44, -15);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fff6df";
  ctx.beginPath();
  ctx.arc(36, -9, 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2f1708";
  ctx.beginPath();
  ctx.arc(37, -9, 1.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(43, -7, 1.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(44, -1, 3.4, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = options.accent;
  ctx.lineWidth = options.scarf ? 7 : 5;
  ctx.beginPath();
  ctx.arc(17, -4, 12, 0.72, Math.PI * 1.85);
  ctx.stroke();

  if (options.scarf) {
    ctx.fillStyle = options.accent;
    ctx.beginPath();
    ctx.moveTo(10, 6);
    ctx.lineTo(4, 17);
    ctx.lineTo(15, 13);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = "#fff7e4";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, -2);
  ctx.lineTo(-38, -10);
  ctx.stroke();

  ctx.restore();

  function drawLeg(offsetX, offsetY, swing) {
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    ctx.lineTo(offsetX + swing * 0.2, offsetY + 20);
    ctx.stroke();
  }
}

function drawSquirrel(time) {
  const tailFlick = Math.sin(time * 13 + squirrel.seed) * 3;

  ctx.save();
  ctx.translate(squirrel.x, squirrel.y);
  ctx.scale(squirrel.direction >= 0 ? 1 : -1, 1);

  ctx.fillStyle = "rgba(56, 46, 34, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 18, 22, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#76808f";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-5, 8);
  ctx.lineTo(-5, 19);
  ctx.moveTo(6, 8);
  ctx.lineTo(6, 19);
  ctx.stroke();

  ctx.fillStyle = "#9aa4b3";
  ctx.beginPath();
  ctx.ellipse(2, 0, 15, 10, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(14, -5, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#727e8f";
  ctx.beginPath();
  ctx.moveTo(11, -11);
  ctx.lineTo(15, -22);
  ctx.lineTo(18, -10);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(18, -10);
  ctx.lineTo(23, -21);
  ctx.lineTo(24, -8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#8b96a8";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-12, -4);
  ctx.bezierCurveTo(-34, -24 - tailFlick, -38, 18, -20, 26 + tailFlick);
  ctx.stroke();

  ctx.strokeStyle = "#cbd3de";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-15, -7);
  ctx.bezierCurveTo(-28, -16, -28, 10, -13, 20);
  ctx.stroke();

  ctx.fillStyle = "#fff9ef";
  ctx.beginPath();
  ctx.arc(16, -7, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2f1708";
  ctx.beginPath();
  ctx.arc(16, -7, 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(22, -3, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawRoundOverlay() {
  if (state.mode === "playing") {
    return;
  }

  ctx.fillStyle = "rgba(37, 27, 11, 0.36)";
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.fillStyle = "rgba(56, 39, 15, 0.88)";
  roundRect(ctx, WORLD.width / 2 - 220, WORLD.height / 2 - 108, 440, 216, 28);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 223, 176, 0.28)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#fff4db";
  ctx.textAlign = "center";
  ctx.font = '700 34px "Avenir Next Condensed", "Trebuchet MS", sans-serif';
  ctx.fillText(overlayTitle(), WORLD.width / 2, WORLD.height / 2 - 42);

  ctx.fillStyle = "#ffd7a2";
  ctx.font = '500 18px "Avenir Next Condensed", "Trebuchet MS", sans-serif';
  ctx.fillText(overlaySubtitle(), WORLD.width / 2, WORLD.height / 2);

  ctx.fillStyle = "#fff8ea";
  ctx.font = '600 18px "Avenir Next Condensed", "Trebuchet MS", sans-serif';
  ctx.fillText("Press Start, Space, Enter, or drag the field to begin.", WORLD.width / 2, WORLD.height / 2 + 42);
}

function overlayTitle() {
  if (state.mode === "menu") {
    return "Corgi Fence Chase";
  }

  if (state.mode === "won") {
    return "Fence Cleared";
  }

  return "Squirrel Escaped";
}

function overlaySubtitle() {
  if (state.mode === "menu") {
    return "Steer, jump the spinning blocker, and catch 5 squirrels.";
  }

  if (state.mode === "won") {
    return `You caught all ${GOAL_CATCHES} squirrels with ${state.timeLeft.toFixed(1)}s left.`;
  }

  return `You finished with ${state.catches} of ${GOAL_CATCHES} catches.`;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function approach(current, target, maxDelta) {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }

  return Math.max(current - maxDelta, target);
}
