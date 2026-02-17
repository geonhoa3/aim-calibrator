/**
 * main.js - 앱 초기화 및 화면 전환
 *
 * 흐름:
 *   시작 화면 (버튼만) → 게임 → 결과 화면 (여기서 DPI 선택 → 실시간 변환)
 */

(function () {
    // 현재 선택된 DPI
    let selectedDPI = 800;

    // 화면 전환
    function showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }

    // 게임 초기화
    Game.init();

    // === 시작 화면 ===
    document.getElementById('btn-start').addEventListener('click', () => {
        Calibration.init();

        updateHUD(1, 15, 1.0);
        showScreen('screen-game');

        // 배율 1.0으로 시작
        Game.start(1.0, onShot);
    });

    // === 게임 중 사격 콜백 ===
    function onShot(shotData) {
        const result = Calibration.processShotData(shotData);

        updateHUD(result.round, result.total, result.nextMultiplier);

        if (result.isComplete) {
            Game.stop();
            showResult();
        } else {
            Game.setSensitivity(result.nextMultiplier);
        }
    }

    function updateHUD(round, total, multiplier) {
        document.getElementById('hud-round').textContent = `라운드: ${round} / ${total}`;
        document.getElementById('hud-sens').textContent = `배율: ${multiplier}x`;
    }

    // === 결과 화면 ===
    function showResult() {
        showScreen('screen-result');
        // 기본 DPI 800으로 결과 표시
        selectedDPI = 800;
        updateResult();
    }

    function updateResult() {
        const data = Calibration.getResult(selectedDPI);
        Result.show(data);

        // DPI 버튼 active 상태 업데이트
        document.querySelectorAll('.dpi-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.dpi) === selectedDPI);
        });

        // 커스텀 입력 필드 동기화
        const customInput = document.getElementById('input-dpi-custom');
        const isPreset = [400, 800, 1200, 1600, 3200].includes(selectedDPI);
        if (!isPreset) {
            customInput.value = selectedDPI;
        } else {
            customInput.value = '';
        }
    }

    // DPI 프리셋 버튼 클릭
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
            // 프리셋 버튼 비활성화
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
})();
