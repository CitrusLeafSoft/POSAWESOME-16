/**
 * Global hotkey dispatcher.
 *
 * A cashier's hands stay on the keyboard, so shortcuts must fire even while a
 * search box has focus. The rule: plain single-character keys are ignored while
 * typing, but function keys and modified chords always win.
 */

export interface Hotkey {
	/** e.g. "F2", "ctrl+k", "shift+F4", "Escape" */
	combo: string;
	label: string;
	group: string;
	handler: (event: KeyboardEvent) => void;
	/** Fire even when a text field has focus. Defaults to true for F-keys/chords. */
	whileTyping?: boolean;
	enabled?: () => boolean;
}

const registry = new Map<string, Hotkey>();

function normalise(combo: string): string {
	const parts = combo.toLowerCase().split("+").map((p) => p.trim());
	const key = parts.pop() ?? "";
	const mods = new Set(parts);
	return [mods.has("ctrl") || mods.has("cmd") ? "mod" : "", mods.has("alt") ? "alt" : "", mods.has("shift") ? "shift" : "", key]
		.filter(Boolean)
		.join("+");
}

function eventCombo(event: KeyboardEvent): string {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
	return [event.ctrlKey || event.metaKey ? "mod" : "", event.altKey ? "alt" : "", event.shiftKey ? "shift" : "", key]
		.filter(Boolean)
		.join("+");
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isChordOrFunctionKey(combo: string): boolean {
	return combo.includes("+") || /^f\d{1,2}$/.test(combo) || combo === "escape";
}

export function registerHotkeys(keys: Hotkey[]): () => void {
	const added: string[] = [];
	for (const key of keys) {
		const id = normalise(key.combo);
		registry.set(id, key);
		added.push(id);
	}
	return () => added.forEach((id) => registry.delete(id));
}

export function listHotkeys(): Hotkey[] {
	return [...registry.values()];
}

let bound = false;

export function initHotkeys() {
	if (bound) return;
	bound = true;
	window.addEventListener(
		"keydown",
		(event) => {
			if (event.defaultPrevented || event.repeat) return;
			const combo = eventCombo(event);
			const hotkey = registry.get(combo);
			if (!hotkey) return;
			if (hotkey.enabled && !hotkey.enabled()) return;

			const allowWhileTyping = hotkey.whileTyping ?? isChordOrFunctionKey(combo);
			if (!allowWhileTyping && isTypingTarget(event.target)) return;

			event.preventDefault();
			event.stopPropagation();
			hotkey.handler(event);
		},
		{ capture: true },
	);
}
