/**
 * main.js - 앱 초기화 및 화면 전환
 *
 * 흐름:
 *   시작 화면 (버튼만) → 게임 (수렴까지) → 결과 화면 (DPI 선택 → 실시간 변환)
 */

(function () {
    let selectedDPI = 800;

    console.log('[main] 초기화 시작');
    console.log('[main] THREE 존재:', typeof THREE !== 'undefined');
    console.log('[main] Game 존재:', typeof Game !== 'undefined');
    console.log('[main] Calibration 존재:', typeof Calibration !== 'undefined');
    console.log('[main] Result 존재:', typeof Result !== 'undefined');

    function showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        console.log('[main] 화면 전환:', screenId);
    }

    // Game.init()은 이제 no-op
    if (typeof Game !== 'undefined') {
        Game.init();
    }

    // === 시작 화면 ===
    const btnStart = document.getElementById('btn-start');
    if (btnStart) {
        console.log('[main] btn-start 이벤트 등록 완료');
        btnStart.addEventListener('click', () => {
            console.log('[main] 캘리브레이션 시작 버튼 클릭');
            try {
                Calibration.init();
                updateHUD(1, 1.0);
                showScreen('screen-game');
                Game.start(1.0, onShot);
                console.log('[main] Game.start() 완료');
            } catch (e) {
                console.error('[main] 시작 오류:', e);
            }
        });
    } else {
        console.error('[main] btn-start 요소를 찾을 수 없음');
    }

    // === 게임 중 사격 콜백 ===
    function onShot(shotData) {
        const result = Calibration.processShotData(shotData);

        updateHUD(result.round, result.nextMultiplier);

        if (result.isComplete) {
            Game.stop();
            showResult();
        } else {
            Game.setSensitivity(result.nextMultiplier);
        }
    }

    function updateHUD(round, multiplier) {
        document.getElementById('hud-round').textContent = `라운드: ${round}`;
        document.getElementById('hud-sens').textContent = `배율: ${multiplier}x`;
    }

    // === 결과 화면 ===
    function showResult() {
        showScreen('screen-result');
        selectedDPI = 800;
        updateResult();
    }

    function updateResult() {
        const data = Calibration.getResult(selectedDPI);
        Result.show(data);

        document.querySelectorAll('.dpi-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.dpi) === selectedDPI);
        });

        const customInput = document.getElementById('input-dpi-custom');
        const isPreset = [400, 800, 1200, 1600, 3200].includes(selectedDPI);
        if (!isPreset) {
            customInput.value = selectedDPI;
        } else {
            customInput.value = '';
        }
    }

    // DPI 프리셋 버튼
    document.querySelectorAll('.dpi-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedDPI = parseInt(btn.dataset.dpi);
            document.getElementById('input-dpi-custom').value = '';
            updateResult();
        });
    });

    // DPI 커스텀 입력
    document.getElementById('input-dpi-custom').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        if (val && val >= 100 && val <= 25600) {
            selectedDPI = val;
            document.querySelectorAll('.dpi-btn').forEach(btn => btn.classList.remove('active'));
            updateResult();
        }
    });

    // 결과 이미지 저장
    document.getElementById('btn-save').addEventListener('click', () => {
        Result.saveImage();
    });

    // 다시 측정
    document.getElementById('btn-retry').addEventListener('click', () => {
        showScreen('screen-start');
    });

    console.log('[main] 초기화 완료');
})();
