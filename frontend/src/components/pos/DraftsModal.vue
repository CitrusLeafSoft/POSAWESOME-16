<script setup lang="ts">
/** Held invoices for this shift. Picking one loads it back into the cart. */
import { onMounted, ref } from "vue";
import { FileClock, Trash2 } from "lucide-vue-next";
import { api } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

const cart = useCartStore();
const session = useSessionStore();
const ui = useUiStore();

const rows = ref<Record<string, unknown>[]>([]);
const loading = ref(true);

async function load() {
	loading.value = true;
	try {
		rows.value = ((await api.draftInvoices(session.shiftName)) as Record<string, unknown>[]) ?? [];
	} catch (error) {
		ui.fail("Could not load held invoices", error instanceof Error ? error.message : String(error));
	} finally {
		loading.value = false;
	}
}
onMounted(load);

function resume(doc: Record<string, unknown>) {
	cart.loadFromDoc(doc);
	ui.closeModal();
	ui.success("Invoice resumed", doc.name as string);
}

async function discard(doc: Record<string, unknown>) {
	if (!session.profile?.posa_allow_delete) {
		ui.warn("Deleting invoices is not allowed on this POS profile");
		return;
	}
	try {
		await api.deleteInvoice(doc.name as string);
		rows.value = rows.value.filter((row) => row.name !== doc.name);
		ui.success("Invoice deleted", doc.name as string);
	} catch (error) {
		ui.fail("Could not delete", error instanceof Error ? error.message : String(error));
	}
}
</script>

<template>
	<ModalShell title="Held invoices" subtitle="Drafts saved on this shift" width="max-w-xl" @close="ui.closeModal()">
		<div v-if="loading" class="space-y-2 p-4">
			<div v-for="n in 4" :key="n" class="skeleton h-14 rounded-card" />
		</div>

		<div v-else-if="!rows.length" class="flex flex-col items-center gap-2 p-10 text-center">
			<FileClock class="size-8 text-subtle" />
			<p class="text-sm font-medium">Nothing on hold</p>
			<p class="text-xs text-muted">Invoices you park mid-sale show up here.</p>
		</div>

		<ul v-else class="divide-y divide-line">
			<li
				v-for="(row, i) in rows"
				:key="row.name as string"
				class="stagger flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2"
				:style="{ '--i': i }"
			>
				<button type="button" class="min-w-0 flex-1 text-left" @click="resume(row)">
					<p class="truncate text-sm font-medium">{{ row.customer_name || row.customer }}</p>
					<p class="truncate font-mono text-[11px] text-subtle">
						{{ row.name }} · {{ formatDateTime(row.modified as string) }}
					</p>
				</button>
				<span class="shrink-0 text-sm font-bold tnum">{{ formatCurrency(row.grand_total as number) }}</span>
				<button
					type="button"
					class="grid size-8 shrink-0 place-items-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
					aria-label="Delete draft"
					@click="discard(row)"
				>
					<Trash2 class="size-3.5" />
				</button>
			</li>
		</ul>
	</ModalShell>
</template>
