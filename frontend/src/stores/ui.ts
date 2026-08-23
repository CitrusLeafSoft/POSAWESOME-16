/** Cross-cutting UI state: toasts, the busy veil, and which panel owns the screen. */
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import { uid } from "@/lib/uid";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface Toast {
	id: string;
	tone: ToastTone;
	title: string;
	detail?: string;
	/** ms; 0 keeps it until dismissed. */
	duration: number;
}

/** Which of the mutually exclusive left-hand panels is showing. */
export type Workspace = "catalog" | "payment" | "offers" | "coupons";

export const useUiStore = defineStore("ui", () => {
	const toasts = ref<Toast[]>([]);
	const workspace = ref<Workspace>("catalog");
	const busy = ref(false);
	const busyLabel = ref("");
	const commandPaletteOpen = ref(false);
	const shortcutsOpen = ref(false);
	/** Component + props for the currently mounted modal, if any. */
	const modal = shallowRef<{ name: string; props?: Record<string, unknown> } | null>(null);

	function notify(input: Partial<Toast> & { title: string }) {
		const toast: Toast = {
			id: uid("toast"),
			tone: input.tone ?? "info",
			title: input.title,
			detail: input.detail,
			duration: input.duration ?? (input.tone === "danger" ? 8000 : 4000),
		};
		toasts.value = [...toasts.value, toast];
		if (toast.duration > 0) setTimeout(() => dismiss(toast.id), toast.duration);
		return toast.id;
	}

	const success = (title: string, detail?: string) => notify({ title, detail, tone: "success" });
	const warn = (title: string, detail?: string) => notify({ title, detail, tone: "warning" });
	const fail = (title: string, detail?: string) => notify({ title, detail, tone: "danger" });

	function dismiss(id: string) {
		toasts.value = toasts.value.filter((toast) => toast.id !== id);
	}

	function setWorkspace(next: Workspace) {
		workspace.value = next;
	}

	function openModal(name: string, props?: Record<string, unknown>) {
		modal.value = { name, props };
	}

	function closeModal() {
		modal.value = null;
	}

	/** Wrap an async action in the global busy veil. */
	async function withBusy<T>(label: string, work: () => Promise<T>): Promise<T> {
		busy.value = true;
		busyLabel.value = label;
		try {
			return await work();
		} finally {
			busy.value = false;
			busyLabel.value = "";
		}
	}

	return {
		toasts,
		workspace,
		busy,
		busyLabel,
		commandPaletteOpen,
		shortcutsOpen,
		modal,
		notify,
		success,
		warn,
		fail,
		dismiss,
		setWorkspace,
		openModal,
		closeModal,
		withBusy,
	};
});
