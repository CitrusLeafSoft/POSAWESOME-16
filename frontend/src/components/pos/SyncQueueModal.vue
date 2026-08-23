<script setup lang="ts">
/**
 * The offline queue, made visible.
 *
 * Every row here is a sale that has already happened: money taken, goods handed
 * over. So this list is deliberately blunt about state — how many attempts, what the
 * server said, how long it has been waiting — and discarding one asks for
 * confirmation, because it throws away a real transaction.
 */
import { computed, onMounted } from "vue";
import { CloudOff, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-vue-next";
import { formatCurrency, relativeTime } from "@/lib/format";
import { useSyncStore } from "@/stores/sync";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

const sync = useSyncStore();
const ui = useUiStore();

onMounted(() => void sync.refresh());

const subtitle = computed(() =>
	sync.outstanding === 0
		? "Everything has been sent"
		: `${sync.outstanding} waiting${sync.failed.length ? ` · ${sync.failed.length} rejected` : ""}`,
);

function discard(uuid: string, label: string) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`Discard the sale for ${label}? The money was already taken; this cannot be undone.`)) {
		return;
	}
	void sync.discard(uuid);
}
</script>

<template>
	<ModalShell title="Waiting to send" :subtitle="subtitle" width="max-w-2xl" @close="ui.closeModal()">
		<div class="space-y-3 p-4">
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="flex h-10 items-center gap-1.5 rounded-card bg-accent px-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-50"
					:disabled="sync.draining || !sync.hasOutstanding"
					@click="sync.drain()"
				>
					<Loader2 v-if="sync.draining" class="size-4 animate-spin" />
					<RefreshCw v-else class="size-4" />
					Send now
				</button>
				<span v-if="sync.lastDrainAt" class="text-xs text-subtle">
					Last tried {{ relativeTime(new Date(sync.lastDrainAt)) }}
				</span>
			</div>

			<div
				v-if="!sync.entries.length"
				class="flex flex-col items-center justify-center gap-2 py-10 text-center"
			>
				<CloudOff class="size-8 text-subtle" />
				<p class="text-sm font-medium">Nothing waiting</p>
				<p class="max-w-xs text-xs text-muted">
					Sales taken while the connection is down appear here until the server has them.
				</p>
			</div>

			<ul v-else class="divide-y divide-line">
				<li v-for="row in sync.entries" :key="row.uuid" class="flex items-start gap-3 py-2.5">
					<span
						class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg"
						:class="
							row.status === 'failed'
								? 'bg-danger-soft text-danger'
								: 'bg-warning-soft text-warning'
						"
					>
						<TriangleAlert v-if="row.status === 'failed'" class="size-4" />
						<CloudOff v-else class="size-4" />
					</span>

					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{{ row.summary.customer_name }}</p>
						<p class="text-[11px] text-subtle">
							{{ row.summary.item_count }}
							{{ row.summary.item_count === 1 ? "line" : "lines" }} ·
							{{ relativeTime(new Date(row.created_at)) }}
							<span v-if="row.attempts">· {{ row.attempts }} attempts</span>
						</p>
						<p v-if="row.last_error" class="mt-0.5 text-[11px] text-danger">{{ row.last_error }}</p>
					</div>

					<span class="shrink-0 text-sm font-bold tnum">
						{{ formatCurrency(row.summary.grand_total, row.summary.currency) }}
					</span>

					<button
						type="button"
						class="grid size-8 shrink-0 place-items-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
						aria-label="Discard"
						@click="discard(row.uuid, row.summary.customer_name)"
					>
						<Trash2 class="size-3.5" />
					</button>
				</li>
			</ul>
		</div>
	</ModalShell>
</template>
