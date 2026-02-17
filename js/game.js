/**
 * game.js - Canvas 게임 엔진
 *
 * FPS 방식: 크로스헤어는 화면 중앙 고정, 마우스 움직이면 "시야(카메라)"가 이동
 *
 * 타겟 시간 제한:
 *   - 타겟 등장 후 최대 TARGET_LIFETIME ms 안에 사격해야 함
 *   - 시간 초과 → 자동 미스 처리 (onShot 콜백에 timeout: true)
 *   - 타이머 링이 줄어들며 남은 시간 표시
 */

const Game = (() => {
    // DOM
    let canvas, ctx;

    // 게임 상태
    let isRunning = false;
    let isPointerLocked = false;

    // 카메라(시야) 위치
    let viewX = 0;
    let viewY = 0;

    // 타겟 (월드 좌표)
    let target = null;
    let targetAppearTime = 0;

    // 마우스 이동 기록
    let mouseTrail = [];

    // 현재 감도
    let sensitivity = 1.0;

    // 설정
    const TARGET_RADIUS = 22;
    const HIT_RADIUS = 28;
    const CANVAS_BG = '#111';
    const TARGET_LIFETIME = 1000; // 타겟 제한 시간 (ms)

    // 콜백
    let onShotCallback = null;

    function init() {
        canvas = document.getElementById('game-canvas');
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
    }

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function start(sens, onShot) {
        sensitivity = sens;
        onShotCallback = onShot;
        viewX = 0;
        viewY = 0;
        mouseTrail = [];
        spawnCount = 0;
        isRunning = true;

        canvas.addEventListener('click', requestPointerLock);
        document.addEventListener('pointerlockchange', onPointerLockChange);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mousedown', onMouseDown);

        requestPointerLock();
        spawnTarget();
        loop();
    }

    function stop() {
        isRunning = false;
        document.exitPointerLock();
        canvas.removeEventListener('click', requestPointerLock);
        document.removeEventListener('pointerlockchange', onPointerLockChange);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mousedown', onMouseDown);
    }

    function setSensitivity(sens) {
        sensitivity = sens;
    }

    function requestPointerLock() {
        canvas.requestPointerLock();
    }

    function onPointerLockChange() {
        isPointerLocked = document.pointerLockElement === canvas;
        const crosshair = document.getElementById('crosshair');
        crosshair.style.display = isPointerLocked ? 'block' : 'none';
    }

    function onMouseMove(e) {
        if (!isPointerLocked || !isRunning || !target) return;

        viewX += e.movementX * sensitivity;
        viewY += e.movementY * sensitivity;

        const screenDX = target.x - viewX;
        const screenDY = target.y - viewY;

        mouseTrail.push({
            time: performance.now(),
            screenDX, screenDY,
            rawDX: e.movementX,
            rawDY: e.movementY,
            viewX, viewY
        });
    }

    function onMouseDown(e) {
        if (!isPointerLocked || !isRunning || !target) return;
        if (e.button !== 0) return;

        fireShot(false); // timeout = false (유저가 직접 클릭)
    }

    /**
     * 사격 처리 (클릭 또는 타임아웃)
     * @param {boolean} isTimeout - 시간 초과로 인한 자동 미스인지
     */
    function fireShot(isTimeout) {
        if (!target) return;

        const shotTime = performance.now();
        const reactionTime = shotTime - targetAppearTime;

        const dx = target.x - viewX;
        const dy = target.y - viewY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const isHit = !isTimeout && distance <= HIT_RADIUS;

        const shotData = {
            hit: isHit,
            timeout: isTimeout,
            distance,
            reactionTime: isTimeout ? TARGET_LIFETIME : reactionTime,
            targetX: target.x,
            targetY: target.y,
            viewX, viewY,
            trail: [...mouseTrail],
            sensitivity
        };

        mouseTrail = [];

        if (onShotCallback) {
            onShotCallback(shotData);
        }

        spawnTarget();
    }

    // 거리 패턴: 가까운/먼 타겟 번갈아 등장
    let spawnCount = 0;
    const DIST_NEAR = { min: 120, max: 250 };  // 가까운: flick shot
    const DIST_FAR  = { min: 350, max: 600 };  // 먼: 대각 이동

    function spawnTarget() {
        // 번갈아가며 가까운/먼 타겟
        const isNear = spawnCount % 2 === 0;
        const range = isNear ? DIST_NEAR : DIST_FAR;
        spawnCount++;

        const angle = Math.random() * Math.PI * 2;
        const dist = range.min + Math.random() * (range.max - range.min);

        target = {
            x: viewX + Math.cos(angle) * dist,
            y: viewY + Math.sin(angle) * dist
        };
        targetAppearTime = performance.now();
    }

    function loop() {
        if (!isRunning) return;

        // 타겟 시간 초과 체크
        if (target && isPointerLocked) {
            const elapsed = performance.now() - targetAppearTime;
            if (elapsed >= TARGET_LIFETIME) {
                fireShot(true); // 타임아웃 미스
            }
        }

        draw();
        requestAnimationFrame(loop);
    }

    function draw() {
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        // 배경
        ctx.fillStyle = CANVAS_BG;
        ctx.fillRect(0, 0, w, h);

        // 격자 (시야 이동에 따라 움직임)
        ctx.strokeStyle = '#1a1a2a';
        ctx.lineWidth = 1;
        const gridSize = 80;
        const gridOffsetX = (-viewX % gridSize + gridSize) % gridSize;
        const gridOffsetY = (-viewY % gridSize + gridSize) % gridSize;

        for (let x = gridOffsetX; x < w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = gridOffsetY; y < h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // 타겟 그리기
        if (target) {
            const screenTX = cx + (target.x - viewX);
            const screenTY = cy + (target.y - viewY);
            const elapsed = performance.now() - targetAppearTime;
            const timeRatio = Math.max(0, 1 - elapsed / TARGET_LIFETIME); // 1→0 줄어듦

            if (screenTX > -50 && screenTX < w + 50 &&
                screenTY > -50 && screenTY < h + 50) {

                // === 타이머 링 (남은 시간 표시) ===
                const timerRadius = TARGET_RADIUS + 12;
                // 색상: 녹색 → 노란색 → 빨간색
                const r = Math.round(255 * (1 - timeRatio));
                const g = Math.round(255 * timeRatio);
                const timerColor = `rgba(${r}, ${g}, 0, 0.7)`;

                ctx.beginPath();
                // -90도(12시)에서 시작, 시계방향으로 줄어듦
                ctx.arc(screenTX, screenTY, timerRadius,
                    -Math.PI / 2,
                    -Math.PI / 2 + Math.PI * 2 * timeRatio,
                    false
                );
                ctx.strokeStyle = timerColor;
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.stroke();

                // === 타겟 본체 ===
                // 시간 적을수록 살짝 투명해짐
                const alpha = 0.5 + timeRatio * 0.5; // 1.0 → 0.5

                ctx.beginPath();
                ctx.arc(screenTX, screenTY, TARGET_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 60, 60, ${alpha})`;
                ctx.fill();

                // 내부 링
                ctx.beginPath();
                ctx.arc(screenTX, screenTY, TARGET_RADIUS * 0.55, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.4})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // 중앙 점
                ctx.beginPath();
                ctx.arc(screenTX, screenTY, 3, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fill();

            } else {
                drawOffScreenIndicator(cx, cy, screenTX, screenTY, w, h, timeRatio);
            }
        }
    }

    /**
     * 타겟 화면 밖 방향 표시 (남은 시간 색상 반영)
     */
    function drawOffScreenIndicator(cx, cy, tx, ty, w, h, timeRatio) {
        const dx = tx - cx;
        const dy = ty - cy;
        const angle = Math.atan2(dy, dx);

        const margin = 40;
        const indicatorX = cx + Math.cos(angle) * (Math.min(w, h) / 2 - margin);
        const indicatorY = cy + Math.sin(angle) * (Math.min(w, h) / 2 - margin);

        const r = Math.round(255 * (1 - timeRatio));
        const g = Math.round(255 * timeRatio);

        ctx.save();
        ctx.translate(indicatorX, indicatorY);
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-6, -7);
        ctx.lineTo(-6, 7);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, 0, 0.7)`;
        ctx.fill();

        ctx.restore();
    }

    return { init, start, stop, setSensitivity };
})();
