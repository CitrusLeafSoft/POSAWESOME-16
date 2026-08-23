/**
 * Barcode scanner input.
 *
 * Hardware scanners emulate a keyboard: they type the whole code far faster than a
 * human can and finish with Enter. We watch for that timing signature at the
 * document level so a scan works no matter which field has focus.
 */

export interface ScanEvent {
	code: string;
	/** Weight decoded from a scale barcode, when one was detected. */
	weight?: number;
	/** The lookup key to search with — for scale barcodes this is the prefix only. */
	lookup: string;
}

export interface ScannerOptions {
	/** Maximum gap between keystrokes, in ms, that still counts as machine input. */
	maxKeystrokeGap?: number;
	/** Shortest sequence to treat as a scan. */
	minLength?: number;
	/** POS Profile posa_scale_barcode_start, when scale barcodes are in use. */
	scalePrefix?: () => string | undefined;
	onScan: (event: ScanEvent) => void;
}

const DEFAULT_GAP = 45;
const DEFAULT_MIN_LENGTH = 4;

/**
 * Decode an embedded-weight (scale) barcode.
 *
 * Layout used by retail scales: `PPIIIII WWWWW C` — a configurable prefix, the
 * item lookup key in the first 7 characters, then a 5-digit weight in grams.
 */
export function decodeScaleBarcode(code: string, prefix?: string): { lookup: string; weight: number } | null {
	if (!prefix || !code.startsWith(prefix) || code.length < 12) return null;
	const grams = Number.parseInt(code.slice(7, 12), 10);
	if (!Number.isFinite(grams)) return null;
	return { lookup: code.slice(0, 7), weight: grams / 1000 };
}

export function createScanner(options: ScannerOptions) {
	const { maxKeystrokeGap = DEFAULT_GAP, minLength = DEFAULT_MIN_LENGTH, scalePrefix, onScan } = options;

	let buffer = "";
	let lastKeyAt = 0;
	let timer: number | undefined;

	function reset() {
		buffer = "";
		if (timer) {
			window.clearTimeout(timer);
			timer = undefined;
		}
	}

	function emit() {
		const code = buffer.trim();
		reset();
		if (code.length < minLength) return;

		const scale = decodeScaleBarcode(code, scalePrefix?.());
		onScan(scale ? { code, lookup: scale.lookup, weight: scale.weight } : { code, lookup: code });
	}

	function onKeyDown(event: KeyboardEvent) {
		// Chords are commands, never scanner output.
		if (event.ctrlKey || event.metaKey || event.altKey) return reset();

		const now = performance.now();
		const gap = now - lastKeyAt;
		lastKeyAt = now;

		if (event.key === "Enter") {
			if (buffer.length >= minLength) {
				// Swallow the Enter so it does not also submit whatever has focus.
				event.preventDefault();
				event.stopPropagation();
				emit();
			} else {
				reset();
			}
			return;
		}

		if (event.key.length !== 1) return;

		// A slow keystroke means a human is typing: start the buffer over.
		if (gap > maxKeystrokeGap) buffer = "";
		buffer += event.key;

		// Some scanners are configured without a suffix; flush on quiet.
		if (timer) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			if (buffer.length >= minLength) emit();
			else reset();
		}, maxKeystrokeGap * 4);
	}

	function attach() {
		window.addEventListener("keydown", onKeyDown, { capture: true });
	}

	function detach() {
		window.removeEventListener("keydown", onKeyDown, { capture: true });
		reset();
	}

	return { attach, detach };
}
