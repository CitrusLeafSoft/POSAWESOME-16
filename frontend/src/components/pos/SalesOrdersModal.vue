<script setup lang="ts">
/** Bill an open sales order from the till. */
import { ref } from "vue";
import { ClipboardList, Loader2, Search } from "lucide-vue-next";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

const cart = useCartStore();
const session = useSessionStore();
const ui = useUiStore();

const term = ref("");
const rows = ref<Record<string, unknown>[]>([]);
const searching = ref(false);
const searched = ref(false);
const loadingOrder = ref<string | null>(null);

async function search() {
	searching.value = true;
	try {
		rows.value =
			((await api.searchOrders({
				company: session.companyName,
				currency: session.currency,
				order_name: term.value.trim() || undefined,
			})) as Record<string, unknown>[]) ?? [];
		searched.value = true;
	} catch (error) {
		ui.fail("Search failed", error instanceof Error ? error.message : String(error));
	} finally {
		searching.value = false;
	}
}

async function bill(order: Record<string, unknown>) {
	loadingOrder.value = order.name as string;
	try {
		const invoice = (await api.invoiceFromOrder(order.name as string)) as Record<string, unknown>;
		cart.loadFromDoc(invoice);
		ui.closeModal();
		ui.success("Order loaded", order.name as string);
	} catch (error) {
		ui.fail("Could not bill the order", error instanceof Error ? error.message : String(error));
	} finally {
		loadingOrder.value = null;
	}
}
</script>

<template>
	<ModalShell
		title="Sales orders"
		subtitle="Unbilled and partly billed orders"
		width="max-w-xl"
		@close="ui.closeModal()"
	>
		<form class="flex gap-2 border-b border-line p-4" @submit.prevent="search">
			<div class="relative min-w-0 flex-1">
				<Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
				<input
					v-model="term"
					type="search"
					placeholder="Order number, or leave blank for recent"
					class="h-11 w-full rounded-card border-line bg-surface pl-9 text-sm shadow-xs focus:border-accent focus:ring-0"
				/>
			</div>
			<button
				type="submit"
				class="h-11 shrink-0 rounded-card bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
				:disabled="searching"
			>
				<Loader2 v-if="searching" class="size-4 animate-spin" />
				<span v-else>Search</span>
			</button>
		</form>

		<div v-if="!rows.length" class="flex flex-col items-center gap-2 p-10 text-center">
			<ClipboardList class="size-8 text-subtle" />
			<p class="text-sm font-medium">{{ searched ? "No open order found" : "Search for an order" }}</p>
		</div>

		<ul v-else class="divide-y divide-line">
			<li v-for="(row, i) in rows" :key="row.name as string" class="stagger" :style="{ '--i': i }">
				<button
					type="button"
					class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 disabled:opacity-50"
					:disabled="loadingOrder === row.name"
					@click="bill(row)"
				>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{{ row.customer_name || row.customer }}</span>
						<span class="block truncate font-mono text-[11px] text-subtle">
							{{ row.name }} · {{ formatDate(row.transaction_date as string) }} · {{ row.billing_status }}
						</span>
					</span>
					<Loader2 v-if="loadingOrder === row.name" class="size-4 shrink-0 animate-spin text-accent" />
					<span v-else class="shrink-0 text-sm font-bold tnum">
						{{ formatCurrency(row.grand_total as number) }}
					</span>
				</button>
			</li>
		</ul>
	</ModalShell>
</template>
