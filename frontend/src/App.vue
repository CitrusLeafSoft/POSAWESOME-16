<script setup lang="ts">
/**
 * Application shell. Owns exactly three things: booting the session, deciding
 * whether the operator may sell yet, and hosting the global chrome (top bar,
 * toasts, busy veil).
 */
import { computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";
import { useSyncStore } from "@/stores/sync";
import { useUiStore } from "@/stores/ui";
import AppTopBar from "@/components/layout/AppTopBar.vue";
import ToastHost from "@/components/layout/ToastHost.vue";
import BusyVeil from "@/components/layout/BusyVeil.vue";
import HotkeyHelp from "@/components/layout/HotkeyHelp.vue";
import BootScreen from "@/components/layout/BootScreen.vue";

const session = useSessionStore();
const sync = useSyncStore();
const ui = useUiStore();
const router = useRouter();

const showApp = computed(() => session.ready && !session.booting);

onMounted(async () => {
	session.watchConnectivity();
	await session.boot();
	// Anything the last session could not send is drained as soon as we are up.
	sync.watch();
});

// A terminal with no open shift cannot sell; send it to the opening form.
watch(
	() => session.needsOpeningShift,
	(needs) => {
		if (needs) void router.replace({ name: "shift" });
	},
	{ immediate: true },
);

watch(
	() => session.ready,
	(ready) => {
		if (ready && router.currentRoute.value.name === "shift") void router.replace({ name: "sell" });
	},
);
</script>

<template>
	<div class="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
		<template v-if="session.booting">
			<BootScreen :message="session.bootError" @retry="session.boot()" />
		</template>

		<template v-else-if="session.bootError && !session.ready">
			<BootScreen :message="session.bootError" @retry="session.boot()" />
		</template>

		<template v-else>
			<AppTopBar v-if="showApp || session.needsOpeningShift" />
			<main class="min-h-0 flex-1 overflow-hidden">
				<RouterView v-slot="{ Component }">
					<component :is="Component" />
				</RouterView>
			</main>
		</template>

		<ToastHost />
		<BusyVeil />
		<HotkeyHelp v-if="ui.shortcutsOpen" @close="ui.shortcutsOpen = false" />
	</div>
</template>
