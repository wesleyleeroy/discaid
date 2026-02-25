/**
 * Compliant Ingestion Validator.
 * Validates uploaded files and URLs for compliance and safety.
 */

import {
    ALLOWED_AUDIO_TYPES,
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    MAX_FILE_SIZE_MB,
    MAX_QUEUE_SIZE,
} from '@/lib/utils/constants';

export interface ValidationResult {
    valid: boolean;
    error?: string;
    warnings: string[];
}

/**
 * Validate an uploaded audio file.
 */
export function validateAudioFile(file: File): ValidationResult {
    const warnings: string[] = [];

    // Check file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
        return {
            valid: false,
            error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB, got ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
            warnings,
        };
    }

    if (file.size === 0) {
        return {
            valid: false,
            error: 'File is empty.',
            warnings,
        };
    }

    // Check MIME type
    const isAllowedType = ALLOWED_AUDIO_TYPES.some(t => file.type === t);
    if (!isAllowedType && file.type) {
        return {
            valid: false,
            error: `Unsupported audio format: "${file.type}". Supported formats: MP3, M4A, WAV, OGG, WebM, FLAC, AAC.`,
            warnings,
        };
    }

    // Check extension
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    const isAllowedExt = ALLOWED_EXTENSIONS.some(e => e === extension);
    if (!isAllowedExt) {
        return {
            valid: false,
            error: `Unsupported file extension: "${extension}". Supported: ${ALLOWED_EXTENSIONS.join(', ')}.`,
            warnings,
        };
    }

    // Warn about large files
    if (file.size > 20 * 1024 * 1024) {
        warnings.push('Large file detected. Analysis may take longer.');
    }

    // Warn about lossy formats
    if (file.type === 'audio/mpeg' || file.type === 'audio/ogg') {
        warnings.push('Lossy format detected. Lossless formats (WAV, FLAC) produce better analysis results.');
    }

    return { valid: true, warnings };
}

/**
 * Validate a URL for compliant media sourcing.
 * We do NOT support direct downloading from YouTube or other streaming services.
 * Only direct audio file URLs are accepted.
 */
export function validateUrl(url: string): ValidationResult {
    const warnings: string[] = [];

    // Basic URL validation
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return {
            valid: false,
            error: 'Invalid URL format.',
            warnings,
        };
    }

    // Only allow HTTPS
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return {
            valid: false,
            error: 'Only HTTP/HTTPS URLs are supported.',
            warnings,
        };
    }

    // Block known streaming platforms (compliance requirement)
    const blockedDomains = [
        'youtube.com', 'youtu.be', 'spotify.com', 'soundcloud.com',
        'apple.com', 'deezer.com', 'tidal.com', 'pandora.com',
        'music.amazon.com',
    ];
    const hostname = parsed.hostname.toLowerCase().replace('www.', '');
    if (blockedDomains.some(d => hostname.includes(d))) {
        return {
            valid: false,
            error: `Streaming service links are not supported for compliance reasons. ` +
                `Please upload an audio file that you own or have permission to use. ` +
                `DiscAId does not rip or download copyrighted audio from streaming platforms.`,
            warnings,
        };
    }

    // Check if URL ends with audio extension
    const path = parsed.pathname.toLowerCase();
    const hasAudioExt = ALLOWED_EXTENSIONS.some(ext => path.endsWith(ext));
    if (!hasAudioExt) {
        warnings.push('URL does not appear to point to an audio file. Fetching will be attempted but may fail.');
    }

    return { valid: true, warnings };
}

/**
 * Check if the queue has capacity for more tracks.
 */
export function validateQueueCapacity(currentSize: number): ValidationResult {
    if (currentSize >= MAX_QUEUE_SIZE) {
        return {
            valid: false,
            error: `Queue is full (maximum ${MAX_QUEUE_SIZE} tracks). Please wait for tracks to finish playing.`,
            warnings: [],
        };
    }
    return { valid: true, warnings: [] };
}

/**
 * Sanitize a filename for display.
 */
export function sanitizeFilename(name: string): { title: string; artist: string } {
    // Remove extension
    const withoutExt = name.replace(/\.[^/.]+$/, '');

    // Try to parse "Artist - Title" format
    const dashSplit = withoutExt.split(' - ');
    if (dashSplit.length >= 2) {
        return {
            artist: dashSplit[0].trim(),
            title: dashSplit.slice(1).join(' - ').trim(),
        };
    }

    // Try underscore format
    const cleanName = withoutExt
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return { title: cleanName || 'Unknown Track', artist: 'Unknown Artist' };
}
