// CellHub Intelligence — Date Helpers

export interface FiscalQuarter {
  year: number;
  quarter: number;
  start: Date;
  end: Date;
}

export function getWeekBoundaries(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const start = new Date(d);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function getMonthBoundaries(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function getYearBoundaries(year: number): { start: Date; end: Date } {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  return { start, end };
}

export function getFiscalQuarter(date: Date): FiscalQuarter {
  const month = date.getMonth();
  const quarter = Math.floor(month / 3);
  const fiscalYear = quarter === 0 ? date.getFullYear() - 1 : date.getFullYear();
  const quarterStart = new Date(fiscalYear, quarter * 3, 1);
  const quarterEnd = new Date(fiscalYear, quarter * 3 + 3, 0, 23, 59, 59, 999);
  return { year: fiscalYear, quarter: quarter + 1, start: quarterStart, end: quarterEnd };
}

export function getDaysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getDaysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getCurrentSeason(): 'back-to-school' | 'holiday' | 'tax-refund' | 'summer' | 'normal' {
  const month = new Date().getMonth();
  if (month >= 7 && month <= 9) return 'back-to-school';
  if (month >= 10 && month <= 11) return 'holiday';
  if (month >= 1 && month <= 2) return 'tax-refund';
  if (month >= 5 && month <= 6) return 'summer';
  return 'normal';
}

export function getSeasonLabel(season: ReturnType<typeof getCurrentSeason>, lang: string): string {
  const labels: Record<string, Record<string, string>> = {
    'back-to-school': { en: 'Back to School', es: 'Vuelta a Clases' },
    'holiday': { en: 'Holiday Season', es: 'Temporada de Festejos' },
    'tax-refund': { en: 'Tax Refund Season', es: 'Temporada de Reembolso' },
    'summer': { en: 'Summer', es: 'Verano' },
    'normal': { en: 'Normal Season', es: 'Temporada Normal' },
  };
  return labels[season]?.[lang] || labels.normal.en;
}

export function getSeasonalMultiplier(season: ReturnType<typeof getCurrentSeason>): Record<string, number> {
  const multipliers: Record<string, Record<string, number>> = {
    'back-to-school': { screen: 1.3, battery: 1.2, accessories: 1.4 },
    'holiday': { screen: 1.1, battery: 1.1, accessories: 1.5 },
    'tax-refund': { screen: 1.2, battery: 1.2, accessories: 1.3 },
    'summer': { screen: 1.4, waterDamage: 1.5, chargingPort: 1.2 },
    'normal': { screen: 1, battery: 1, accessories: 1 },
  };
  return multipliers[season] || multipliers.normal;
}

export function formatRelativeDays(date: Date, lang: string = 'en'): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return lang === 'es' ? 'Hoy' : 'Today';
  if (diffDays === 1) return lang === 'es' ? 'Ayer' : 'Yesterday';
  if (diffDays < 7) return lang === 'es' ? `${diffDays} días` : `${diffDays} days`;
  if (diffDays < 30) return lang === 'es' ? `${Math.floor(diffDays / 7)} sem` : `${Math.floor(diffDays / 7)} weeks`;
  if (diffDays < 365) return lang === 'es' ? `${Math.floor(diffDays / 30)} meses` : `${Math.floor(diffDays / 30)} months`;
  return lang === 'es' ? `${Math.floor(diffDays / 365)} años` : `${Math.floor(diffDays / 365)} years`;
}

export function isToday(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

export function isSameWeek(date: Date, compareDate: Date = new Date()): boolean {
  const d1 = getWeekBoundaries(date);
  const d2 = getWeekBoundaries(compareDate);
  return d1.start.getTime() === d2.start.getTime();
}

export function getHourOfDay(date: Date): number {
  return date.getHours();
}

export function getDayOfWeek(date: Date): number {
  return date.getDay();
}

export function getDayName(day: number, lang: string = 'en'): string {
  const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const daysEs = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return lang === 'es' ? daysEs[day] : daysEn[day];
}