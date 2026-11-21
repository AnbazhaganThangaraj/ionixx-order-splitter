import { WeekdayMarketScheduler } from '../../../src/services/market-scheduler.service';

const nyse = new WeekdayMarketScheduler({
  timeZone: 'America/New_York',
  openTime: '09:30',
  closeTime: '16:00',
});

/** Requests are given in UTC; New York is UTC-5 in winter (EST) and UTC-4 in summer (EDT). */
const at = (isoUtc: string) => nyse.nextExecution(new Date(isoUtc));

describe('WeekdayMarketScheduler (America/New_York, 09:30-16:00)', () => {
  describe('during a weekday', () => {
    it('before open -> same day at open', () => {
      // Mon 2026-11-23 08:00 EST
      expect(at('2026-11-23T13:00:00Z')).toEqual({
        executeAt: '2026-11-23T09:30:00.000-05:00',
        timeZone: 'America/New_York',
        reason: 'BEFORE_MARKET_OPEN',
      });
    });

    it('exactly at open -> immediately', () => {
      expect(at('2026-11-23T14:30:00Z')).toMatchObject({
        executeAt: '2026-11-23T09:30:00.000-05:00',
        reason: 'MARKET_OPEN',
      });
    });

    it('during market hours -> immediately (at the request time)', () => {
      expect(at('2026-11-23T17:15:42.123Z')).toMatchObject({
        executeAt: '2026-11-23T12:15:42.123-05:00',
        reason: 'MARKET_OPEN',
      });
    });

    it('one minute before close -> immediately', () => {
      expect(at('2026-11-23T20:59:00Z').reason).toBe('MARKET_OPEN');
    });

    it('exactly at close -> next weekday at open (close is exclusive)', () => {
      expect(at('2026-11-23T21:00:00Z')).toMatchObject({
        executeAt: '2026-11-24T09:30:00.000-05:00',
        reason: 'AFTER_MARKET_CLOSE',
      });
    });

    it.each([
      ['Mon', '2026-11-23T22:00:00Z', '2026-11-24T09:30:00.000-05:00'],
      ['Tue', '2026-11-24T22:00:00Z', '2026-11-25T09:30:00.000-05:00'],
      ['Wed', '2026-11-25T22:00:00Z', '2026-11-26T09:30:00.000-05:00'],
      ['Thu', '2026-11-26T22:00:00Z', '2026-11-27T09:30:00.000-05:00'],
      ['Fri', '2026-11-27T22:00:00Z', '2026-11-30T09:30:00.000-05:00'],
    ])('%s after close -> next weekday at open', (_day, requestedAt, expected) => {
      expect(at(requestedAt)).toMatchObject({ executeAt: expected, reason: 'AFTER_MARKET_CLOSE' });
    });
  });

  describe('weekends', () => {
    it.each([
      ['Saturday morning', '2026-11-28T15:00:00Z'],
      ['Saturday night', '2026-11-29T04:00:00Z'],
      ['Sunday', '2026-11-29T18:00:00Z'],
      ['Sunday 23:59 New York', '2026-11-30T04:59:00Z'],
    ])('%s -> Monday at open', (_label, requestedAt) => {
      expect(at(requestedAt)).toMatchObject({
        executeAt: '2026-11-30T09:30:00.000-05:00',
        reason: 'WEEKEND',
      });
    });
  });

  describe('time-zone boundaries (decisions use New York time, not UTC or the server zone)', () => {
    it('Saturday in UTC but still Friday evening in New York -> after close, Monday open', () => {
      // Sat 2026-11-28 03:00 UTC == Fri 2026-11-27 22:00 EST
      expect(at('2026-11-28T03:00:00Z')).toMatchObject({
        executeAt: '2026-11-30T09:30:00.000-05:00',
        reason: 'AFTER_MARKET_CLOSE',
      });
    });

    it('Monday in UTC but still Sunday in New York -> weekend, Monday open', () => {
      // Mon 2026-11-23 02:00 UTC == Sun 2026-11-22 21:00 EST
      expect(at('2026-11-23T02:00:00Z')).toMatchObject({
        executeAt: '2026-11-23T09:30:00.000-05:00',
        reason: 'WEEKEND',
      });
    });

    it('evening in India is before the New York open', () => {
      // Mon 2026-11-23 19:30 IST == 14:00 UTC == 09:00 EST
      expect(at('2026-11-23T19:30:00+05:30')).toMatchObject({
        executeAt: '2026-11-23T09:30:00.000-05:00',
        reason: 'BEFORE_MARKET_OPEN',
      });
    });
  });

  describe('daylight saving', () => {
    it('Friday before DST starts -> Monday open uses the new offset (EDT, -04:00)', () => {
      // DST starts Sun 2027-03-14
      expect(at('2027-03-12T22:00:00Z').executeAt).toBe('2027-03-15T09:30:00.000-04:00');
    });

    it('Friday before DST ends -> Monday open uses the new offset (EST, -05:00)', () => {
      // DST ends Sun 2026-11-01
      expect(at('2026-10-30T21:30:00Z').executeAt).toBe('2026-11-02T09:30:00.000-05:00');
    });

    it('uses the summer offset for the market-hours check', () => {
      // Mon 2027-06-14 13:45 UTC == 09:45 EDT (open). In winter this instant would be 08:45, pre-open.
      expect(at('2027-06-14T13:45:00Z').reason).toBe('MARKET_OPEN');
    });
  });

  it('works for other configured markets', () => {
    const london = new WeekdayMarketScheduler({
      timeZone: 'Europe/London',
      openTime: '08:00',
      closeTime: '16:30',
    });
    // Fri 2026-11-27 17:00 GMT -> Mon 08:00 GMT
    expect(london.nextExecution(new Date('2026-11-27T17:00:00Z'))).toEqual({
      executeAt: '2026-11-30T08:00:00.000+00:00',
      timeZone: 'Europe/London',
      reason: 'AFTER_MARKET_CLOSE',
    });
  });

  it('rejects a malformed market time', () => {
    expect(
      () => new WeekdayMarketScheduler({ timeZone: 'UTC', openTime: 'nine', closeTime: '16:00' }),
    ).toThrow(/Invalid market time/);
  });
});
