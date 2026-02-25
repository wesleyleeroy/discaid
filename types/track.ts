/**
 * Core track data model.
 * Represents a single audio track through its lifecycle:
 * pending → analyzing → ready → playing → transitioning → completed
 */

export type TrackStatus =
  | 'pending'        // Uploaded, awaiting analysis
  | 'analyzing'      // Analysis in progress
  | 'ready'          // Analyzed, queued for playback
  | 'loading'        // Loading audio buffer
  | 'playing'        // Currently playing
  | 'transitioning'  // In the middle of a transition
  | 'completed'      // Finished playing
  | 'error';         // Failed analysis or playback

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;          // seconds
  fileName: string;
  fileSize: number;          // bytes
  fileType: string;          // MIME type
  objectUrl: string;         // Blob URL for playback
  audioBuffer: AudioBuffer | null;
  analysis: TrackAnalysis | null;
  status: TrackStatus;
  addedAt: number;           // timestamp ms
  errorMessage?: string;
}

/** Musical key representation */
export interface MusicalKey {
  root: string;              // C, C#, D, etc.
  mode: 'major' | 'minor';
  camelotCode: string;       // e.g., "8B", "5A"
}

/** Section within a track (intro, verse, chorus, etc.) */
export interface TrackSection {
  type: 'intro' | 'verse' | 'chorus' | 'bridge' | 'breakdown' | 'buildup' | 'outro' | 'unknown';
  startTime: number;        // seconds
  endTime: number;          // seconds
  energy: number;           // 0-1 average energy in this section
}

/** Vocal activity region */
export interface VocalActivity {
  startTime: number;
  endTime: number;
  confidence: number;       // 0-1
}

/** Complete analysis results for a track */
export interface TrackAnalysis {
  bpm: number;
  bpmConfidence: number;     // 0-1
  key: MusicalKey;
  keyConfidence: number;     // 0-1
  energy: number;            // 0-1 overall track energy
  loudnessDb: number;        // estimated LUFS
  peakDb: number;            // peak level in dB
  durationSeconds: number;
  beatGrid: number[];        // beat timestamps in seconds
  downbeats: number[];       // downbeat timestamps (bar starts)
  sections: TrackSection[];
  introEnd: number;          // seconds - where intro ends
  outroStart: number;        // seconds - where outro begins
  vocalRegions: VocalActivity[];
  analyzedAt: number;        // timestamp ms
}
