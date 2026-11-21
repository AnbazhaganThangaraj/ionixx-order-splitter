/** Abstraction over "now" so time-dependent logic can be tested deterministically. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
