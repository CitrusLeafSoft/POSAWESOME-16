/**
 * Tender state for the sale being closed.
 *
 * Rows mirror the profile's modes of payment. The cashier fills amounts; this
 * store derives what is still owed and what change is due, and owns the actual
 * submit so no component has to know the invoice payload shape.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/lib/api";
import { money, toNumber } from "@/lib/format";
import type { PaymentMethod } from "@/types";
import { useCartStore } from "./cart";
import { useSessionStore } from "./session";
import { useUiStore } from "./ui";

export interface TenderRow {
	mode_of_payment: string;
	amount: number;
	account?: string;
	type?: string;
	default: boolean;
}

export const usePaymentsStore = defineStore("payments", () => {
	const session = useSessionStore();
	const cart = useCartStore();
	const ui = useUiStore();

	const rows = ref<TenderRow[]>([]);
	const submitting = ref(false);
	/** The invoice that was just completed, for the success panel and reprint. */
	const lastInvoice = ref<Record<string, unknown> | null>(null);

	/** +1 on a sale, -1 on a return. Money flows the other way on a credit note,
	 *  so every comparison below has to be taken relative to this. */
	const sign = computed(() => (cart.isReturn ? -1 : 1));

	const paid = computed(() => money(rows.value.reduce((sum, row) => sum + toNumber(row.amount), 0)));
	const payable = computed(() => cart.payableAmount);
	/** Signed shortfall: still owed on a sale, still to refund on a return. */
	const remaining = computed(() => money(payable.value - paid.value));
	/** Magnitude still outstanding, whichever way the money is moving. */
	const outstanding = computed(() => money(Math.max(sign.value * remaining.value, 0)));
	/** Over-tender: change owed to the customer, or an over-refund. */
	const change = computed(() => money(Math.max(sign.value * (paid.value - payable.value), 0)));
	const settled = computed(() => sign.value * remaining.value <= 0);
	const canSubmit = computed(
		() =>
			!cart.isEmpty &&
			!!cart.customer &&
			Math.abs(paid.value) > 0 &&
			settled.value &&
			!submitting.value,
	);

	function build() {
		rows.value = session.paymentMethods.map((method: PaymentMethod) => ({
			mode_of_payment: method.mode_of_payment,
			amount: 0,
			account: method.account,
			type: method.type,
			default: !!method.default,
		}));
	}

	function reset() {
		build();
		lastInvoice.value = null;
	}

	/** The cashier always types a positive magnitude; direction comes from the sale. */
	function setAmount(mode: string, value: number) {
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		row.amount = money(sign.value * Math.max(Math.abs(toNumber(value)), 0));
	}

	function addAmount(mode: string, delta: number) {
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		const magnitude = Math.max(Math.abs(row.amount) + Math.abs(delta), 0);
		row.amount = money(sign.value * magnitude);
	}

	/** Drop the whole balance onto one mode — the common single-tender case. */
	function tenderExact(mode?: string) {
		const target =
			rows.value.find((row) => row.mode_of_payment === mode) ??
			rows.value.find((row) => row.default) ??
			rows.value[0];
		if (!target) return;
		clear();
		// Signed, not clamped: a return has to be able to tender a negative amount
		// or the refund can never be completed.
		target.amount = money(payable.value);
	}

	function clear() {
		for (const row of rows.value) row.amount = 0;
	}

	async function submit(): Promise<Record<string, unknown> | null> {
		if (!canSubmit.value) return null;
		submitting.value = true;
		try {
			// The server is the authority on totals, so always save before tendering.
			const draft = await cart.saveDraft();
			if (!draft?.name) {
				ui.fail("Could not save the invoice");
				return null;
			}

			const invoice = {
				...cart.toInvoicePayload(),
				name: draft.name,
				payments: rows.value
					// Magnitude, not sign: refund rows are negative and a `> 0` test
					// silently drops every one of them, leaving the invoice unpaid.
					.filter((row) => Math.abs(row.amount) > 0)
					.map((row) => ({
						mode_of_payment: row.mode_of_payment,
						amount: row.amount,
						account: row.account,
						type: row.type,
						default: row.default ? 1 : 0,
					})),
				paid_amount: paid.value,
				change_amount: change.value,
			};

			const result = (await api.submitInvoice(invoice, {
				due_date: cart.dueDate ?? undefined,
			})) as Record<string, unknown>;

			lastInvoice.value = result;
			ui.success(
				cart.isReturn ? "Refund complete" : "Sale complete",
				`${result.name ?? draft.name}${change.value ? ` · change ${change.value}` : ""}`,
			);
			return result;
		} catch (error) {
			ui.fail(
				cart.isReturn ? "Could not complete the refund" : "Could not complete the sale",
				error instanceof Error ? error.message : String(error),
			);
			return null;
		} finally {
			submitting.value = false;
		}
	}

	return {
		rows,
		submitting,
		lastInvoice,
		sign,
		paid,
		payable,
		remaining,
		outstanding,
		change,
		settled,
		canSubmit,
		build,
		reset,
		setAmount,
		addAmount,
		tenderExact,
		clear,
		submit,
	};
});
