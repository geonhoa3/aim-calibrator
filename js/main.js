/**
 * main.js - 앱 초기화 및 화면 전환
 *
 * 흐름:
 *   시작 화면 (DPI + OW감도 입력) → 게임 (인게임과 동일 느낌, 수렴까지) → 결과 화면
 */

(function () {
    // 사용자 입력값
    let userDPI = 1600;
    let userOWSens = 5;

    function showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
        document.getElementById(screenId).classList.add('active');
    }

    if (typeof Game !== 'undefined') Game.init();

    // === 시작 화면: DPI 프리셋 버튼 ===
    document.querySelectorAll('.start-dpi-buttons .dpi-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            userDPI = parseInt(btn.dataset.dpi);
            // 버튼 active 토글
            document.querySelectorAll('.start-dpi-buttons .dpi-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            document.getElementById('input-start-dpi').value = '';
        });
    });

    // DPI 커스텀 입력
    var dpiInput = document.getElementById('input-start-dpi');
    if (dpiInput) {
        dpiInput.addEventListener('input', function (e) {
            var val = parseInt(e.target.value);
            if (val && val >= 100 && val <= 25600) {
                userDPI = val;
                document.querySelectorAll('.start-dpi-buttons .dpi-btn').forEach(function (b) { b.classList.remove('active'); });
            }
        });
    }

    // === 시작 버튼 ===
    var btnStart = document.getElementById('btn-start');
    if (btnStart) {
        btnStart.addEventListener('click', function () {
            // OW 감도 읽기
            var sensInput = document.getElementById('input-ow-sens');
            userOWSens = parseFloat(sensInput.value) || 5;

            // 유효성 체크
            if (userOWSens < 0.01 || userOWSens > 100) userOWSens = 5;
            if (userDPI < 100 || userDPI > 25600) userDPI = 1600;

            try {
                Calibration.init(userDPI, userOWSens);
                updateHUD(1, userOWSens);
                showScreen('screen-game');
                Game.start({
                    dpi: userDPI,
                    owSens: userOWSens,
                    multiplier: 1.0
                }, onShot);
            } catch (e) {
                console.error('[main] 시작 오류:', e);
            }
        });
    }

    // === 게임 중 사격 콜백 ===
    function onShot(shotData) {
        var result = Calibration.processShotData(shotData);

        // HUD: 현재 감도 = 기본감도 × 배율
        var currentSens = Math.round(userOWSens * result.nextMultiplier * 100) / 100;
        updateHUD(result.round, currentSens);

        if (result.isComplete) {
            Game.stop();
            showResult();
        } else {
            Game.setSensitivity(result.nextMultiplier);
        }
    }

    function updateHUD(round, sens) {
        document.getElementById('hud-round').textContent = '라운드: ' + round;
        document.getElementById('hud-sens').textContent = '감도: ' + sens;
    }

    // === 결과 화면 ===
    function showResult() {
        showScreen('screen-result');

        var data = Calibration.getResult();
        Result.show(data);
    }

    // 결과 이미지 저장
    document.getElementById('btn-save').addEventListener('click', function () {
        Result.saveImage();
    });

    // 다시 측정
    document.getElementById('btn-retry').addEventListener('click', function () {
        showScreen('screen-start');
    });
})();
