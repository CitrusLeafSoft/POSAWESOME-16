/**
 * Number, currency and date formatting.
 *
 * Frappe lets each site pick a number format ("#,###.##", "#.###,##", "# ###.##",
 * …) and a currency symbol per currency. Both are handed to us in the bootstrap
 * payload, so formatting here matches what the printed invoice will say.
 */

import { RIYAL_CHAR } from "@/lib/riyal-path";

interface NumberFormatSpec {
	group: string;
	decimal: string;
	precision: number;
	/** Indian grouping: 12,34,567.89 */
	lakh: boolean;
}

const FORMAT_CACHE = new Map<string, NumberFormatSpec>();

export function parseNumberFormat(format = "#,###.##"): NumberFormatSpec {
	const cached = FORMAT_CACHE.get(format);
	if (cached) return cached;

	// The last non-# separator is the decimal mark; the other is the grouping mark.
	const separators = format.replace(/#/g, "");
	const decimal = separators.slice(-1) || ".";
	const group = separators.slice(0, -1).slice(-1) || "";
	const decimals = format.split(decimal).pop() ?? "";
	const spec: NumberFormatSpec = {
		group,
		decimal,
		precision: decimals.length === format.length ? 2 : decimals.length,
		lakh: format === "#,##,###.##",
	};
	FORMAT_CACHE.set(format, spec);
	return spec;
}

/** Live formatting state, refreshed from the bootstrap payload. */
/** Mirrors System Settings > Rounding Method. */
export type RoundingMethod = "Banker's Rounding" | "Banker's Rounding (legacy)" | "Commercial Rounding";

/**
 * Currencies whose symbol we override, whatever the site's Currency record says.
 *
 * Saudi Arabia replaced the "ر.س" abbreviation with a real symbol (U+20C1) in 2025.
 * Frappe still ships the letters, and a site that has been trading for years will
 * have them stored, so normalising here means the POS shows the current symbol
 * without every deployment having to remember to edit a master record. The glyph is
 * bundled as a one-glyph webfont — see styles/riyal-font.css — because no stock OS
 * font carries the codepoint yet.
 */
const SYMBOL_OVERRIDES: Record<string, string> = {
	SAR: RIYAL_CHAR,
};

function preferredSymbol(currency: string | undefined, fallback: string): string {
	if (!currency) return fallback;
	return SYMBOL_OVERRIDES[currency.toUpperCase()] ?? fallback;
}

export const formatting = {
	numberFormat: "#,###.##",
	currency: "USD",
	currencySymbol: "$",
	currencyPrecision: 2,
	floatPrecision: 3,
	/** Where the symbol sits relative to the amount. */
	symbolOnRight: false,
	dateFormat: "yyyy-mm-dd",
	/** Frappe defaults to half-to-even; half-away-from-zero would put every
	 *  .5 total one unit away from what the server stores. */
	roundingMethod: "Banker's Rounding" as RoundingMethod,
};

export function configureFormatting(patch: Partial<typeof formatting>) {
	Object.assign(formatting, patch);
	formatting.currencySymbol = preferredSymbol(formatting.currency, formatting.currencySymbol);
}

function groupDigits(intPart: string, spec: NumberFormatSpec): string {
	if (!spec.group) return intPart;
	if (spec.lakh) {
		// Last three digits, then pairs.
		const tail = intPart.slice(-3);
		const head = intPart.slice(0, -3);
		if (!head) return tail;
		return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, spec.group)}${spec.group}${tail}`;
	}
	return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, spec.group);
}

/** Format a bare number without any currency decoration. */
export function formatNumber(value: number | string | null | undefined, precision?: number): string {
	const spec = parseNumberFormat(formatting.numberFormat);
	const digits = precision ?? spec.precision;
	const num = toNumber(value);
	const negative = num < 0;
	const fixed = Math.abs(num).toFixed(digits);
	const [intPart, decPart] = fixed.split(".");
	let out = groupDigits(intPart, spec);
	if (decPart) out += spec.decimal + decPart;
	return negative ? `-${out}` : out;
}

/** Format a float using the site's float precision, trimming trailing zeros. */
export function formatFloat(value: number | string | null | undefined, precision?: number): string {
	const num = toNumber(value);
	const digits = precision ?? formatting.floatPrecision;
	// Quantities read better as "2" than "2.000", so drop redundant decimals.
	const trimmed = Number(num.toFixed(digits));
	return formatNumber(trimmed, Number.isInteger(trimmed) ? 0 : digits);
}

export function formatCurrency(
	value: number | string | null | undefined,
	currency?: string,
	precision?: number,
): string {
	const symbol = currency && currency !== formatting.currency ? symbolFor(currency) : formatting.currencySymbol;
	const amount = formatNumber(value, precision ?? formatting.currencyPrecision);
	return formatting.symbolOnRight ? `${amount} ${symbol}` : `${symbol} ${amount}`;
}

const SYMBOLS = new Map<string, string>();
export function registerCurrencySymbols(map: Record<string, string>) {
	for (const [code, symbol] of Object.entries(map)) SYMBOLS.set(code, symbol);
}
export function symbolFor(currency: string): string {
	return preferredSymbol(currency, SYMBOLS.get(currency) ?? currency);
}

export function toNumber(value: unknown): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

/**
 * Round half away from zero at a given precision.
 *
 * JavaScript's Math.round is half-up (so -0.5 becomes -0) and float error makes
 * 1.005 round down. Both matter when money is on the line, so scale through a
 * string-safe epsilon nudge instead.
 */
export function round(value: number, precision = 2): number {
	if (!Number.isFinite(value)) return 0;
	const factor = 10 ** precision;
	const scaled = value * factor;
	// Nudge by one ULP-ish so 1.005 * 100 = 100.49999999999999 rounds to 101.
	const corrected =
		scaled >= 0
			? scaled + Number.EPSILON * Math.abs(scaled)
			: scaled - Number.EPSILON * Math.abs(scaled);

	const magnitude = Math.abs(corrected);
	const sign = corrected < 0 ? -1 : 1;
	const floor = Math.floor(magnitude);
	const fraction = magnitude - floor;

	let rounded: number;
	if (Math.abs(fraction - 0.5) < 1e-9 && formatting.roundingMethod !== "Commercial Rounding") {
		// Half-to-even: 2.5 -> 2, 3.5 -> 4. This is Frappe's default and the
		// server's stored rounded_total depends on it.
		rounded = floor % 2 === 0 ? floor : floor + 1;
	} else {
		rounded = Math.round(magnitude);
	}

	return (sign * rounded) / factor;
}

/** Currency-precision rounding, the default for anything money-shaped. */
export function money(value: number): number {
	return round(value, formatting.currencyPrecision);
}

/** Float-precision rounding, for quantities and conversion factors. */
export function qty(value: number): number {
	return round(value, formatting.floatPrecision);
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

export function today(): string {
	return toDateString(new Date());
}

export function toDateString(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDateTimeString(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${toDateString(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const DATE_STYLE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const TIME_STYLE: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export function formatDate(value?: string | Date | null): string {
	const date = asDate(value);
	return date ? date.toLocaleDateString(undefined, DATE_STYLE) : "";
}

export function formatDateTime(value?: string | Date | null): string {
	const date = asDate(value);
	return date ? `${date.toLocaleDateString(undefined, DATE_STYLE)}, ${date.toLocaleTimeString(undefined, TIME_STYLE)}` : "";
}

export function formatTime(value?: string | Date | null): string {
	const date = asDate(value);
	return date ? date.toLocaleTimeString(undefined, TIME_STYLE) : "";
}

function asDate(value?: string | Date | null): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	// Frappe sends "YYYY-MM-DD HH:MM:SS" which Safari refuses to parse directly.
	const normalised = value.includes("T") ? value : value.replace(" ", "T");
	const date = new Date(normalised);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** "in 3 days" / "2 hours ago" for expiry chips and shift timers. */
export function relativeTime(value?: string | Date | null): string {
	const date = asDate(value);
	if (!date) return "";
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	const diffMs = date.getTime() - Date.now();
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		["year", 31_536_000_000],
		["month", 2_592_000_000],
		["day", 86_400_000],
		["hour", 3_600_000],
		["minute", 60_000],
	];
	for (const [unit, ms] of units) {
		if (Math.abs(diffMs) >= ms) return rtf.format(Math.round(diffMs / ms), unit);
	}
	return rtf.format(Math.round(diffMs / 1000), "second");
}

/** Elapsed time as H:MM, used by the shift timer. */
export function elapsedSince(value?: string | Date | null): string {
	const date = asDate(value);
	if (!date) return "";
	const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${hours}:${String(minutes).padStart(2, "0")}`;
}
