/**
 * calibration.js - 캘리브레이션 알고리즘
 *
 * 감도 매칭 설계:
 *   - 시작 시 DPI + OW 현재감도를 입력받음
 *   - 웹 게임의 마우스 느낌 = 인게임과 동일 (배율 1.0)
 *   - 캘리브레이션은 배율(multiplier)을 이진탐색으로 조정
 *   - 최종 추천 감도 = 현재감도 × 최종배율
 *
 * 종료 조건 (PID 수렴 방식):
 *   - 최소 MIN_ROUNDS 라운드 진행
 *   - 최근 STABLE_WINDOW회의 배율 변동폭이 STABLE_THRESHOLD 이하면 수렴
 *   - 최대 MAX_ROUNDS에 도달하면 강제 종료
 */

const Calibration = (() => {
    // 라운드 설정
    const MIN_ROUNDS = 12;
    const MAX_ROUNDS = 30;
    const STABLE_WINDOW = 8;
    const STABLE_THRESHOLD = 0.05;

    // 배율 탐색 범위
    const MULT_MIN = 0.2;
    const MULT_MAX = 5.0;

    // 분석 임계값 (radian 기준)
    const OVERSHOOT_DIST = 0.08;
    const APPROACH_DIST = 0.05;
    const UNDERSHOOT_DIST = 0.03;

    // 사용자 입력값
    let userDPI = 1600;
    let userOWSens = 5;

    // 캘리브레이션 상태
    let currentRound = 0;
    let currentMultiplier = 1.0;
    let shotHistory = [];

    // 이진탐색 범위
    let multLow = MULT_MIN;
    let multHigh = MULT_MAX;

    function init(dpi, owSens) {
        userDPI = dpi || 1600;
        userOWSens = owSens || 5;
        currentRound = 0;
        shotHistory = [];
        currentMultiplier = 1.0;
        multLow = MULT_MIN;
        multHigh = MULT_MAX;
    }

    function calcCm360(owSens, dpi) {
        return (360 * 2.54) / (dpi * owSens * 0.0066);
    }

    function isConverged() {
        if (shotHistory.length < STABLE_WINDOW) return false;

        var recent = shotHistory.slice(-STABLE_WINDOW);
        var multipliers = recent.map(function (s) { return s.multiplier; });
        var min = Math.min.apply(null, multipliers);
        var max = Math.max.apply(null, multipliers);

        return (max - min) <= STABLE_THRESHOLD;
    }

    function processShotData(shotData) {
        currentRound++;

        var analysis = analyzeShot(shotData);
        shotHistory.push({
            hit: shotData.hit,
            headshot: shotData.headshot || false,
            timeout: shotData.timeout,
            angularDistance: shotData.angularDistance,
            reactionTime: shotData.reactionTime,
            trail: shotData.trail,
            sensitivity: shotData.sensitivity,
            analysis: analysis,
            multiplier: currentMultiplier,
            score: shotData.score || 0,
            totalScore: shotData.totalScore || 0
        });

        var converged = currentRound >= MIN_ROUNDS && isConverged();
        var maxReached = currentRound >= MAX_ROUNDS;
        var isComplete = converged || maxReached;

        if (!isComplete) {
            adjustMultiplier(analysis);
        }

        return {
            nextMultiplier: currentMultiplier,
            round: currentRound,
            analysis: analysis,
            isComplete: isComplete,
            converged: converged
        };
    }

    function analyzeShot(shotData) {
        if (shotData.timeout) {
            var trail = shotData.trail;
            var wasApproaching = false;
            if (trail.length >= 2) {
                var last = trail[trail.length - 1];
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

        var trail = shotData.trail;
        if (trail.length < 3) {
            return { type: 'neutral', overshoots: 0, corrections: 0, score: 0 };
        }

        var overshoots = 0;
        var corrections = 0;
        var closestDist = Infinity;
        var passedTarget = false;

        for (var i = 1; i < trail.length; i++) {
            var prevDist = trail[i - 1].angularDistance;
            var currDist = trail[i].angularDistance;

            closestDist = Math.min(closestDist, currDist);

            if (prevDist < currDist && prevDist < OVERSHOOT_DIST) {
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

        var score = 0;
        if (overshoots > 1) {
            score = Math.min(overshoots, 5);
        } else if (corrections === 0 && shotData.angularDistance > UNDERSHOOT_DIST) {
            score = -2;
        }

        var type = score > 0 ? 'overshoot' : score < 0 ? 'undershoot' : 'neutral';

        return { type: type, overshoots: overshoots, corrections: corrections, score: score, closestDist: closestDist, timeout: false };
    }

    function adjustMultiplier(analysis) {
        var progress = currentRound / MAX_ROUNDS;
        var adjustFactor = 1 - progress * 0.7;

        if (analysis.type === 'overshoot') {
            multHigh = currentMultiplier;
            var diff = (currentMultiplier - multLow) * 0.4 * adjustFactor;
            currentMultiplier = Math.max(multLow, currentMultiplier - diff);
        } else if (analysis.type === 'undershoot') {
            multLow = currentMultiplier;
            var diff = (multHigh - currentMultiplier) * 0.4 * adjustFactor;
            currentMultiplier = Math.min(multHigh, currentMultiplier + diff);
        }

        currentMultiplier = Math.round(currentMultiplier * 100) / 100;
        currentMultiplier = Math.max(MULT_MIN, Math.min(MULT_MAX, currentMultiplier));
    }

    /**
     * 결과 계산
     * 추천 감도 = 현재 OW감도 × 최종배율
     */
    function getResult() {
        var recommendedSens = Math.round(userOWSens * currentMultiplier * 100) / 100;
        var edpi = Math.round(userDPI * recommendedSens);
        var cm360 = Math.round(calcCm360(recommendedSens, userDPI) * 10) / 10;

        var hits = shotHistory.filter(function (s) { return s.hit; }).length;
        var headshots = shotHistory.filter(function (s) { return s.headshot; }).length;
        var timeouts = shotHistory.filter(function (s) { return s.timeout; }).length;
        var validShots = shotHistory.filter(function (s) { return !s.timeout; });
        var avgReaction = validShots.length > 0
            ? validShots.reduce(function (sum, s) { return sum + s.reactionTime; }, 0) / validShots.length
            : 0;
        var overshoots = shotHistory.filter(function (s) { return s.analysis.type === 'overshoot'; }).length;
        var undershoots = shotHistory.filter(function (s) { return s.analysis.type === 'undershoot'; }).length;
        var finalScore = shotHistory.length > 0 ? shotHistory[shotHistory.length - 1].totalScore : 0;

        var sensHistory = shotHistory.map(function (s, i) {
            return {
                round: i + 1,
                multiplier: s.multiplier,
                owSens: Math.round(userOWSens * s.multiplier * 100) / 100
            };
        });

        return {
            multiplier: currentMultiplier,
            recommendedSens: recommendedSens,
            originalSens: userOWSens,
            dpi: userDPI,
            edpi: edpi,
            cm360: cm360,
            totalRounds: shotHistory.length,
            stats: {
                totalShots: shotHistory.length,
                hits: hits,
                headshots: headshots,
                headshotRate: hits > 0 ? Math.round((headshots / hits) * 100) : 0,
                timeouts: timeouts,
                accuracy: Math.round((hits / shotHistory.length) * 100),
                avgReactionMs: Math.round(avgReaction),
                overshoots: overshoots,
                undershoots: undershoots,
                finalScore: finalScore
            },
            sensHistory: sensHistory
        };
    }

    return { init: init, processShotData: processShotData, getResult: getResult };
})();
