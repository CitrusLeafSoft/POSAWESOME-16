<script setup lang="ts">
/** Find a submitted invoice and load it back as a credit note. */
import { ref } from "vue";
import { Loader2, Search, Undo2 } from "lucide-vue-next";
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

async function search() {
	searching.value = true;
	try {
		rows.value =
			((await api.searchInvoicesForReturn(term.value.trim(), session.companyName)) as Record<
				string,
				unknown
			>[]) ?? [];
		searched.value = true;
	} catch (error) {
		ui.fail("Search failed", error instanceof Error ? error.message : String(error));
	} finally {
		searching.value = false;
	}
}

function startReturn(doc: Record<string, unknown>) {
	// loadFromDoc negates quantities and records the per-row ceiling, so a return
	// can never exceed what was actually sold.
	cart.loadFromDoc(doc, { asReturn: true });
	ui.closeModal();
	ui.notify({ title: "Return started", detail: `Against ${doc.name}`, tone: "warning" });
}
</script>

<template>
	<ModalShell
		title="Return against an invoice"
		subtitle="Quantities load negative and are capped at what was sold"
		width="max-w-xl"
		@close="ui.closeModal()"
	>
		<form class="flex gap-2 border-b border-line p-4" @submit.prevent="search">
			<div class="relative min-w-0 flex-1">
				<Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
				<input
					v-model="term"
					type="search"
					placeholder="Invoice number, or leave blank for recent"
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
			<Undo2 class="size-8 text-subtle" />
			<p class="text-sm font-medium">{{ searched ? "No eligible invoice found" : "Search for an invoice" }}</p>
			<p class="max-w-xs text-xs text-muted">
				Only submitted invoices that have not already been returned can be selected.
			</p>
		</div>

		<ul v-else class="divide-y divide-line">
			<li
				v-for="(row, i) in rows"
				:key="row.name as string"
				class="stagger"
				:style="{ '--i': i }"
			>
				<button
					type="button"
					class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2"
					@click="startReturn(row)"
				>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{{ row.customer_name || row.customer }}</span>
						<span class="block truncate font-mono text-[11px] text-subtle">
							{{ row.name }} · {{ formatDate(row.posting_date as string) }}
						</span>
					</span>
					<span class="shrink-0 text-sm font-bold tnum">{{ formatCurrency(row.grand_total as number) }}</span>
				</button>
			</li>
		</ul>
	</ModalShell>
</template>
