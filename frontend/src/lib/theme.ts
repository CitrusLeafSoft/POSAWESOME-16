/** Theme preference, persisted per browser and applied to <html>. */
import { ref, watch } from "vue";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "posa:theme";

function readStored(): ThemePreference {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value === "light" || value === "dark" || value === "system") return value;
	} catch {
		/* private browsing */
	}
	return "system";
}

export const themePreference = ref<ThemePreference>(readStored());
export const isDark = ref(false);

const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function apply() {
	const dark = themePreference.value === "dark" || (themePreference.value === "system" && !!media?.matches);
	isDark.value = dark;
	document.documentElement.classList.toggle("dark", dark);
	document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b1220" : "#f7f8fa");
}

export function initTheme() {
	apply();
	media?.addEventListener("change", () => {
		if (themePreference.value === "system") apply();
	});
	watch(themePreference, (value) => {
		try {
			localStorage.setItem(STORAGE_KEY, value);
		} catch {
			/* ignore */
		}
		apply();
	});
}

export function cycleTheme() {
	const order: ThemePreference[] = ["light", "dark", "system"];
	const next = order[(order.indexOf(themePreference.value) + 1) % order.length];
	themePreference.value = next;
}
