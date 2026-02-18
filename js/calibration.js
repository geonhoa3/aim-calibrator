/**
 * calibration.js - 캘리브레이션 알고리즘
 *
 * DPI 독립적 설계:
 *   - 게임 중에는 순수 "배율(multiplier)"로만 캘리브레이션
 *   - 결과 화면에서 DPI 입력받아 오버워치 감도로 변환
 *
 * 종료 조건 (PID 수렴 방식):
 *   - 최소 MIN_ROUNDS 라운드 진행
 *   - 최근 STABLE_WINDOW회의 배율 변동폭이 STABLE_THRESHOLD 이하면 수렴
 *   - 최대 MAX_ROUNDS에 도달하면 강제 종료
 *
 * 3D 호환:
 *   - trail 데이터는 angularDistance (radian) 사용
 *   - 임계값도 radian 기준
 */

const Calibration = (() => {
    // 라운드 설정 (강화된 수렴 기준)
    const MIN_ROUNDS = 12;
    const MAX_ROUNDS = 30;
    const STABLE_WINDOW = 8;
    const STABLE_THRESHOLD = 0.05;

    // 배율 탐색 범위
    const MULT_MIN = 0.2;
    const MULT_MAX = 5.0;

    // 분석 임계값 (radian 기준)
    const OVERSHOOT_DIST = 0.08;    // ~4.6도, 오버슈팅 감지
    const APPROACH_DIST = 0.05;     // ~2.9도, 타임아웃 시 접근 판정
    const UNDERSHOOT_DIST = 0.03;   // ~1.7도, 언더슈팅 거리

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

    function isConverged() {
        if (shotHistory.length < STABLE_WINDOW) return false;

        const recent = shotHistory.slice(-STABLE_WINDOW);
        const multipliers = recent.map(s => s.multiplier);
        const min = Math.min(...multipliers);
        const max = Math.max(...multipliers);

        return (max - min) <= STABLE_THRESHOLD;
    }

    function processShotData(shotData) {
        currentRound++;

        const analysis = analyzeShot(shotData);
        shotHistory.push({ ...shotData, analysis, multiplier: currentMultiplier });

        const converged = currentRound >= MIN_ROUNDS && isConverged();
        const maxReached = currentRound >= MAX_ROUNDS;
        const isComplete = converged || maxReached;

        if (!isComplete) {
            adjustMultiplier(analysis);
        }

        return {
            nextMultiplier: currentMultiplier,
            round: currentRound,
            analysis,
            isComplete,
            converged
        };
    }

    /**
     * 사격 패턴 분석 (3D angularDistance 기반)
     *
     * trail[].angularDistance = 카메라 정면 ↔ 타겟 방향 각도 (radian)
     * 0에 가까울수록 정조준
     */
    function analyzeShot(shotData) {
        // 타임아웃 처리
        if (shotData.timeout) {
            const trail = shotData.trail;
            let wasApproaching = false;
            if (trail.length >= 2) {
                const last = trail[trail.length - 1];
                wasApproaching = last.angularDistance > APPROACH_DIST;
            }
            return {
                type: 'undershoot',
                overshoots: 0,
                corrections: 0,
                score: wasApproaching ? -3 : -2,
                closestDist: shotData.angularDistance || 999,
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
            const prevDist = trail[i - 1].angularDistance;
            const currDist = trail[i].angularDistance;

            closestDist = Math.min(closestDist, currDist);

            // 가까워지다가 멀어짐 = 오버슈팅
            if (prevDist < currDist && prevDist < OVERSHOOT_DIST) {
                if (!passedTarget) {
                    overshoots++;
                    passedTarget = true;
                }
            }

            // 다시 가까워짐 = 교정
            if (prevDist > currDist && passedTarget) {
                corrections++;
                passedTarget = false;
            }
        }

        let score = 0;
        if (overshoots > 1) {
            score = Math.min(overshoots, 5);
        } else if (corrections === 0 && shotData.angularDistance > UNDERSHOOT_DIST) {
            score = -2;
        }

        const type = score > 0 ? 'overshoot' : score < 0 ? 'undershoot' : 'neutral';

        return { type, overshoots, corrections, score, closestDist, timeout: false };
    }

    function adjustMultiplier(analysis) {
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
