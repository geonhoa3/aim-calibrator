/**
 * calibration.js - 캘리브레이션 알고리즘
 *
 * DPI 독립적 설계:
 *   - 게임 중에는 순수 "배율(multiplier)"로만 캘리브레이션
 *   - movementX/Y는 이미 OS에서 DPI 반영된 값
 *   - DPI 입력 없이 "이 사람에게 맞는 배율"을 찾음
 *   - 결과 화면에서 DPI 입력받아 오버워치 감도로 변환
 */

const Calibration = (() => {
    const TOTAL_ROUNDS = 15;

    // 배율 탐색 범위
    const MULT_MIN = 0.2;
    const MULT_MAX = 5.0;

    // 캘리브레이션 상태
    let currentRound = 0;
    let currentMultiplier = 1.0; // 시작 배율
    let shotHistory = [];

    // 이진탐색 범위
    let multLow = MULT_MIN;
    let multHigh = MULT_MAX;

    /**
     * 배율 → 오버워치 감도 변환
     * 배율 1.0 = DPI 800 기준 감도 5 정도의 느낌
     * OW감도 = 배율 × 기준감도 × (기준DPI / 유저DPI)
     */
    function multiplierToOWSens(multiplier, dpi) {
        const baseSens = 5;
        const baseDPI = 800;
        const owSens = multiplier * baseSens * (baseDPI / dpi);
        return Math.round(owSens * 100) / 100;
    }

    /**
     * cm/360 계산
     * 오버워치: cm/360 = (360 × 2.54) / (DPI × 감도 × 0.0066)
     */
    function calcCm360(owSens, dpi) {
        return (360 * 2.54) / (dpi * owSens * 0.0066);
    }

    function init() {
        currentRound = 0;
        shotHistory = [];
        currentMultiplier = 1.0;
        multLow = MULT_MIN;
        multHigh = MULT_MAX;
    }

    /**
     * 사격 데이터 분석 및 배율 조절
     */
    function processShotData(shotData) {
        currentRound++;

        const analysis = analyzeShot(shotData);
        shotHistory.push({ ...shotData, analysis, multiplier: currentMultiplier });

        if (currentRound < TOTAL_ROUNDS) {
            adjustMultiplier(analysis);
        }

        return {
            nextMultiplier: currentMultiplier,
            round: currentRound,
            total: TOTAL_ROUNDS,
            analysis,
            isComplete: currentRound >= TOTAL_ROUNDS
        };
    }

    /**
     * 사격 패턴 분석 (FPS 카메라 방식)
     */
    function analyzeShot(shotData) {
        // 타임아웃 = 1초 안에 도달 못함 = 강한 언더슈팅
        if (shotData.timeout) {
            const trail = shotData.trail;
            let wasApproaching = false;
            if (trail.length >= 2) {
                const last = trail[trail.length - 1];
                const lastDist = Math.sqrt(last.screenDX ** 2 + last.screenDY ** 2);
                wasApproaching = lastDist > 50;
            }
            return {
                type: 'undershoot',
                overshoots: 0,
                corrections: 0,
                score: wasApproaching ? -3 : -2,
                closestDist: shotData.distance,
                timeout: true
            };
        }

        const trail = shotData.trail;
        if (trail.length < 3) {
            return { type: 'neutral', overshoots: 0, corrections: 0, score: 0 };
        }

        let overshoots = 0;
        let corrections = 0;
        let closestDist = Infinity;
        let passedTarget = false;

        for (let i = 1; i < trail.length; i++) {
            const prev = trail[i - 1];
            const curr = trail[i];

            const prevDist = Math.sqrt(prev.screenDX ** 2 + prev.screenDY ** 2);
            const currDist = Math.sqrt(curr.screenDX ** 2 + curr.screenDY ** 2);

            closestDist = Math.min(closestDist, currDist);

            if (prevDist < currDist && prevDist < 80) {
                if (!passedTarget) {
                    overshoots++;
                    passedTarget = true;
                }
            }

            if (prevDist > currDist && passedTarget) {
                corrections++;
                passedTarget = false;
            }
        }

        let score = 0;
        if (overshoots > 1) {
            score = Math.min(overshoots, 5);
        } else if (corrections === 0 && shotData.distance > 30) {
            score = -2;
        }

        const type = score > 0 ? 'overshoot' : score < 0 ? 'undershoot' : 'neutral';

        return { type, overshoots, corrections, score, closestDist, timeout: false };
    }

    /**
     * 배율 자동 조절 (수정된 이진탐색)
     */
    function adjustMultiplier(analysis) {
        const progress = currentRound / TOTAL_ROUNDS;
        const adjustFactor = 1 - progress * 0.7;

        if (analysis.type === 'overshoot') {
            multHigh = currentMultiplier;
            const diff = (currentMultiplier - multLow) * 0.4 * adjustFactor;
            currentMultiplier = Math.max(multLow, currentMultiplier - diff);
        } else if (analysis.type === 'undershoot') {
            multLow = currentMultiplier;
            const diff = (multHigh - currentMultiplier) * 0.4 * adjustFactor;
            currentMultiplier = Math.min(multHigh, currentMultiplier + diff);
        }

        // 소수점 2자리
        currentMultiplier = Math.round(currentMultiplier * 100) / 100;
        currentMultiplier = Math.max(MULT_MIN, Math.min(MULT_MAX, currentMultiplier));
    }

    /**
     * 최종 결과 생성 (DPI를 받아서 오버워치 감도로 변환)
     */
    function getResult(dpi) {
        const owSens = multiplierToOWSens(currentMultiplier, dpi);
        const edpi = Math.round(dpi * owSens);
        const cm360 = Math.round(calcCm360(owSens, dpi) * 10) / 10;

        // 사격 통계
        const hits = shotHistory.filter(s => s.hit).length;
        const timeouts = shotHistory.filter(s => s.timeout).length;
        const validShots = shotHistory.filter(s => !s.timeout);
        const avgReaction = validShots.length > 0
            ? validShots.reduce((sum, s) => sum + s.reactionTime, 0) / validShots.length
            : 0;
        const overshoots = shotHistory.filter(s => s.analysis.type === 'overshoot').length;
        const undershoots = shotHistory.filter(s => s.analysis.type === 'undershoot').length;

        const sensHistory = shotHistory.map((s, i) => ({
            round: i + 1,
            multiplier: s.multiplier
        }));

        return {
            multiplier: currentMultiplier,
            recommendedSens: owSens,
            dpi,
            edpi,
            cm360,
            stats: {
                totalShots: shotHistory.length,
                hits,
                timeouts,
                accuracy: Math.round((hits / shotHistory.length) * 100),
                avgReactionMs: Math.round(avgReaction),
                overshoots,
                undershoots
            },
            sensHistory
        };
    }

    return { init, processShotData, getResult };
})();
