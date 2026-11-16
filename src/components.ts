import { createComponent, defineComponents, Types } from '@iwsdk/core';

export const BallStates = { Idle: 'idle', Playing: 'playing' } as const;

/** The single "whole piece" ball of the Whole state. */
export const MusicBall = createComponent('MusicBall', {
  state: { type: Types.Enum, default: BallStates.Idle, enum: BallStates },
  /** Diameter in metres. */
  diameter: { type: Types.Float32, default: 0.18 },
});

// Project components are listed here so the IWSDK editor can author them.
export default defineComponents([MusicBall]);
