/**
 * Ingestion Gate — File upload with rights confirmation.
 * Validates files, requires rights confirmation, and adds to queue.
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { useDJStore } from '@/stores/dj-store';
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_MB } from '@/lib/utils/constants';

export default function IngestionGate() {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const rightsConfirmed = useDJStore(s => s.rightsConfirmed);
    const setRightsConfirmed = useDJStore(s => s.setRightsConfirmed);
    const addTrack = useDJStore(s => s.addTrack);
    const analysisProgress = useDJStore(s => s.analysisProgress);

    const handleFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        if (!rightsConfirmed) {
            useDJStore.getState().addInsight('error', '❌ Please confirm you have rights to use this audio before uploading.');
            return;
        }

        setIsProcessing(true);
        for (let i = 0; i < files.length; i++) {
            await addTrack(files[i]);
        }
        setIsProcessing(false);

        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [rightsConfirmed, addTrack]);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    const onDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const onDragLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    return (
        <div className="glass-card-static p-6 space-y-4">
            <h2 className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                Add Track
            </h2>

            {/* Rights Confirmation */}
            <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5">
                    <input
                        type="checkbox"
                        checked={rightsConfirmed}
                        onChange={(e) => setRightsConfirmed(e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className={`
            w-5 h-5 rounded-md border-2 transition-all duration-200 flex items-center justify-center
            ${rightsConfirmed
                            ? 'border-[var(--accent-cyan)] bg-[rgba(0,212,255,0.15)]'
                            : 'border-[var(--border)] group-hover:border-[var(--border-active)]'
                        }
          `}>
                        {rightsConfirmed && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="var(--accent-cyan)" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                        )}
                    </div>
                </div>
                <span className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    I confirm I own or have permission to use the audio I&apos;m uploading.
                    DiscAId does not download, rip, or acquire copyrighted audio from streaming services.
                </span>
            </label>

            {/* Upload Zone */}
            <div
                className={`upload-zone p-8 text-center transition-all ${isDragging ? 'dragover' : ''} ${!rightsConfirmed ? 'opacity-40 pointer-events-none' : ''}`}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => rightsConfirmed && fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={ALLOWED_EXTENSIONS.join(',')}
                    multiple
                    onChange={(e) => handleFiles(e.target.files)}
                    className="hidden"
                />

                {isProcessing ? (
                    <div className="space-y-3">
                        <div className="animate-spin-slow inline-block text-3xl">💿</div>
                        <p className="text-sm font-medium" style={{ color: 'var(--accent-cyan)' }}>
                            {analysisProgress?.message || 'Processing...'}
                        </p>
                        {analysisProgress && (
                            <div className="w-48 mx-auto h-1 rounded-full overflow-hidden" style={{ background: 'rgba(100,100,180,0.2)' }}>
                                <div
                                    className="h-full rounded-full progress-animated transition-all duration-300"
                                    style={{ width: `${analysisProgress.progress * 100}%` }}
                                />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="text-3xl">
                            {isDragging ? '🎯' : '🎵'}
                        </div>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {isDragging ? 'Drop audio file here' : 'Click or drag audio files'}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            MP3, WAV, FLAC, M4A, OGG, AAC • Max {MAX_FILE_SIZE_MB}MB
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
