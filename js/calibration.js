/**
 * calibration.js - 캘리브레이션 알고리즘
 *
 * DPI 독립적 설계:
 *   - 게임 중에는 순수 "배율(multiplier)"로만 캘리브레이션
 *   - movementX/Y는 이미 OS에서 DPI 반영된 값
 *   - DPI 입력 없이 "이 사람에게 맞는 배율"을 찾음
 *   - 결과 화면에서 DPI 입력받아 오버워치 감도로 변환
 *
 * 종료 조건 (PID 수렴 방식):
 *   - 최소 MIN_ROUNDS 라운드 진행
 *   - 최근 STABLE_WINDOW회의 배율 변동폭이 STABLE_THRESHOLD 이하면 수렴
 *   - 최대 MAX_ROUNDS에 도달하면 강제 종료
 */

const Calibration = (() => {
    // 라운드 설정
    const MIN_ROUNDS = 10;       // 최소 진행 라운드
    const MAX_ROUNDS = 30;       // 최대 라운드 (무한루프 방지)
    const STABLE_WINDOW = 5;     // 수렴 판정에 사용할 최근 라운드 수
    const STABLE_THRESHOLD = 0.08; // 이 이하면 수렴 (배율 변동폭)

    // 배율 탐색 범위
    const MULT_MIN = 0.2;
    const MULT_MAX = 5.0;

    // 캘리브레이션 상태
    let currentRound = 0;
    let currentMultiplier = 1.0;
    let shotHistory = [];

    // 이진탐색 범위
    let multLow = MULT_MIN;
    let multHigh = MULT_MAX;

    function multiplierToOWSens(multiplier, dpi) {
        const baseSens = 5;
        const baseDPI = 800;
        const owSens = multiplier * baseSens * (baseDPI / dpi);
        return Math.round(owSens * 100) / 100;
    }

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
     * 수렴 판정
     * 최근 STABLE_WINDOW회의 배율이 모두 STABLE_THRESHOLD 범위 안에 있는지
     */
    function isConverged() {
        if (shotHistory.length < STABLE_WINDOW) return false;

        const recent = shotHistory.slice(-STABLE_WINDOW);
        const multipliers = recent.map(s => s.multiplier);
        const min = Math.min(...multipliers);
        const max = Math.max(...multipliers);

        return (max - min) <= STABLE_THRESHOLD;
    }

    /**
     * 사격 데이터 분석 및 배율 조절
     */
    function processShotData(shotData) {
        currentRound++;

        const analysis = analyzeShot(shotData);
        shotHistory.push({ ...shotData, analysis, multiplier: currentMultiplier });

        // 수렴 여부 판정
        const converged = currentRound >= MIN_ROUNDS && isConverged();
        const maxReached = currentRound >= MAX_ROUNDS;
        const isComplete = converged || maxReached;

        // 아직 안 끝났으면 배율 조절
        if (!isComplete) {
            adjustMultiplier(analysis);
        }

        return {
            nextMultiplier: currentMultiplier,
            round: currentRound,
            analysis,
            isComplete,
            converged // 수렴으로 끝났는지, 최대 라운드로 끝났는지 구분
        };
    }

    function analyzeShot(shotData) {
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

    function adjustMultiplier(analysis) {
        // adjustFactor: 라운드 진행에 따라 점진적으로 줄어듦
        // MAX_ROUNDS 기준으로 계산 (수렴이 안 돼도 후반엔 미세 조절)
        const progress = currentRound / MAX_ROUNDS;
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

        currentMultiplier = Math.round(currentMultiplier * 100) / 100;
        currentMultiplier = Math.max(MULT_MIN, Math.min(MULT_MAX, currentMultiplier));
    }

    function getResult(dpi) {
        const owSens = multiplierToOWSens(currentMultiplier, dpi);
        const edpi = Math.round(dpi * owSens);
        const cm360 = Math.round(calcCm360(owSens, dpi) * 10) / 10;

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
            totalRounds: shotHistory.length,
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
