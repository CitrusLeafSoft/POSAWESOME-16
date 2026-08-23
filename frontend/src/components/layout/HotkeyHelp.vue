<script setup lang="ts">
import { computed } from "vue";
import { X } from "lucide-vue-next";
import { listHotkeys } from "@/lib/hotkeys";

defineEmits<{ close: [] }>();

/** Grouped for display; the registry itself is flat. */
const groups = computed(() => {
	const map = new Map<string, { combo: string; label: string }[]>();
	for (const key of listHotkeys()) {
		const list = map.get(key.group) ?? [];
		list.push({ combo: key.combo, label: key.label });
		map.set(key.group, list);
	}
	return [...map.entries()];
});
</script>

<template>
	<div
		class="fixed inset-0 z-60 grid place-items-center bg-overlay p-4 backdrop-blur-sm"
		@click.self="$emit('close')"
	>
		<div class="panel w-full max-w-lg animate-pop-in overflow-hidden shadow-lg">
			<header class="flex items-center justify-between border-b border-line px-5 py-3">
				<h2 class="text-sm font-semibold">Keyboard shortcuts</h2>
				<button
					type="button"
					class="rounded p-1 text-subtle transition hover:bg-surface-2 hover:text-fg"
					@click="$emit('close')"
				>
					<X class="size-4" />
				</button>
			</header>

			<div class="max-h-[60vh] overflow-y-auto p-5">
				<p v-if="!groups.length" class="text-sm text-muted">No shortcuts registered yet.</p>
				<div v-for="[group, keys] in groups" :key="group" class="mb-5 last:mb-0">
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{{ group }}</h3>
					<ul class="space-y-1.5">
						<li v-for="key in keys" :key="key.combo" class="flex items-center justify-between gap-4 text-sm">
							<span class="text-muted">{{ key.label }}</span>
							<kbd
								class="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-semibold uppercase"
								>{{ key.combo }}</kbd
							>
						</li>
					</ul>
				</div>
			</div>
		</div>
	</div>
</template>
