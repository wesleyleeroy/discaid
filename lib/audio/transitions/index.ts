/**
 * Transition Strategy Registry.
 * Exports all available strategies for use by the planner.
 */

import { TransitionStrategy } from '@/types/transition';
import { crossfadeStrategy } from './crossfade';
import { filterSweepStrategy } from './filter-sweep';
import { echoOutStrategy } from './echo-out';
import { bassSwapStrategy } from './bass-swap';
import { energyRampStrategy } from './energy-ramp';
import { dropSyncStrategy } from './drop-sync';
import { vocalSustainStrategy } from './vocal-sustain';
import { bedSwapStrategy } from './bed-swap';
import { loopRollStrategy } from './loop-roll';
import { vinylBrakeStrategy } from './vinyl-brake';

/** All registered transition strategies */
export const strategies: TransitionStrategy[] = [
    crossfadeStrategy,
    filterSweepStrategy,
    echoOutStrategy,
    bassSwapStrategy,
    energyRampStrategy,
    dropSyncStrategy,
    vocalSustainStrategy,
    bedSwapStrategy,
    loopRollStrategy,
    vinylBrakeStrategy,
];

/** Get a strategy by type */
export function getStrategy(type: string): TransitionStrategy | undefined {
    return strategies.find(s => s.type === type);
}

export {
    crossfadeStrategy,
    filterSweepStrategy,
    echoOutStrategy,
    bassSwapStrategy,
    energyRampStrategy,
    dropSyncStrategy,
    vocalSustainStrategy,
    bedSwapStrategy,
    loopRollStrategy,
    vinylBrakeStrategy,
};
