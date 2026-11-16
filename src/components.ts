import { createComponent, defineComponents, Types } from '@iwsdk/core';

export const BallStates = { Idle: 'idle', Playing: 'playing', Apart: 'apart' } as const;

/** The single "whole piece" ball of the Whole state. */
export const MusicBall = createComponent('MusicBall', {
  /** idle: silent; playing: whole ball sounding; apart: split into sections. */
  state: { type: Types.Enum, default: BallStates.Idle, enum: BallStates },
  /** Diameter in metres. */
  diameter: { type: Types.Float32, default: 0.18 },
});

/** One orchestral section's ball in the Apart state. */
export const SectionBall = createComponent('SectionBall', {
  /** Index into mozart40.sections. */
  index: { type: Types.Int8, default: 0 },
});

// Project components are listed here so the IWSDK editor can author them.
export default defineComponents([MusicBall, SectionBall]);
