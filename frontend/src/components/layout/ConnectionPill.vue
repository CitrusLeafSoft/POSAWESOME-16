<script setup lang="ts">
import { computed } from "vue";
import { Cloud, CloudOff, RefreshCw } from "lucide-vue-next";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();

const state = computed(() => {
	if (session.serverReachable) return { label: "Online", tone: "text-success bg-success-soft", icon: Cloud };
	if (session.canWorkOffline) return { label: "Offline", tone: "text-warning bg-warning-soft", icon: CloudOff };
	return { label: "No connection", tone: "text-danger bg-danger-soft", icon: CloudOff };
});
</script>

<template>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition"
		:class="state.tone"
		:title="session.serverReachable ? 'Connected' : 'Click to retry'"
		@click="session.probe()"
	>
		<component :is="state.icon" class="size-3.5" />
		<span class="hidden sm:inline">{{ state.label }}</span>
		<RefreshCw v-if="!session.serverReachable" class="size-3" />
	</button>
</template>
