<script setup lang="ts">
import { Loader2 } from "lucide-vue-next";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
</script>

<template>
	<Transition
		enter-active-class="transition duration-150"
		enter-from-class="opacity-0"
		leave-active-class="transition duration-150"
		leave-to-class="opacity-0"
	>
		<div
			v-if="ui.busy"
			class="fixed inset-0 z-50 grid place-items-center bg-overlay backdrop-blur-sm"
			role="status"
			aria-live="polite"
		>
			<div class="panel flex items-center gap-3 px-5 py-4 shadow-lg">
				<Loader2 class="size-5 animate-spin text-accent" />
				<span class="text-sm font-medium">{{ ui.busyLabel || "Working…" }}</span>
			</div>
		</div>
	</Transition>
</template>
