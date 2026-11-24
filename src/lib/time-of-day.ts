export interface TimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses a 24-hour "HH:mm" string (00:00 to 23:59); undefined if it is not valid. */
export const parseTimeOfDay = (text: string): TimeOfDay | undefined => {
  const match = HH_MM.exec(text);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

export const minutesSinceMidnight = ({ hour, minute }: TimeOfDay): number => hour * 60 + minute;
