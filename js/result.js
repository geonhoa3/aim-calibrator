/**
 * result.js - 결과 화면 렌더링 및 이미지 저장
 */

const Result = (() => {

    function show(data) {
        // 수치 표시
        document.getElementById('result-sens').textContent = data.recommendedSens;
        document.getElementById('result-edpi').textContent = data.edpi;
        document.getElementById('result-cm360').textContent = data.cm360 + ' cm';

        // 점수 & 헤드샷 표시
        var scoreEl = document.getElementById('result-score');
        if (scoreEl) scoreEl.textContent = data.stats.finalScore;
        var hsEl = document.getElementById('result-headshot');
        if (hsEl) hsEl.textContent = data.stats.headshotRate + '% (' + data.stats.headshots + '/' + data.stats.hits + ')';

        // 오버워치 설정 가이드
        document.getElementById('guide-sens').textContent = data.recommendedSens;
        document.getElementById('guide-dpi').textContent = data.dpi;

        // 결과 카드 Canvas 그리기
        drawResultCard(data);
    }

    function drawResultCard(data) {
        var canvas = document.getElementById('result-canvas');
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;

        // 배경
        var bgGrad = ctx.createLinearGradient(0, 0, w, h);
        bgGrad.addColorStop(0, '#0a0e17');
        bgGrad.addColorStop(1, '#141830');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // 테두리
        ctx.strokeStyle = '#2a2f3d';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, w - 2, h - 2);

        // 타이틀
        ctx.fillStyle = '#f79e02';
        ctx.font = 'bold 28px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('AIM CALIBRATOR', w / 2, 40);

        ctx.fillStyle = '#666';
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.fillText('오버워치 감도 캘리브레이션 결과', w / 2, 62);

        // 원래 감도 → 추천 감도
        ctx.fillStyle = '#666';
        ctx.font = '16px Segoe UI, sans-serif';
        ctx.fillText(data.originalSens + '  →', w / 2 - 60, 100);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 48px Segoe UI, sans-serif';
        ctx.fillText(data.recommendedSens, w / 2 + 40, 105);

        ctx.fillStyle = '#888';
        ctx.font = '13px Segoe UI, sans-serif';
        ctx.fillText('기존 감도          추천 감도', w / 2, 125);

        // 구분선
        ctx.strokeStyle = '#2a2f3d';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, 140);
        ctx.lineTo(w - 40, 140);
        ctx.stroke();

        // 상세 정보 (5열)
        var infoY = 172;
        var cols = [
            { label: 'DPI', value: data.dpi },
            { label: 'eDPI', value: data.edpi },
            { label: 'cm/360', value: data.cm360 + 'cm' },
            { label: '배율', value: data.multiplier + 'x' },
            { label: '점수', value: data.stats.finalScore }
        ];

        var colWidth = (w - 80) / cols.length;
        for (var i = 0; i < cols.length; i++) {
            var x = 40 + colWidth / 2 + i * colWidth;
            ctx.fillStyle = '#f79e02';
            ctx.font = 'bold 20px Segoe UI, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(cols[i].value, x, infoY);

            ctx.fillStyle = '#666';
            ctx.font = '12px Segoe UI, sans-serif';
            ctx.fillText(cols[i].label, x, infoY + 18);
        }

        // 감도 변화 그래프 (OW 감도 단위)
        drawSensGraph(ctx, data.sensHistory, 40, 220, w - 80, 100);

        // 통계
        var statsY = 340;
        ctx.fillStyle = '#555';
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
            '정확도 ' + data.stats.accuracy + '% | 반응속도 ' + data.stats.avgReactionMs + 'ms | ' +
            '헤드샷 ' + data.stats.headshotRate + '% | ' +
            '오버슈팅 ' + data.stats.overshoots + '회 | 언더슈팅 ' + data.stats.undershoots + '회',
            w / 2, statsY
        );

        // 하단 워터마크
        ctx.fillStyle = '#333';
        ctx.font = '10px Segoe UI, sans-serif';
        ctx.fillText('aim-calibrator.vercel.app', w / 2, h - 10);
    }

    function drawSensGraph(ctx, history, x, y, w, h) {
        if (!history || history.length < 2) return;

        // 배경
        ctx.fillStyle = 'rgba(20, 24, 48, 0.5)';
        ctx.fillRect(x, y, w, h);

        // 라벨
        ctx.fillStyle = '#555';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('감도 변화 (OW 감도)', x + 4, y - 4);

        // OW 감도 기준 그래프
        var vals = [];
        for (var k = 0; k < history.length; k++) {
            vals.push(history[k].owSens);
        }
        var minV = Math.min.apply(null, vals) - 0.5;
        var maxV = Math.max.apply(null, vals) + 0.5;
        var range = maxV - minV || 1;

        // 선 그리기
        ctx.beginPath();
        ctx.strokeStyle = '#f79e02';
        ctx.lineWidth = 2;

        for (var i = 0; i < history.length; i++) {
            var px = x + (i / (history.length - 1)) * w;
            var py = y + h - ((history[i].owSens - minV) / range) * h;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // 포인트
        for (var j = 0; j < history.length; j++) {
            var px2 = x + (j / (history.length - 1)) * w;
            var py2 = y + h - ((history[j].owSens - minV) / range) * h;

            ctx.beginPath();
            ctx.arc(px2, py2, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#f79e02';
            ctx.fill();
        }

        // 최종값 표시
        var last = history[history.length - 1];
        var lastX = x + w;
        var lastY = y + h - ((last.owSens - minV) / range) * h;
        ctx.fillStyle = '#f79e02';
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(last.owSens, lastX - 4, lastY - 8);
    }

    function saveImage() {
        var canvas = document.getElementById('result-canvas');
        var link = document.createElement('a');
        link.download = 'aim-calibrator-result.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    return { show: show, saveImage: saveImage };
})();
