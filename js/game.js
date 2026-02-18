/**
 * game.js - Three.js 3D 게임 엔진 (오버워치 연습장 스타일)
 *
 * 타겟: 오버워치 봇 실루엣 (머리+몸통+다리 조합)
 * 환경: 밝은 연습장 느낌
 * 크로스헤어: CSS 기반 오버워치 스타일 (별도 #crosshair)
 */

const Game = (() => {
    // Three.js 객체
    let scene, camera, renderer;
    let targetGroup, timerRing;
    let raycaster;

    // 게임 상태
    let isRunning = false;
    let isPointerLocked = false;
    let initialized = false;

    // 카메라 회전
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
    const TARGET_LIFETIME = 1000;
    const PITCH_LIMIT = 85 * Math.PI / 180;

    // 봇 크기 (오버워치 연습장 봇 비율)
    const BOT_HEIGHT = 1.8;       // 전체 높이
    const BOT_BODY_WIDTH = 0.5;
    const BOT_HEAD_RADIUS = 0.2;
    const HIT_RADIUS = 0.6;       // 히트 판정 반경

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

    function init() {}

    function initThree() {
        if (initialized) {
            onResize();
            return;
        }

        try {
            // === Scene (밝은 연습장) ===
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x87CEEB); // 하늘색
            scene.fog = new THREE.FogExp2(0xc8ddf0, 0.008);

            var w = window.innerWidth;
            var h = window.innerHeight;

            camera = new THREE.PerspectiveCamera(103, w / h, 0.1, 300);
            camera.position.set(0, CAMERA_HEIGHT, 0);

            var canvas = document.getElementById('game-canvas');
            renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
            renderer.setSize(w, h);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.2;

            raycaster = new THREE.Raycaster();

            setupEnvironment();

            renderer.render(scene, camera);
            window.addEventListener('resize', onResize);
            initialized = true;

        } catch (e) {
            console.error('[Game] initThree() FAILED:', e);
        }
    }

    function setupEnvironment() {
        // === 조명 (밝은 야외) ===
        var hemi = new THREE.HemisphereLight(0x87CEEB, 0x556655, 0.8);
        scene.add(hemi);

        var sun = new THREE.DirectionalLight(0xfff5e0, 1.5);
        sun.position.set(30, 50, 20);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 1024;
        sun.shadow.mapSize.height = 1024;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 150;
        sun.shadow.camera.left = -50;
        sun.shadow.camera.right = 50;
        sun.shadow.camera.top = 50;
        sun.shadow.camera.bottom = -50;
        scene.add(sun);

        var fill = new THREE.DirectionalLight(0x8899bb, 0.4);
        fill.position.set(-20, 10, -10);
        scene.add(fill);

        // === 바닥 (연습장 스타일 - 밝은 회색 콘크리트) ===
        var floorGeo = new THREE.PlaneGeometry(200, 200);
        var floorMat = new THREE.MeshStandardMaterial({
            color: 0xc0c0c8,
            roughness: 0.85,
            metalness: 0.05
        });
        var floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // 바닥 그리드 라인 (연습장 바닥 마킹)
        var grid = new THREE.GridHelper(200, 40, 0x999999, 0xaaaaaa);
        grid.position.y = 0.01;
        grid.material.opacity = 0.3;
        grid.material.transparent = true;
        scene.add(grid);

        // === 배경 벽 (연습장 느낌) ===
        var wallMat = new THREE.MeshStandardMaterial({
            color: 0xb0b8c0,
            roughness: 0.7,
            metalness: 0.1
        });

        // 뒷벽
        var backWall = new THREE.Mesh(
            new THREE.BoxGeometry(60, 8, 0.5),
            wallMat
        );
        backWall.position.set(0, 4, -40);
        backWall.receiveShadow = true;
        scene.add(backWall);

        // 좌우 벽
        var leftWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 8, 80),
            wallMat
        );
        leftWall.position.set(-30, 4, 0);
        scene.add(leftWall);

        var rightWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 8, 80),
            wallMat
        );
        rightWall.position.set(30, 4, 0);
        scene.add(rightWall);

        // === 벽 상단 주황색 스트라이프 (오버워치 연습장 느낌) ===
        var stripeMat = new THREE.MeshStandardMaterial({
            color: 0xF79E02,
            emissive: 0xF79E02,
            emissiveIntensity: 0.2,
            roughness: 0.5
        });

        var backStripe = new THREE.Mesh(
            new THREE.BoxGeometry(60, 0.4, 0.6),
            stripeMat
        );
        backStripe.position.set(0, 8, -40);
        scene.add(backStripe);

        // === 바닥 원형 마킹들 (스폰 포인트 느낌) ===
        var ringMat = new THREE.MeshBasicMaterial({
            color: 0x4499cc,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        for (var i = 0; i < 5; i++) {
            var ring = new THREE.Mesh(
                new THREE.RingGeometry(0.8, 1.0, 32),
                ringMat
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(-12 + i * 6, 0.02, -15);
            scene.add(ring);
        }

        // === 장식 박스들 (커버/구조물 느낌) ===
        var crateMat = new THREE.MeshStandardMaterial({
            color: 0x888890,
            roughness: 0.6,
            metalness: 0.2
        });

        var positions = [
            [-20, 1, -20], [18, 1.5, -25], [-15, 0.75, -30],
            [22, 0.75, -15], [-25, 1, -10]
        ];
        var sizes = [
            [2, 2, 2], [3, 3, 2], [1.5, 1.5, 1.5],
            [1.5, 1.5, 3], [2, 2, 1.5]
        ];

        for (var j = 0; j < positions.length; j++) {
            var crate = new THREE.Mesh(
                new THREE.BoxGeometry(sizes[j][0], sizes[j][1], sizes[j][2]),
                crateMat
            );
            crate.position.set(positions[j][0], positions[j][1], positions[j][2]);
            crate.castShadow = true;
            crate.receiveShadow = true;
            scene.add(crate);
        }
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

        initThree();
        updateCameraRotation();

        boundRequestPointerLock = function () {
            renderer.domElement.requestPointerLock();
        };
        boundOnPointerLockChange = onPointerLockChange;
        boundOnMouseMove = onMouseMove;
        boundOnMouseDown = onMouseDown;

        renderer.domElement.addEventListener('click', boundRequestPointerLock);
        document.addEventListener('pointerlockchange', boundOnPointerLockChange);
        document.addEventListener('mousemove', boundOnMouseMove);
        document.addEventListener('mousedown', boundOnMouseDown);

        spawnTarget();

        setTimeout(function () {
            if (isRunning && renderer) {
                renderer.domElement.requestPointerLock();
            }
        }, 200);

        loop();
    }

    function stop() {
        isRunning = false;
        try { document.exitPointerLock(); } catch (e) {}

        if (renderer && boundRequestPointerLock) {
            renderer.domElement.removeEventListener('click', boundRequestPointerLock);
        }
        if (boundOnPointerLockChange) document.removeEventListener('pointerlockchange', boundOnPointerLockChange);
        if (boundOnMouseMove) document.removeEventListener('mousemove', boundOnMouseMove);
        if (boundOnMouseDown) document.removeEventListener('mousedown', boundOnMouseDown);

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
        var crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = isPointerLocked ? 'flex' : 'none';
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

    // === 오버워치 봇 실루엣 생성 ===
    function createBotMesh() {
        var group = new THREE.Group();

        // 색상: 빨간 팀 색상 (주황-빨강)
        var bodyMat = new THREE.MeshStandardMaterial({
            color: 0xE84040,
            emissive: 0xCC2020,
            emissiveIntensity: 0.15,
            roughness: 0.4,
            metalness: 0.3
        });
        var darkMat = new THREE.MeshStandardMaterial({
            color: 0x882020,
            roughness: 0.5,
            metalness: 0.2
        });
        var glowMat = new THREE.MeshStandardMaterial({
            color: 0xFF4444,
            emissive: 0xFF2222,
            emissiveIntensity: 0.6,
            roughness: 0.3
        });

        // 다리 (2개의 기둥)
        var legGeo = new THREE.BoxGeometry(0.15, 0.7, 0.15);
        var leftLeg = new THREE.Mesh(legGeo, darkMat);
        leftLeg.position.set(-0.15, 0.35, 0);
        leftLeg.castShadow = true;
        group.add(leftLeg);

        var rightLeg = new THREE.Mesh(legGeo, darkMat);
        rightLeg.position.set(0.15, 0.35, 0);
        rightLeg.castShadow = true;
        group.add(rightLeg);

        // 몸통 (메인 바디 - 넓은 박스)
        var bodyGeo = new THREE.BoxGeometry(BOT_BODY_WIDTH, 0.65, 0.3);
        var body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 1.05, 0);
        body.castShadow = true;
        group.add(body);

        // 어깨 (넓은 판)
        var shoulderGeo = new THREE.BoxGeometry(0.7, 0.12, 0.25);
        var shoulder = new THREE.Mesh(shoulderGeo, bodyMat);
        shoulder.position.set(0, 1.42, 0);
        shoulder.castShadow = true;
        group.add(shoulder);

        // 목
        var neckGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.12, 8);
        var neck = new THREE.Mesh(neckGeo, darkMat);
        neck.position.set(0, 1.54, 0);
        group.add(neck);

        // 머리 (약간 납작한 구체)
        var headGeo = new THREE.SphereGeometry(BOT_HEAD_RADIUS, 16, 12);
        var head = new THREE.Mesh(headGeo, bodyMat);
        head.position.set(0, 1.72, 0);
        head.scale.set(1, 0.9, 0.85);
        head.castShadow = true;
        group.add(head);

        // 눈 (발광 라인 - 오버워치 봇 특유의 빛나는 바이저)
        var visorGeo = new THREE.BoxGeometry(0.28, 0.04, 0.05);
        var visor = new THREE.Mesh(visorGeo, glowMat);
        visor.position.set(0, 1.74, 0.17);
        group.add(visor);

        // 가슴 중앙 표적 (빛나는 원)
        var targetRingGeo = new THREE.RingGeometry(0.08, 0.11, 16);
        var targetRingMat = new THREE.MeshBasicMaterial({
            color: 0xFF6600,
            side: THREE.DoubleSide
        });
        var chestTarget = new THREE.Mesh(targetRingGeo, targetRingMat);
        chestTarget.position.set(0, 1.05, 0.16);
        group.add(chestTarget);

        // 발판 (오버워치 연습장 봇 아래 원형 받침대)
        var baseCyl = new THREE.CylinderGeometry(0.4, 0.45, 0.08, 24);
        var baseMat = new THREE.MeshStandardMaterial({
            color: 0x556677,
            roughness: 0.4,
            metalness: 0.5
        });
        var base = new THREE.Mesh(baseCyl, baseMat);
        base.position.set(0, 0.04, 0);
        base.receiveShadow = true;
        group.add(base);

        return group;
    }

    function fireShot(isTimeout) {
        if (!targetPosition) return;

        var shotTime = performance.now();
        var reactionTime = shotTime - targetAppearTime;
        var angularDistance = getAngularDistance();

        var isHit = false;
        if (!isTimeout && targetGroup) {
            raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
            // 봇의 모든 자식 메시에 대해 레이캐스트
            var intersects = raycaster.intersectObjects(targetGroup.children, true);
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

        if (onShotCallback) onShotCallback(shotData);
        if (isRunning) spawnTarget();
    }

    function removeTarget() {
        if (targetGroup) {
            scene.remove(targetGroup);
            targetGroup.traverse(function (child) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            targetGroup = null;
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
        var yawOffset = (Math.random() - 0.5) * 2 * (35 * Math.PI / 180);
        var pitchOffset = (Math.random() - 0.5) * 2 * (12 * Math.PI / 180);

        // 최소 각도
        if (Math.abs(yawOffset) < 8 * Math.PI / 180) {
            yawOffset = (yawOffset >= 0 ? 1 : -1) * (8 + Math.random() * 27) * Math.PI / 180;
        }

        var targetYaw = yaw + yawOffset;

        // 봇은 바닥에 세우므로 pitch 오프셋은 작게 (거의 바닥 레벨)
        var x = camera.position.x + Math.sin(targetYaw) * dist;
        var z = camera.position.z - Math.cos(targetYaw) * dist;

        // 봇 중심 높이 (봇 전체 높이의 중간)
        targetPosition = new THREE.Vector3(x, BOT_HEIGHT / 2, z);

        // 봇 실루엣 생성
        targetGroup = createBotMesh();
        targetGroup.position.set(x, 0, z);

        // 카메라 방향을 바라보게 회전 (Y축만)
        var lookYaw = Math.atan2(
            camera.position.x - x,
            -(camera.position.z - z)
        );
        targetGroup.rotation.y = lookYaw;

        scene.add(targetGroup);

        // 타이머 링 (봇 머리 위)
        var torusGeo = new THREE.TorusGeometry(0.35, 0.03, 8, 48);
        var torusMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        timerRing = new THREE.Mesh(torusGeo, torusMat);
        timerRing.position.set(x, BOT_HEIGHT + 0.4, z);
        scene.add(timerRing);

        targetAppearTime = performance.now();
    }

    function loop() {
        if (!isRunning) return;

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
        if (!targetPosition || !targetGroup) return;

        var elapsed = performance.now() - targetAppearTime;
        var timeRatio = Math.max(0, 1 - elapsed / TARGET_LIFETIME);

        // 타이머 링
        if (timerRing) {
            timerRing.lookAt(camera.position);
            var scale = Math.max(0.01, timeRatio);
            timerRing.scale.set(scale, scale, scale);
            timerRing.material.color.setRGB(1 - timeRatio, timeRatio, 0);
            timerRing.material.opacity = 0.3 + timeRatio * 0.5;
        }

        // 봇 투명도 변화
        if (timeRatio < 0.3) {
            targetGroup.traverse(function (child) {
                if (child.material) {
                    child.material.transparent = true;
                    child.material.opacity = 0.4 + timeRatio * 2;
                }
            });
        }
    }

    return { init: init, start: start, stop: stop, setSensitivity: setSensitivity };
})();
