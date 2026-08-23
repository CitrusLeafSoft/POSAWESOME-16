<script setup lang="ts">
import { Loader2, WifiOff, RotateCw } from "lucide-vue-next";

defineProps<{ message?: string | null }>();
defineEmits<{ retry: [] }>();
</script>

<template>
	<div class="flex h-full flex-col items-center justify-center gap-5 p-8">
		<div
			class="grid size-16 place-items-center rounded-panel bg-accent-soft text-accent"
			:class="message ? '' : 'animate-pulse-ring'"
		>
			<WifiOff v-if="message" class="size-7" />
			<Loader2 v-else class="size-7 animate-spin" />
		</div>

		<div class="max-w-md text-center">
			<h1 class="text-lg font-semibold">{{ message ? "Cannot start" : "Opening the till" }}</h1>
			<p class="mt-1 text-sm text-muted">
				{{ message || "Loading your shift and profile…" }}
			</p>
		</div>

		<button
			v-if="message"
			type="button"
			class="inline-flex items-center gap-2 rounded-card bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
			@click="$emit('retry')"
		>
			<RotateCw class="size-4" />
			Try again
		</button>
	</div>
</template>
