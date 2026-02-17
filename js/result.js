/**
 * result.js - 결과 화면 렌더링 및 이미지 저장
 */

const Result = (() => {
    /**
     * 결과 화면 업데이트
     */
    function show(data) {
        // 수치 표시
        document.getElementById('result-sens').textContent = data.recommendedSens;
        document.getElementById('result-edpi').textContent = data.edpi;
        document.getElementById('result-cm360').textContent = data.cm360 + ' cm';

        // 오버워치 설정 가이드
        document.getElementById('guide-sens').textContent = data.recommendedSens;
        document.getElementById('guide-dpi').textContent = data.dpi;

        // 결과 카드 Canvas 그리기
        drawResultCard(data);
    }

    /**
     * 결과 카드 그리기 (이미지 저장/공유용)
     */
    function drawResultCard(data) {
        const canvas = document.getElementById('result-canvas');
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // 배경
        const bgGrad = ctx.createLinearGradient(0, 0, w, h);
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
        ctx.fillText('AIM CALIBRATOR', w / 2, 45);

        ctx.fillStyle = '#666';
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.fillText('오버워치 감도 캘리브레이션 결과', w / 2, 68);

        // 큰 감도 수치
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 64px Segoe UI, sans-serif';
        ctx.fillText(data.recommendedSens, w / 2, 140);

        ctx.fillStyle = '#888';
        ctx.font = '16px Segoe UI, sans-serif';
        ctx.fillText('추천 감도', w / 2, 165);

        // 구분선
        ctx.strokeStyle = '#2a2f3d';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, 185);
        ctx.lineTo(w - 40, 185);
        ctx.stroke();

        // 상세 정보
        const infoY = 220;
        const cols = [
            { label: 'DPI', value: data.dpi },
            { label: 'eDPI', value: data.edpi },
            { label: 'cm/360', value: data.cm360 + 'cm' }
        ];

        cols.forEach((col, i) => {
            const x = 100 + i * 160;
            ctx.fillStyle = '#f79e02';
            ctx.font = 'bold 24px Segoe UI, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(col.value, x, infoY);

            ctx.fillStyle = '#666';
            ctx.font = '13px Segoe UI, sans-serif';
            ctx.fillText(col.label, x, infoY + 22);
        });

        // 감도 변화 그래프
        drawSensGraph(ctx, data.sensHistory, 40, 270, w - 80, 90);

        // 통계
        const statsY = 380;
        ctx.fillStyle = '#555';
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        const timeoutText = data.stats.timeouts > 0 ? ` | 타임아웃 ${data.stats.timeouts}회` : '';
        ctx.fillText(
            `정확도 ${data.stats.accuracy}% | 반응속도 ${data.stats.avgReactionMs}ms | 오버슈팅 ${data.stats.overshoots}회 | 언더슈팅 ${data.stats.undershoots}회${timeoutText}`,
            w / 2, statsY
        );
    }

    /**
     * 감도 변화 그래프
     */
    function drawSensGraph(ctx, history, x, y, w, h) {
        if (!history || history.length < 2) return;

        // 배경
        ctx.fillStyle = 'rgba(20, 24, 48, 0.5)';
        ctx.fillRect(x, y, w, h);

        // 라벨
        ctx.fillStyle = '#555';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('배율 변화', x + 4, y - 4);

        const vals = history.map(h => h.multiplier);
        const minV = Math.min(...vals) - 0.2;
        const maxV = Math.max(...vals) + 0.2;
        const range = maxV - minV || 1;

        // 선 그리기
        ctx.beginPath();
        ctx.strokeStyle = '#f79e02';
        ctx.lineWidth = 2;

        history.forEach((point, i) => {
            const px = x + (i / (history.length - 1)) * w;
            const py = y + h - ((point.multiplier - minV) / range) * h;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.stroke();

        // 포인트
        history.forEach((point, i) => {
            const px = x + (i / (history.length - 1)) * w;
            const py = y + h - ((point.multiplier - minV) / range) * h;

            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#f79e02';
            ctx.fill();
        });

        // 최종값 표시
        const last = history[history.length - 1];
        const lastX = x + w;
        const lastY = y + h - ((last.multiplier - minV) / range) * h;
        ctx.fillStyle = '#f79e02';
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(last.multiplier + 'x', lastX - 4, lastY - 8);
    }

    /**
     * 결과 이미지 저장
     */
    function saveImage() {
        const canvas = document.getElementById('result-canvas');
        const link = document.createElement('a');
        link.download = 'aim-calibrator-result.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    return { show, saveImage };
})();
