// 移植旧系统 scheduleEngine 口径：按北京时间（固定 UTC+8）墙上时间计算下一次触发。
import type { ScheduleSpec } from "@/contracts/schedule";

const TZ = "Asia/Shanghai";
const DAY_SCAN_LIMIT = 370;

const wallFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function wallParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = wallFormatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24, // en-CA 午夜可能输出 24
    minute: get("minute"),
  };
}

function utcWeekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

// 北京时间固定 +08:00 无夏令时，墙上时间直接减 8 小时换算回 UTC 瞬间
function fromWall(year: number, month: number, day: number, slot: string): Date {
  return new Date(Date.UTC(year, month - 1, day, Number(slot.slice(0, 2)), Number(slot.slice(3))) - 8 * 60 * 60 * 1000);
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const pad = (value: number) => String(value).padStart(2, "0");

export function nextOccurrence(spec: ScheduleSpec, from: Date): Date | null {
  if (spec.kind === "once") {
    const at = new Date(spec.at);
    return at.getTime() > from.getTime() ? at : null;
  }
  if (spec.kind === "interval") {
    return new Date(from.getTime() + spec.minutes * 60 * 1000);
  }
  const times = [...spec.times].sort();
  const wall = wallParts(from);
  let { year, month, day } = wall;
  for (let i = 0; i < DAY_SCAN_LIMIT; i += 1) {
    const dayFits =
      spec.kind === "daily" ||
      (spec.kind === "weekly" && spec.weekdays.includes(utcWeekdayOf(year, month, day))) ||
      (spec.kind === "monthly" && spec.days.includes(day));
    if (dayFits) {
      if (i === 0) {
        const current = `${pad(wall.hour)}:${pad(wall.minute)}`;
        const slot = times.find((time) => time > current);
        if (slot) return fromWall(year, month, day, slot);
      } else {
        return fromWall(year, month, day, times[0]);
      }
    }
    ({ year, month, day } = addDays(year, month, day, 1));
  }
  return null;
}
