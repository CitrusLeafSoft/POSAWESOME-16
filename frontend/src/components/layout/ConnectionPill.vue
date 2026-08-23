<script setup lang="ts">
/**
 * Connection state, and anything the terminal is still holding.
 *
 * The queue count lives here rather than in its own corner because the two facts
 * belong together: "offline" only matters to a cashier because of what has not been
 * sent yet. When something is waiting, this stops being a status light and becomes
 * the way in to the queue.
 */
import { computed } from "vue";
import { Cloud, CloudOff, RefreshCw } from "lucide-vue-next";
import { useSessionStore } from "@/stores/session";
import { useSyncStore } from "@/stores/sync";
import { useUiStore } from "@/stores/ui";

const session = useSessionStore();
const sync = useSyncStore();
const ui = useUiStore();

const state = computed(() => {
	if (session.serverReachable) return { label: "Online", tone: "text-success bg-success-soft", icon: Cloud };
	if (session.canWorkOffline) return { label: "Offline", tone: "text-warning bg-warning-soft", icon: CloudOff };
	return { label: "No connection", tone: "text-danger bg-danger-soft", icon: CloudOff };
});

function onClick() {
	// With sales waiting, the useful action is seeing them — not re-probing a
	// connection the pill already reports on. Offline with an empty queue, retrying
	// the connection is the useful one.
	if (sync.hasOutstanding) ui.openModal("queue");
	else void session.probe();
}
</script>

<template>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition"
		:class="state.tone"
		:title="
			sync.hasOutstanding
				? `${sync.outstanding} sale(s) waiting to send`
				: session.serverReachable
					? 'Connected'
					: 'Click to retry'
		"
		@click="onClick"
	>
		<component :is="state.icon" class="size-3.5" />
		<span class="hidden sm:inline">{{ state.label }}</span>

		<span
			v-if="sync.hasOutstanding"
			class="grid min-w-4 place-items-center rounded-full bg-current px-1 text-[10px] font-bold"
			:class="sync.draining && 'animate-pulse'"
		>
			<span class="text-inverse">{{ sync.outstanding }}</span>
		</span>
		<RefreshCw v-else-if="!session.serverReachable" class="size-3" />
	</button>
</template>
