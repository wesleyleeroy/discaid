/**
 * Audio Visualizer — Real-time frequency and waveform visualization.
 * Reads data from the master analyser node and renders bars.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { audioEngine } from '@/lib/audio/engine';
import { useDJStore } from '@/stores/dj-store';

export default function Visualizer() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const isPlaying = useDJStore(s => s.isPlaying);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const analyser = audioEngine.getMasterAnalyser();
        const { width, height } = canvas;

        // Clear
        ctx.clearRect(0, 0, width, height);

        if (!analyser || !isPlaying) {
            // Draw idle state — static low bars
            const barCount = 64;
            const barWidth = width / barCount - 1;
            ctx.fillStyle = 'rgba(100, 100, 180, 0.15)';
            for (let i = 0; i < barCount; i++) {
                const h = 3 + Math.sin(i * 0.3) * 2;
                ctx.fillRect(i * (barWidth + 1), height - h, barWidth, h);
            }
            animationRef.current = requestAnimationFrame(draw);
            return;
        }

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        const barCount = 64;
        const step = Math.floor(bufferLength / barCount);
        const barWidth = width / barCount - 1;

        for (let i = 0; i < barCount; i++) {
            // Average a few bins for each bar
            let sum = 0;
            for (let j = 0; j < step; j++) {
                sum += dataArray[i * step + j];
            }
            const value = sum / step / 255;
            const barHeight = Math.max(2, value * height * 0.9);

            // Color gradient based on frequency
            const hue = 190 + (i / barCount) * 80; // Cyan → Purple
            const saturation = 80 + value * 20;
            const lightness = 40 + value * 30;

            ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${0.6 + value * 0.4})`;

            // Draw bar with rounded top
            const x = i * (barWidth + 1);
            const y = height - barHeight;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
            ctx.fill();

            // Glow effect for loud bars
            if (value > 0.6) {
                ctx.shadowBlur = 8;
                ctx.shadowColor = `hsla(${hue}, 100%, 60%, 0.5)`;
                ctx.fillRect(x, y, barWidth, 2);
                ctx.shadowBlur = 0;
            }
        }

        animationRef.current = requestAnimationFrame(draw);
    }, [isPlaying]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Set canvas resolution
        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
            // Reset logical dimensions for drawing
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        };

        resize();
        window.addEventListener('resize', resize);

        animationRef.current = requestAnimationFrame(draw);

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animationRef.current);
        };
    }, [draw]);

    return (
        <div className="waveform-container">
            <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{ display: 'block' }}
            />
        </div>
    );
}
