/**
 * game.js - Three.js 3D 게임 엔진
 *
 * FPS 시점: 카메라가 눈높이에서 yaw/pitch 회전
 * 타겟은 3D 공간에 구체로 등장, 레이캐스팅으로 히트 판정
 *
 * calibration.js 인터페이스:
 *   shotData.hit, .timeout, .angularDistance, .reactionTime, .trail[], .sensitivity
 *   trail[].angularDistance = 카메라 정면 ↔ 타겟 방향 각도 (radian)
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
    let yaw = 0;     // 좌우 회전
    let pitch = 0;   // 상하 회전

    // 타겟 상태
    let targetPosition = null; // THREE.Vector3
    let targetAppearTime = 0;

    // 마우스 트레일
    let mouseTrail = [];

    // 감도
    let sensitivity = 1.0;
    const BASE_TURN_RATE = 0.003; // 기본 회전 속도 (rad/px)

    // 설정
    const CAMERA_HEIGHT = 1.7;
    const TARGET_RADIUS = 0.5;    // 월드 단위 (미터급)
    const TARGET_LIFETIME = 1000; // ms
    const PITCH_LIMIT = 85 * Math.PI / 180; // ±85도

    // 거리 패턴
    let spawnCount = 0;
    const DIST_NEAR = { min: 5, max: 12 };
    const DIST_FAR = { min: 15, max: 30 };

    // 콜백
    let onShotCallback = null;

    // 이벤트 핸들러 바인딩 (제거 시 참조 유지용)
    let boundOnMouseMove = null;
    let boundOnMouseDown = null;
    let boundOnPointerLockChange = null;
    let boundRequestPointerLock = null;

    /**
     * 초기화 - 가벼운 호환용 (아무것도 안 함)
     * 실제 Three.js 초기화는 start() 에서 수행
     */
    function init() {
        // no-op: Three.js는 게임 화면이 보일 때 초기화
    }

    /**
     * Three.js 씬/카메라/렌더러 초기화 (화면 표시 후 호출)
     */
    function initThree() {
        if (initialized) {
            // 이미 초기화됨 → 크기만 갱신
            onResize();
            return;
        }

        // Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111118);
        scene.fog = new THREE.Fog(0x111118, 30, 80);

        // Camera (FOV 103 = 오버워치 기본)
        camera = new THREE.PerspectiveCamera(103, window.innerWidth / window.innerHeight, 0.1, 200);
        camera.position.set(0, CAMERA_HEIGHT, 0);

        // Renderer
        const canvas = document.getElementById('game-canvas');
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Raycaster
        raycaster = new THREE.Raycaster();

        // 환경 구성
        setupEnvironment();

        window.addEventListener('resize', onResize);

        initialized = true;
    }

    function setupEnvironment() {
        // 조명
        const ambient = new THREE.AmbientLight(0x404060, 0.8);
        scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xffffff, 1.0);
        directional.position.set(10, 20, 10);
        scene.add(directional);

        // 바닥 그리드
        const groundGrid = new THREE.GridHelper(100, 100, 0x1a1a2e, 0x1a1a2e);
        groundGrid.position.y = 0;
        scene.add(groundGrid);

        // 바닥 면
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a14,
            roughness: 0.9
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01;
        scene.add(floor);
    }

    function onResize() {
        if (!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function start(sens, onShot) {
        sensitivity = sens;
        onShotCallback = onShot;
        yaw = 0;
        pitch = 0;
        mouseTrail = [];
        spawnCount = 0;
        isRunning = true;

        // Three.js 초기화 (게임 화면이 active된 후이므로 canvas 크기 OK)
        initThree();

        // 카메라 초기 방향
        updateCameraRotation();

        // 이벤트 바인딩
        boundRequestPointerLock = () => { renderer.domElement.requestPointerLock(); };
        boundOnPointerLockChange = onPointerLockChange;
        boundOnMouseMove = onMouseMove;
        boundOnMouseDown = onMouseDown;

        renderer.domElement.addEventListener('click', boundRequestPointerLock);
        document.addEventListener('pointerlockchange', boundOnPointerLockChange);
        document.addEventListener('mousemove', boundOnMouseMove);
        document.addEventListener('mousedown', boundOnMouseDown);

        // 약간의 딜레이 후 포인터락 요청 (화면 전환 완료 대기)
        setTimeout(() => {
            if (isRunning && renderer) {
                renderer.domElement.requestPointerLock();
            }
        }, 100);

        spawnTarget();
        loop();
    }

    function stop() {
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

        // 크로스헤어 숨김
        const crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = 'none';

        isPointerLocked = false;

        // 타겟 정리
        removeTarget();
    }

    function setSensitivity(sens) {
        sensitivity = sens;
    }

    function onPointerLockChange() {
        isPointerLocked = document.pointerLockElement === renderer.domElement;
        const crosshair = document.getElementById('crosshair');
        if (crosshair) {
            crosshair.style.display = isPointerLocked ? 'block' : 'none';
        }
    }

    function onMouseMove(e) {
        if (!isPointerLocked || !isRunning || !targetPosition) return;

        // 마우스 이동 → 카메라 회전
        yaw -= e.movementX * sensitivity * BASE_TURN_RATE;
        pitch -= e.movementY * sensitivity * BASE_TURN_RATE;

        // Pitch 클램핑
        pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

        updateCameraRotation();

        // 타겟까지 각도 거리 기록
        const angDist = getAngularDistance();
        mouseTrail.push({
            time: performance.now(),
            angularDistance: angDist,
            rawDX: e.movementX,
            rawDY: e.movementY,
            yaw, pitch
        });
    }

    function onMouseDown(e) {
        if (!isPointerLocked || !isRunning || !targetPosition) return;
        if (e.button !== 0) return;
        fireShot(false);
    }

    /**
     * 카메라 방향 업데이트 (yaw/pitch → lookAt 방향)
     */
    function updateCameraRotation() {
        const dir = new THREE.Vector3(
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

    /**
     * 카메라 정면 방향 ↔ 타겟 방향 각도 (radian)
     */
    function getAngularDistance() {
        if (!targetPosition) return 999;

        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);

        const toTarget = new THREE.Vector3()
            .subVectors(targetPosition, camera.position)
            .normalize();

        return camDir.angleTo(toTarget);
    }

    /**
     * 사격 처리
     */
    function fireShot(isTimeout) {
        if (!targetPosition) return;

        const shotTime = performance.now();
        const reactionTime = shotTime - targetAppearTime;
        const angularDistance = getAngularDistance();

        // 히트 판정: 레이캐스팅 (타임아웃이면 무조건 미스)
        let isHit = false;
        if (!isTimeout && targetMesh) {
            raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
            const intersects = raycaster.intersectObject(targetMesh);
            isHit = intersects.length > 0;
        }

        const shotData = {
            hit: isHit,
            timeout: isTimeout,
            angularDistance,
            reactionTime: isTimeout ? TARGET_LIFETIME : reactionTime,
            trail: [...mouseTrail],
            sensitivity
        };

        mouseTrail = [];

        if (onShotCallback) {
            onShotCallback(shotData);
        }

        // 게임이 아직 실행 중일 때만 다음 타겟 생성
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

        // 거리 패턴: 가까운/먼 번갈아
        const isNear = spawnCount % 2 === 0;
        const range = isNear ? DIST_NEAR : DIST_FAR;
        spawnCount++;

        const dist = range.min + Math.random() * (range.max - range.min);

        // 현재 시선 기준 랜덤 각도 오프셋
        const yawOffset = (Math.random() - 0.5) * Math.PI * 0.8;  // ±72도
        const pitchOffset = (Math.random() - 0.5) * Math.PI * 0.3; // ±27도

        const targetYaw = yaw + yawOffset;
        const targetPitch = Math.max(-0.3, Math.min(0.5, pitch + pitchOffset)); // 너무 아래/위 방지

        // 월드 좌표 계산
        const x = camera.position.x + Math.sin(targetYaw) * Math.cos(targetPitch) * dist;
        const y = CAMERA_HEIGHT + Math.sin(targetPitch) * dist;
        const z = camera.position.z - Math.cos(targetYaw) * Math.cos(targetPitch) * dist;

        // 최소 높이 제한 (바닥 아래 방지)
        const clampedY = Math.max(TARGET_RADIUS + 0.1, y);

        targetPosition = new THREE.Vector3(x, clampedY, z);

        // 타겟 구체
        const geo = new THREE.SphereGeometry(TARGET_RADIUS, 24, 24);
        const mat = new THREE.MeshStandardMaterial({
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
        const glowGeo = new THREE.RingGeometry(TARGET_RADIUS * 1.3, TARGET_RADIUS * 1.6, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xff3c3c,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        targetGlow = new THREE.Mesh(glowGeo, glowMat);
        targetGlow.position.copy(targetPosition);
        scene.add(targetGlow);

        // 타이머 링 (TorusGeometry)
        const torusGeo = new THREE.TorusGeometry(TARGET_RADIUS * 1.8, 0.04, 8, 64);
        const torusMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        timerRing = new THREE.Mesh(torusGeo, torusMat);
        timerRing.position.copy(targetPosition);
        scene.add(timerRing);

        targetAppearTime = performance.now();
    }

    function loop() {
        if (!isRunning) return;

        // 타임아웃 체크
        if (targetPosition && isPointerLocked) {
            const elapsed = performance.now() - targetAppearTime;
            if (elapsed >= TARGET_LIFETIME) {
                fireShot(true);
            }
        }

        updateTargetVisuals();
        renderer.render(scene, camera);
        requestAnimationFrame(loop);
    }

    /**
     * 타겟 시각 업데이트 (타이머, 빌보딩)
     */
    function updateTargetVisuals() {
        if (!targetPosition || !targetMesh) return;

        const elapsed = performance.now() - targetAppearTime;
        const timeRatio = Math.max(0, 1 - elapsed / TARGET_LIFETIME);

        // 글로우 링: 항상 카메라를 바라봄 (빌보딩)
        if (targetGlow) {
            targetGlow.lookAt(camera.position);
            targetGlow.material.opacity = 0.15 + timeRatio * 0.15;
        }

        // 타이머 링: 색상 변화 + 스케일 축소
        if (timerRing) {
            timerRing.lookAt(camera.position);
            const scale = timeRatio;
            timerRing.scale.set(scale, scale, scale);

            // 녹색 → 노란색 → 빨간색
            const r = 1 - timeRatio;
            const g = timeRatio;
            timerRing.material.color.setRGB(r, g, 0);
            timerRing.material.opacity = 0.3 + timeRatio * 0.5;
        }

        // 타겟 본체: 시간 적을수록 살짝 투명
        if (targetMesh) {
            const alpha = 0.6 + timeRatio * 0.4;
            targetMesh.material.opacity = alpha;
            targetMesh.material.transparent = alpha < 1;
            targetMesh.material.emissiveIntensity = 0.2 + timeRatio * 0.3;
        }
    }

    return { init, start, stop, setSensitivity };
})();
