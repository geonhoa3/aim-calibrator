/**
 * game.js - Three.js 3D 게임 엔진
 *
 * FPS 시점: 카메라가 눈높이에서 yaw/pitch 회전
 * 타겟은 3D 공간에 구체로 등장, 레이캐스팅으로 히트 판정
 */

const Game = (() => {
    // Three.js 객체
    let scene, camera, renderer;
    let targetMesh, targetGlow, timerRing;
    let raycaster;

    // 게임 상태
    let isRunning = false;
    let isPointerLocked = false;
    let initialized = false;

    // 카메라 회전 (radian)
    let yaw = 0;
    let pitch = 0;

    // 타겟 상태
    let targetPosition = null;
    let targetAppearTime = 0;

    // 마우스 트레일
    let mouseTrail = [];

    // 감도
    let sensitivity = 1.0;
    const BASE_TURN_RATE = 0.003;

    // 설정
    const CAMERA_HEIGHT = 1.7;
    const TARGET_RADIUS = 0.5;
    const TARGET_LIFETIME = 1000;
    const PITCH_LIMIT = 85 * Math.PI / 180;

    // 거리 패턴
    let spawnCount = 0;
    const DIST_NEAR = { min: 5, max: 12 };
    const DIST_FAR = { min: 15, max: 30 };

    // 콜백
    let onShotCallback = null;

    // 바인딩된 이벤트 핸들러
    let boundOnMouseMove = null;
    let boundOnMouseDown = null;
    let boundOnPointerLockChange = null;
    let boundRequestPointerLock = null;

    function init() {
        console.log('[Game] init() called (no-op, THREE exists:', typeof THREE !== 'undefined', ')');
    }

    function initThree() {
        if (initialized) {
            console.log('[Game] initThree() - already initialized, resizing');
            onResize();
            return;
        }

        console.log('[Game] initThree() - creating scene...');

        try {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x111118);
            scene.fog = new THREE.Fog(0x111118, 30, 80);

            const w = window.innerWidth;
            const h = window.innerHeight;
            console.log('[Game] viewport:', w, 'x', h);

            camera = new THREE.PerspectiveCamera(103, w / h, 0.1, 200);
            camera.position.set(0, CAMERA_HEIGHT, 0);

            const canvas = document.getElementById('game-canvas');
            console.log('[Game] canvas element:', canvas, 'offsetSize:', canvas.offsetWidth, 'x', canvas.offsetHeight);

            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
            renderer.setSize(w, h);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            raycaster = new THREE.Raycaster();

            setupEnvironment();

            // 첫 프레임 렌더링 테스트
            renderer.render(scene, camera);
            console.log('[Game] initThree() complete, first render done');

            window.addEventListener('resize', onResize);
            initialized = true;

        } catch (e) {
            console.error('[Game] initThree() FAILED:', e);
        }
    }

    function setupEnvironment() {
        // 조명
        const ambient = new THREE.AmbientLight(0x404060, 0.8);
        scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xffffff, 1.0);
        directional.position.set(10, 20, 10);
        scene.add(directional);

        // 바닥 그리드
        const grid = new THREE.GridHelper(100, 100, 0x1a1a2e, 0x1a1a2e);
        scene.add(grid);

        // 바닥 면
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.9 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01;
        scene.add(floor);

        console.log('[Game] environment setup done, scene children:', scene.children.length);
    }

    function onResize() {
        if (!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function start(sens, onShot) {
        console.log('[Game] start() called, sens:', sens);

        sensitivity = sens;
        onShotCallback = onShot;
        yaw = 0;
        pitch = 0;
        mouseTrail = [];
        spawnCount = 0;
        isRunning = true;

        // Three.js 초기화
        initThree();

        // 카메라 초기 방향
        updateCameraRotation();

        // 이벤트 바인딩
        boundRequestPointerLock = function () {
            console.log('[Game] canvas clicked, requesting pointer lock');
            renderer.domElement.requestPointerLock();
        };
        boundOnPointerLockChange = onPointerLockChange;
        boundOnMouseMove = onMouseMove;
        boundOnMouseDown = onMouseDown;

        renderer.domElement.addEventListener('click', boundRequestPointerLock);
        document.addEventListener('pointerlockchange', boundOnPointerLockChange);
        document.addEventListener('mousemove', boundOnMouseMove);
        document.addEventListener('mousedown', boundOnMouseDown);

        // 타겟 먼저 생성
        spawnTarget();

        // 포인터락 요청 (유저 제스처 필요 → 클릭 이벤트에서도 요청)
        setTimeout(function () {
            if (isRunning && renderer) {
                console.log('[Game] requesting pointer lock (delayed)');
                renderer.domElement.requestPointerLock();
            }
        }, 200);

        // 렌더 루프 시작
        loop();
        console.log('[Game] start() complete, loop running');
    }

    function stop() {
        console.log('[Game] stop()');
        isRunning = false;

        try { document.exitPointerLock(); } catch (e) {}

        if (renderer && boundRequestPointerLock) {
            renderer.domElement.removeEventListener('click', boundRequestPointerLock);
        }
        if (boundOnPointerLockChange) {
            document.removeEventListener('pointerlockchange', boundOnPointerLockChange);
        }
        if (boundOnMouseMove) {
            document.removeEventListener('mousemove', boundOnMouseMove);
        }
        if (boundOnMouseDown) {
            document.removeEventListener('mousedown', boundOnMouseDown);
        }

        var crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = 'none';
        isPointerLocked = false;

        removeTarget();
    }

    function setSensitivity(sens) {
        sensitivity = sens;
    }

    function onPointerLockChange() {
        isPointerLocked = document.pointerLockElement === renderer.domElement;
        console.log('[Game] pointer lock:', isPointerLocked);
        var crosshair = document.getElementById('crosshair');
        if (crosshair) {
            crosshair.style.display = isPointerLocked ? 'block' : 'none';
        }
    }

    function onMouseMove(e) {
        if (!isPointerLocked || !isRunning || !targetPosition) return;

        yaw += e.movementX * sensitivity * BASE_TURN_RATE;
        pitch -= e.movementY * sensitivity * BASE_TURN_RATE;
        pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

        updateCameraRotation();

        var angDist = getAngularDistance();
        mouseTrail.push({
            time: performance.now(),
            angularDistance: angDist,
            rawDX: e.movementX,
            rawDY: e.movementY,
            yaw: yaw,
            pitch: pitch
        });
    }

    function onMouseDown(e) {
        if (!isPointerLocked || !isRunning || !targetPosition) return;
        if (e.button !== 0) return;
        fireShot(false);
    }

    function updateCameraRotation() {
        var dir = new THREE.Vector3(
            Math.sin(yaw) * Math.cos(pitch),
            Math.sin(pitch),
            -Math.cos(yaw) * Math.cos(pitch)
        );
        camera.lookAt(
            camera.position.x + dir.x,
            camera.position.y + dir.y,
            camera.position.z + dir.z
        );
    }

    function getAngularDistance() {
        if (!targetPosition) return 999;

        var camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);

        var toTarget = new THREE.Vector3()
            .subVectors(targetPosition, camera.position)
            .normalize();

        return camDir.angleTo(toTarget);
    }

    function fireShot(isTimeout) {
        if (!targetPosition) return;

        var shotTime = performance.now();
        var reactionTime = shotTime - targetAppearTime;
        var angularDistance = getAngularDistance();

        var isHit = false;
        if (!isTimeout && targetMesh) {
            raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
            var intersects = raycaster.intersectObject(targetMesh);
            isHit = intersects.length > 0;
        }

        var shotData = {
            hit: isHit,
            timeout: isTimeout,
            angularDistance: angularDistance,
            reactionTime: isTimeout ? TARGET_LIFETIME : reactionTime,
            trail: mouseTrail.slice(),
            sensitivity: sensitivity
        };

        mouseTrail = [];

        if (onShotCallback) {
            onShotCallback(shotData);
        }

        if (isRunning) {
            spawnTarget();
        }
    }

    function removeTarget() {
        if (targetMesh) {
            scene.remove(targetMesh);
            targetMesh.geometry.dispose();
            targetMesh.material.dispose();
            targetMesh = null;
        }
        if (targetGlow) {
            scene.remove(targetGlow);
            targetGlow.geometry.dispose();
            targetGlow.material.dispose();
            targetGlow = null;
        }
        if (timerRing) {
            scene.remove(timerRing);
            timerRing.geometry.dispose();
            timerRing.material.dispose();
            timerRing = null;
        }
        targetPosition = null;
    }

    function spawnTarget() {
        removeTarget();

        var isNear = spawnCount % 2 === 0;
        var range = isNear ? DIST_NEAR : DIST_FAR;
        spawnCount++;

        var dist = range.min + Math.random() * (range.max - range.min);

        // FOV 103도 기준, 화면 안쪽에서만 출현
        // 좌우 ±35도, 상하 ±20도 (화면 가장자리 안쪽 여유)
        var yawOffset = (Math.random() - 0.5) * 2 * (35 * Math.PI / 180);
        var pitchOffset = (Math.random() - 0.5) * 2 * (20 * Math.PI / 180);

        // 최소 각도 보장 (너무 정 가운데에 나오지 않도록)
        if (Math.abs(yawOffset) < 8 * Math.PI / 180) {
            yawOffset = (yawOffset >= 0 ? 1 : -1) * (8 + Math.random() * 27) * Math.PI / 180;
        }

        var targetYaw = yaw + yawOffset;
        var targetPitch = pitch + pitchOffset;
        // pitch 전체 범위 클램프
        targetPitch = Math.max(-0.3, Math.min(0.5, targetPitch));

        var x = camera.position.x + Math.sin(targetYaw) * Math.cos(targetPitch) * dist;
        var y = CAMERA_HEIGHT + Math.sin(targetPitch) * dist;
        var z = camera.position.z - Math.cos(targetYaw) * Math.cos(targetPitch) * dist;

        var clampedY = Math.max(TARGET_RADIUS + 0.1, y);

        targetPosition = new THREE.Vector3(x, clampedY, z);

        // 타겟 구체
        var geo = new THREE.SphereGeometry(TARGET_RADIUS, 24, 24);
        var mat = new THREE.MeshStandardMaterial({
            color: 0xff3c3c,
            emissive: 0xff1111,
            emissiveIntensity: 0.3,
            roughness: 0.3,
            metalness: 0.1
        });
        targetMesh = new THREE.Mesh(geo, mat);
        targetMesh.position.copy(targetPosition);
        scene.add(targetMesh);

        // 글로우 링
        var glowGeo = new THREE.RingGeometry(TARGET_RADIUS * 1.3, TARGET_RADIUS * 1.6, 32);
        var glowMat = new THREE.MeshBasicMaterial({
            color: 0xff3c3c,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        targetGlow = new THREE.Mesh(glowGeo, glowMat);
        targetGlow.position.copy(targetPosition);
        scene.add(targetGlow);

        // 타이머 링
        var torusGeo = new THREE.TorusGeometry(TARGET_RADIUS * 1.8, 0.04, 8, 64);
        var torusMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        timerRing = new THREE.Mesh(torusGeo, torusMat);
        timerRing.position.copy(targetPosition);
        scene.add(timerRing);

        targetAppearTime = performance.now();
        console.log('[Game] target spawned at dist:', dist.toFixed(1), 'pos:', targetPosition.x.toFixed(1), targetPosition.y.toFixed(1), targetPosition.z.toFixed(1));
    }

    function loop() {
        if (!isRunning) return;

        // 타임아웃 체크
        if (targetPosition && isPointerLocked) {
            var elapsed = performance.now() - targetAppearTime;
            if (elapsed >= TARGET_LIFETIME) {
                fireShot(true);
            }
        }

        updateTargetVisuals();

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }

        requestAnimationFrame(loop);
    }

    function updateTargetVisuals() {
        if (!targetPosition || !targetMesh) return;

        var elapsed = performance.now() - targetAppearTime;
        var timeRatio = Math.max(0, 1 - elapsed / TARGET_LIFETIME);

        if (targetGlow) {
            targetGlow.lookAt(camera.position);
            targetGlow.material.opacity = 0.15 + timeRatio * 0.15;
        }

        if (timerRing) {
            timerRing.lookAt(camera.position);
            var scale = Math.max(0.01, timeRatio);
            timerRing.scale.set(scale, scale, scale);
            timerRing.material.color.setRGB(1 - timeRatio, timeRatio, 0);
            timerRing.material.opacity = 0.3 + timeRatio * 0.5;
        }

        if (targetMesh) {
            var alpha = 0.6 + timeRatio * 0.4;
            targetMesh.material.opacity = alpha;
            targetMesh.material.transparent = alpha < 1;
            targetMesh.material.emissiveIntensity = 0.2 + timeRatio * 0.3;
        }
    }

    return { init: init, start: start, stop: stop, setSensitivity: setSensitivity };
})();
