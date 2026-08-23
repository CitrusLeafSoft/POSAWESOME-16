<script setup lang="ts">
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-vue-next";
import { useUiStore } from "@/stores/ui";
import type { ToastTone } from "@/stores/ui";

const ui = useUiStore();

const icons: Record<ToastTone, unknown> = {
	success: CheckCircle2,
	warning: AlertTriangle,
	danger: XCircle,
	info: Info,
};

const tones: Record<ToastTone, string> = {
	success: "text-success bg-success-soft",
	warning: "text-warning bg-warning-soft",
	danger: "text-danger bg-danger-soft",
	info: "text-info bg-info-soft",
};
</script>

<template>
	<div class="pointer-events-none fixed bottom-4 right-4 z-60 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
		<TransitionGroup
			enter-active-class="transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
			enter-from-class="translate-x-6 opacity-0"
			leave-active-class="transition duration-200"
			leave-to-class="translate-x-6 opacity-0"
			move-class="transition duration-200"
		>
			<div
				v-for="toast in ui.toasts"
				:key="toast.id"
				class="panel pointer-events-auto flex items-start gap-3 p-3 shadow-md"
				role="alert"
			>
				<span class="grid size-8 shrink-0 place-items-center rounded-lg" :class="tones[toast.tone]">
					<component :is="icons[toast.tone]" class="size-4" />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold leading-tight">{{ toast.title }}</p>
					<p v-if="toast.detail" class="mt-0.5 text-xs text-muted">{{ toast.detail }}</p>
				</div>
				<button
					type="button"
					class="rounded p-1 text-subtle transition hover:bg-surface-2 hover:text-fg"
					aria-label="Dismiss"
					@click="ui.dismiss(toast.id)"
				>
					<X class="size-3.5" />
				</button>
			</div>
		</TransitionGroup>
	</div>
</template>
