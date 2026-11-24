import { DateTime } from 'luxon';
import type { ExecutionReason } from '../domain/order.enums';
import type { OrderExecution } from '../domain/order.types';
import { parseTimeOfDay, type TimeOfDay } from '../lib/time-of-day';

const MarketSchedulerTime = {
  /** Luxon returns null only for invalid DateTimes, which cannot occur here: fail loudly if it does. */
  toIso: (value: DateTime): string => {
    const iso = value.toISO();
    if (iso === null)
      throw new Error(`Invalid execution time: ${value.invalidReason ?? 'unknown'}`);
    return iso;
  },
};

export interface MarketHours {
  /** IANA time zone of the exchange, e.g. "America/New_York". */
  readonly timeZone: string;
  /** Session open, "HH:mm" in the exchange time zone. */
  readonly openTime: string;
  /** Session close, "HH:mm" in the exchange time zone (exclusive). */
  readonly closeTime: string;
}

/**
 * Decides when an order should be executed. Kept behind an interface so a real
 * exchange calendar (holidays, half days) can replace the POC implementation
 * without touching the order service.
 */
export interface MarketScheduler {
  nextExecution(requestedAt: Date): OrderExecution;
}

const SATURDAY = 6;

/**
 * POC rule — markets are open Monday to Friday between openTime and closeTime
 * in the exchange time zone. Public holidays are NOT considered.
 *
 *  - weekday, before open   -> today at open           (BEFORE_MARKET_OPEN)
 *  - weekday, during hours  -> immediately             (MARKET_OPEN)
 *  - weekday, at/after close -> next weekday at open   (AFTER_MARKET_CLOSE)
 *  - Saturday / Sunday      -> Monday at open          (WEEKEND)
 *
 * All comparisons happen in the exchange time zone (Luxon), so the result is
 * correct whatever the server's or the partner's own time zone is, and across
 * daylight-saving changes.
 */
export class WeekdayMarketScheduler implements MarketScheduler {
  private readonly open: { hour: number; minute: number };
  private readonly close: { hour: number; minute: number };

  constructor(private readonly hours: MarketHours) {
    this.open = WeekdayMarketScheduler.parseTime(hours.openTime);
    this.close = WeekdayMarketScheduler.parseTime(hours.closeTime);
  }

  nextExecution(requestedAt: Date): OrderExecution {
    const now = DateTime.fromJSDate(requestedAt, { zone: this.hours.timeZone });

    if (!WeekdayMarketScheduler.isWeekday(now)) {
      return this.plan(this.nextWeekdayOpen(now), 'WEEKEND');
    }

    const todayOpen = this.atTime(now, this.open);
    const todayClose = this.atTime(now, this.close);

    if (now < todayOpen) return this.plan(todayOpen, 'BEFORE_MARKET_OPEN');
    if (now < todayClose) return this.plan(now, 'MARKET_OPEN');
    return this.plan(this.nextWeekdayOpen(now), 'AFTER_MARKET_CLOSE');
  }

  private nextWeekdayOpen(from: DateTime): DateTime {
    let day = from.startOf('day').plus({ days: 1 });
    while (!WeekdayMarketScheduler.isWeekday(day)) {
      day = day.plus({ days: 1 });
    }
    return this.atTime(day, this.open);
  }

  private atTime(day: DateTime, time: { hour: number; minute: number }): DateTime {
    return day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  }

  private plan(executeAt: DateTime, reason: ExecutionReason): OrderExecution {
    return {
      executeAt: MarketSchedulerTime.toIso(executeAt),
      timeZone: this.hours.timeZone,
      reason,
    };
  }

  private static isWeekday(date: DateTime): boolean {
    return date.weekday < SATURDAY;
  }

  private static parseTime(time: string): TimeOfDay {
    const parsed = parseTimeOfDay(time);
    if (parsed === undefined) {
      throw new Error(`Invalid market time "${time}", expected HH:mm (00:00-23:59)`);
    }
    return parsed;
  }
}
