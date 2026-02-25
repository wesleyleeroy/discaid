# DiscAId — Autonomous AI DJ System Architecture

## Overview

DiscAId is an autonomous AI DJ that handles all mixing decisions automatically.
The user only provides tracks (via upload); the system handles analysis, queue
management, transition planning, and seamless playback execution.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       BROWSER CLIENT                         │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌───────────────────────┐   │
│  │ Ingestion│──▸│ Analysis │──▸│   Orchestrator        │   │
│  │ Gate     │   │ Pipeline │   │   State Machine       │   │
│  │          │   │          │   │                       │   │
│  │ • Rights │   │ • BPM    │   │ IDLE → LOADING →     │   │
│  │ • Validate│  │ • Key    │   │ PLAYING → PLANNING → │   │
│  │ • Sanitize│  │ • Energy │   │ TRANSITIONING →      │   │
│  └──────────┘   │ • Beats  │   │ PLAYING (loop)       │   │
│                 │ • Sections│   └───────┬───────────────┘   │
│                 └──────────┘           │                    │
│                                        ▼                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Transition Planner                      │   │
│  │  Score strategies → Pick best → Compute envelopes   │   │
│  │                                                      │   │
│  │  Strategies: Crossfade | FilterSweep | EchoOut |    │   │
│  │              BassSwap | EnergyRamp                   │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        ▼                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Web Audio Mixer                         │   │
│  │                                                      │   │
│  │  Deck A ──┬──▸ Gain ──▸ EQ3 ──▸ Filter ──┐         │   │
│  │           │                               ├──▸ Master│   │
│  │  Deck B ──┴──▸ Gain ──▸ EQ3 ──▸ Filter ──┘   │     │   │
│  │                                           Compressor │   │
│  │  FX Bus: Reverb Send | Delay Send         Limiter    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Zustand Store                           │   │
│  │  currentTrack | queue | orchestratorState |          │   │
│  │  analysisCache | transitionPlan | aiInsights         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              React UI (Read-Only Dashboard)          │   │
│  │  NowPlaying | Queue | TransitionStatus |             │   │
│  │  AIInsights | Visualizer | IngestionGate             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Milestones

### M1: Project Scaffolding + Type System
- Types, interfaces, constants, Camelot wheel utility
- Acceptance: All types compile, project builds

### M2: Compliant Ingestion + Rights Gate
- File upload validation, rights checkbox, sanitization
- Acceptance: Only valid audio files accepted, rights confirmed

### M3: Client-Side Audio Analysis
- BPM (autocorrelation), Key (chroma), Energy (RMS), Beat grid
- Acceptance: Analysis returns plausible values for test tracks

### M4: Autonomous Queue + Orchestrator State Machine
- Zustand store, state machine, queue management
- Acceptance: Tracks flow through states automatically

### M5: Transition Planner + Strategy Scoring
- Score all strategies, pick best, compute envelopes
- Acceptance: Planner selects appropriate strategy per track pair

### M6: Web Audio Mixer + FX Automation
- Dual-deck mixer, EQ, filters, reverb, delay, limiter
- Acceptance: Smooth transitions audible in browser

### M7: End-to-End Autonomous Playback
- Wire everything together, continuous playback
- Acceptance: Upload 3+ tracks, hear seamless transitions

### M8: Hardening + Fallback Logic
- Error handling, safe crossfade fallback, logging
- Acceptance: System never stops playing, degrades gracefully
