<script setup lang="ts">
/** Shared dialog frame: backdrop, escape, focus trap entry point, animation. */
import { onMounted, onUnmounted, ref } from "vue";
import { X } from "lucide-vue-next";

withDefaults(defineProps<{ title: string; subtitle?: string; width?: string }>(), {
	width: "max-w-lg",
});
const emit = defineEmits<{ close: [] }>();

const card = ref<HTMLElement | null>(null);

function onKey(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.stopPropagation();
		emit("close");
	}
}

onMounted(() => {
	window.addEventListener("keydown", onKey, { capture: true });
	card.value?.querySelector<HTMLElement>("input,select,button")?.focus();
});
onUnmounted(() => window.removeEventListener("keydown", onKey, { capture: true }));
</script>

<template>
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-overlay p-4 backdrop-blur-sm animate-fade-in"
		role="dialog"
		aria-modal="true"
		@click.self="emit('close')"
	>
		<div
			ref="card"
			class="panel flex max-h-[85vh] w-full flex-col overflow-hidden shadow-lg animate-pop-in"
			:class="width"
		>
			<header class="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
				<div class="min-w-0">
					<h2 class="truncate text-sm font-semibold">{{ title }}</h2>
					<p v-if="subtitle" class="truncate text-xs text-muted">{{ subtitle }}</p>
				</div>
				<button
					type="button"
					class="grid size-7 shrink-0 place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-fg"
					aria-label="Close"
					@click="emit('close')"
				>
					<X class="size-4" />
				</button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto"><slot /></div>

			<footer v-if="$slots.footer" class="shrink-0 border-t border-line px-5 py-3">
				<slot name="footer" />
			</footer>
		</div>
	</div>
</template>
