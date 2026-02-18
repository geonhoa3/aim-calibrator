/**
 * game.js - Three.js 3D 게임 엔진 (오버워치 연습장 스타일)
 *
 * 타겟: 오버워치 봇 실루엣 (머리+몸통+다리 조합)
 * 환경: 밝은 연습장 느낌
 * 크로스헤어: CSS 기반 오버워치 스타일 (별도 #crosshair)
 *
 * 감도 매칭:
 *   OW 감도 공식 = 0.0066 deg/count/sens
 *   baseTurnRate = owSens × 0.0066 × (π/180) rad/count
 *   unadjustedMovement: true 로 OS 가속 제거
 *
 * 점수제:
 *   - 타겟 타임아웃 없음 (클릭할 때까지 유지)
 *   - 빠른 클릭 시 속도 보너스 (1초 이내)
 *   - 헤드샷 보너스 (머리 부위 히트)
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
    let sensitivity = 1.0;     // 캘리브레이션 배율 (1.0 = 현재 감도 그대로)
    let baseTurnRate = 0.003;  // DPI × OW감도 기반 계산값 (rad/px)

    // 점수
    let score = 0;
    let combo = 0;
    let lastHitTime = 0;

    // 헤드샷용 머리 메시 참조
    let headMeshRef = null;

    // 설정
    const CAMERA_HEIGHT = 1.7;
    const PITCH_LIMIT = 85 * Math.PI / 180;

    // 점수 설정
    const BASE_SCORE = 100;         // 바디샷 기본 점수
    const HEADSHOT_BONUS = 150;     // 헤드샷 추가 점수
    const SPEED_THRESHOLDS = [      // 속도 보너스 구간
        { time: 500,  bonus: 200 },  // 0.5초 이내: +200
        { time: 1000, bonus: 100 },  // 1초 이내: +100
        { time: 2000, bonus: 50 },   // 2초 이내: +50
    ];
    const COMBO_MULTIPLIER = 0.1;   // 콤보당 10% 추가
    const MISS_PENALTY = -50;       // 미스 페널티

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

    // 히트 이펙트
    let hitEffects = [];

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

    /**
     * @param {Object} config - { dpi, owSens, multiplier }
     *   dpi: 마우스 DPI (e.g. 1600)
     *   owSens: 오버워치 현재 감도 (e.g. 2.45)
     *   multiplier: 캘리브레이션 배율 (시작 시 1.0)
     * @param {Function} onShot - 사격 콜백
     */
    function start(config, onShot) {
        // OW 감도 공식: 0.0066 deg/count/sens
        // 1 raw count 이동 시 회전량 = owSens × 0.0066도 = owSens × 0.0066 × (π/180) rad
        //
        // browser movementX (unadjustedMovement: true) = raw hardware counts
        // 따라서: rotation_rad = movementX × owSens × 0.0066 × (π/180)
        baseTurnRate = config.owSens * 0.0066 * (Math.PI / 180);

        sensitivity = config.multiplier || 1.0;
        onShotCallback = onShot;
        yaw = 0;
        pitch = 0;
        mouseTrail = [];
        spawnCount = 0;
        score = 0;
        combo = 0;
        lastHitTime = 0;
        hitEffects = [];
        isRunning = true;

        initThree();
        updateCameraRotation();

        // 점수 HUD 초기화
        updateScoreHUD();

        boundRequestPointerLock = function () {
            // unadjustedMovement: OS 마우스 가속 무시, raw input 사용
            // 오버워치도 Raw Input을 쓰므로 동일한 조건
            var promise = renderer.domElement.requestPointerLock({
                unadjustedMovement: true
            });
            // 미지원 브라우저 폴백
            if (promise && promise.catch) {
                promise.catch(function () {
                    console.warn('[Game] unadjustedMovement not supported, falling back to standard pointer lock');
                    renderer.domElement.requestPointerLock();
                });
            }
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
                var promise = renderer.domElement.requestPointerLock({
                    unadjustedMovement: true
                });
                if (promise && promise.catch) {
                    promise.catch(function () {
                        renderer.domElement.requestPointerLock();
                    });
                }
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

    function getScore() {
        return score;
    }

    function onPointerLockChange() {
        isPointerLocked = document.pointerLockElement === renderer.domElement;
        var crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = isPointerLocked ? 'flex' : 'none';
    }

    function onMouseMove(e) {
        if (!isPointerLocked || !isRunning || !targetPosition) return;

        yaw += e.movementX * sensitivity * baseTurnRate;
        pitch -= e.movementY * sensitivity * baseTurnRate;
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
        fireShot();
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
        leftLeg.userData.part = 'body';
        group.add(leftLeg);

        var rightLeg = new THREE.Mesh(legGeo, darkMat);
        rightLeg.position.set(0.15, 0.35, 0);
        rightLeg.castShadow = true;
        rightLeg.userData.part = 'body';
        group.add(rightLeg);

        // 몸통 (메인 바디 - 넓은 박스)
        var bodyGeo = new THREE.BoxGeometry(BOT_BODY_WIDTH, 0.65, 0.3);
        var body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 1.05, 0);
        body.castShadow = true;
        body.userData.part = 'body';
        group.add(body);

        // 어깨 (넓은 판)
        var shoulderGeo = new THREE.BoxGeometry(0.7, 0.12, 0.25);
        var shoulder = new THREE.Mesh(shoulderGeo, bodyMat);
        shoulder.position.set(0, 1.42, 0);
        shoulder.castShadow = true;
        shoulder.userData.part = 'body';
        group.add(shoulder);

        // 목
        var neckGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.12, 8);
        var neck = new THREE.Mesh(neckGeo, darkMat);
        neck.position.set(0, 1.54, 0);
        neck.userData.part = 'body';
        group.add(neck);

        // 머리 (약간 납작한 구체) - 헤드샷 판정용
        var headGeo = new THREE.SphereGeometry(BOT_HEAD_RADIUS, 16, 12);
        var head = new THREE.Mesh(headGeo, bodyMat);
        head.position.set(0, 1.72, 0);
        head.scale.set(1, 0.9, 0.85);
        head.castShadow = true;
        head.userData.part = 'head';  // 헤드샷 판정용 태그
        group.add(head);

        // 눈 (발광 라인 - 오버워치 봇 특유의 빛나는 바이저)
        var visorGeo = new THREE.BoxGeometry(0.28, 0.04, 0.05);
        var visor = new THREE.Mesh(visorGeo, glowMat);
        visor.position.set(0, 1.74, 0.17);
        visor.userData.part = 'head';  // 바이저도 헤드샷
        group.add(visor);

        // 가슴 중앙 표적 (빛나는 원)
        var targetRingGeo = new THREE.RingGeometry(0.08, 0.11, 16);
        var targetRingMat = new THREE.MeshBasicMaterial({
            color: 0xFF6600,
            side: THREE.DoubleSide
        });
        var chestTarget = new THREE.Mesh(targetRingGeo, targetRingMat);
        chestTarget.position.set(0, 1.05, 0.16);
        chestTarget.userData.part = 'body';
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
        base.userData.part = 'body';
        group.add(base);

        return group;
    }

    function fireShot() {
        if (!targetPosition) return;

        var shotTime = performance.now();
        var reactionTime = shotTime - targetAppearTime;
        var angularDistance = getAngularDistance();

        var isHit = false;
        var isHeadshot = false;

        if (targetGroup) {
            raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
            // 봇의 모든 자식 메시에 대해 레이캐스트
            var intersects = raycaster.intersectObjects(targetGroup.children, true);
            if (intersects.length > 0) {
                isHit = true;
                // 첫 번째 히트 오브젝트의 part 확인
                for (var i = 0; i < intersects.length; i++) {
                    var hitObj = intersects[i].object;
                    if (hitObj.userData && hitObj.userData.part === 'head') {
                        isHeadshot = true;
                        break;
                    }
                }
            }
        }

        // 점수 계산
        var shotScore = calculateScore(isHit, isHeadshot, reactionTime);
        score += shotScore;

        // 콤보 처리
        if (isHit) {
            combo++;
            lastHitTime = shotTime;
        } else {
            combo = 0;
        }

        // 히트 이펙트 표시
        showHitEffect(isHit, isHeadshot, shotScore);

        // 점수 HUD 업데이트
        updateScoreHUD();

        var shotData = {
            hit: isHit,
            headshot: isHeadshot,
            timeout: false,
            angularDistance: angularDistance,
            reactionTime: reactionTime,
            trail: mouseTrail.slice(),
            sensitivity: sensitivity,
            score: shotScore,
            totalScore: score,
            combo: combo
        };

        mouseTrail = [];

        if (onShotCallback) onShotCallback(shotData);
        if (isRunning) spawnTarget();
    }

    function calculateScore(isHit, isHeadshot, reactionTime) {
        if (!isHit) return MISS_PENALTY;

        var total = BASE_SCORE;

        // 헤드샷 보너스
        if (isHeadshot) {
            total += HEADSHOT_BONUS;
        }

        // 속도 보너스
        for (var i = 0; i < SPEED_THRESHOLDS.length; i++) {
            if (reactionTime <= SPEED_THRESHOLDS[i].time) {
                total += SPEED_THRESHOLDS[i].bonus;
                break;
            }
        }

        // 콤보 보너스 (현재 콤보 × 10% 추가)
        if (combo > 0) {
            total += Math.floor(total * combo * COMBO_MULTIPLIER);
        }

        return total;
    }

    function showHitEffect(isHit, isHeadshot, shotScore) {
        // 화면에 히트 텍스트 이펙트 표시
        var el = document.createElement('div');
        el.className = 'hit-effect';

        if (!isHit) {
            el.textContent = 'MISS';
            el.classList.add('hit-miss');
        } else if (isHeadshot) {
            el.textContent = 'HEADSHOT! +' + shotScore;
            el.classList.add('hit-headshot');
        } else {
            el.textContent = '+' + shotScore;
            el.classList.add('hit-body');
        }

        // 크로스헤어 근처에 표시
        el.style.position = 'fixed';
        el.style.left = '50%';
        el.style.top = '45%';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '20';

        document.body.appendChild(el);

        // 애니메이션 후 제거
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 800);
    }

    function updateScoreHUD() {
        var scoreEl = document.getElementById('hud-score');
        if (scoreEl) {
            scoreEl.textContent = '점수: ' + score;
        }
        var comboEl = document.getElementById('hud-combo');
        if (comboEl) {
            if (combo >= 2) {
                comboEl.textContent = combo + ' COMBO';
                comboEl.style.display = 'block';
            } else {
                comboEl.style.display = 'none';
            }
        }
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
        headMeshRef = null;
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

        targetAppearTime = performance.now();
    }

    function loop() {
        if (!isRunning) return;

        // 타임아웃 삭제됨 - 타겟은 클릭할 때까지 유지

        // 봇 살짝 움직이는 애니메이션 (idle motion)
        updateTargetVisuals();

        // 히트 이펙트 업데이트
        updateHitEffects();

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }

        requestAnimationFrame(loop);
    }

    function updateTargetVisuals() {
        if (!targetPosition || !targetGroup) return;

        // 봇이 살짝 위아래로 흔들리는 idle 애니메이션
        var elapsed = performance.now() - targetAppearTime;
        var bobAmount = Math.sin(elapsed * 0.002) * 0.02;
        targetGroup.position.y = bobAmount;
    }

    function updateHitEffects() {
        // 3D 히트 이펙트 업데이트 (향후 확장용)
    }

    return {
        init: init,
        start: start,
        stop: stop,
        setSensitivity: setSensitivity,
        getScore: getScore
    };
})();
