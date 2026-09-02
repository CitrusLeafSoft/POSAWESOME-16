<script setup lang="ts">
/**
 * Every POS Sales Invoice raised on the current user's open shift, newest first,
 * with its status — Draft, parked-for-approval, Submitted/Paid, Cancelled.
 *
 * Submitted invoices get a reprint button. The print logic is the same as the
 * receipt dialog after a sale: it opens the "print" modal, which resolves the
 * format, renders the preview into a sandboxed iframe and prints that window.
 */
import { onMounted, ref } from "vue";
import { FileClock, Printer } from "lucide-vue-next";
import { api } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

interface ShiftInvoice {
	name: string;
	customer?: string;
	customer_name?: string;
	grand_total?: number;
	docstatus?: number;
	status?: string;
	workflow_state?: string;
	is_return?: 0 | 1;
	posa_is_printed?: 0 | 1;
	posting_date?: string;
	posting_time?: string;
	modified?: string;
}

const session = useSessionStore();
const ui = useUiStore();

const rows = ref<ShiftInvoice[]>([]);
const loading = ref(true);

async function load() {
	loading.value = true;
	try {
		rows.value = ((await api.shiftInvoices(session.shiftName)) as ShiftInvoice[]) ?? [];
	} catch (error) {
		ui.fail("Could not load shift invoices", error instanceof Error ? error.message : String(error));
	} finally {
		loading.value = false;
	}
}
onMounted(load);

/** Badge shown for the invoice's lifecycle state. */
function statusView(row: ShiftInvoice): { label: string; tone: "success" | "warning" | "danger" | "muted" } {
	if (row.docstatus === 2) return { label: "Cancelled", tone: "danger" };
	if (row.docstatus === 1) {
		return {
			label: row.is_return ? "Returned" : row.status || "Submitted",
			tone: "success",
		};
	}
	if (row.workflow_state) return { label: row.workflow_state, tone: "warning" };
	return { label: row.posa_is_printed ? "Pending" : "Draft", tone: "muted" };
}

/** Reprint a submitted invoice via the same receipt dialog the sale used. */
function print(row: ShiftInvoice) {
	ui.openModal("print", { invoiceName: row.name });
}
</script>

<template>
	<ModalShell title="Shift invoices" :subtitle="session.shiftName" width="max-w-2xl" @close="ui.closeModal()">
		<div v-if="loading" class="space-y-2 p-4">
			<div v-for="n in 4" :key="n" class="skeleton h-14 rounded-card" />
		</div>

		<div v-else-if="!rows.length" class="flex flex-col items-center gap-2 p-10 text-center">
			<FileClock class="size-8 text-subtle" />
			<p class="text-sm font-medium">No invoices on this shift</p>
			<p class="text-xs text-muted">Sales you complete will show up here.</p>
		</div>

		<ul v-else class="divide-y divide-line">
			<li
				v-for="(row, i) in rows"
				:key="row.name"
				class="stagger flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2"
				:style="{ '--i': i }"
			>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">
						{{ row.customer_name || row.customer }}
						<span v-if="row.is_return" class="text-danger">· return</span>
					</p>
					<p class="truncate font-mono text-[11px] text-subtle">
						{{ row.name }} · {{ formatDateTime(row.modified as string) }}
					</p>
				</div>

				<span class="shrink-0 text-sm font-bold tnum">{{ formatCurrency(row.grand_total as number) }}</span>

				<span
					class="inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[11px] font-semibold"
					:class="{
						'bg-success-soft text-success': statusView(row).tone === 'success',
						'bg-warning-soft text-warning': statusView(row).tone === 'warning',
						'bg-danger-soft text-danger': statusView(row).tone === 'danger',
						'bg-surface-3 text-subtle': statusView(row).tone === 'muted',
					}"
				>
					{{ statusView(row).label }}
				</span>

				<button
					v-if="row.docstatus === 1"
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-muted shadow-xs transition hover:border-accent hover:text-accent"
					title="Print this invoice"
					@click="print(row)"
				>
					<Printer class="size-3.5" /> Print
				</button>
			</li>
		</ul>
	</ModalShell>
</template>