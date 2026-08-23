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
import type { CreditRow, PaymentMethod } from "@/types";
import { useCartStore } from "./cart";
import { useSessionStore } from "./session";
import { useSyncStore } from "./sync";
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
	const sync = useSyncStore();
	const ui = useUiStore();

	const rows = ref<TenderRow[]>([]);
	/** Credit notes and advances the customer can spend on this sale. */
	const credit = ref<CreditRow[]>([]);
	const loadingCredit = ref(false);
	const submitting = ref(false);
	/** True once the cashier edits amounts by hand — auto-tender then stands down. */
	const touched = ref(false);
	/** The invoice that was just completed, for the success panel and reprint. */
	const lastInvoice = ref<Record<string, unknown> | null>(null);

	/** +1 on a sale, -1 on a return. Money flows the other way on a credit note,
	 *  so every comparison below has to be taken relative to this. */
	const sign = computed(() => (cart.isReturn ? -1 : 1));

	const paid = computed(() => money(rows.value.reduce((sum, row) => sum + toNumber(row.amount), 0)));
	/** Credit the cashier has chosen to spend on this sale. */
	const creditApplied = computed(() =>
		cart.isReturn
			? 0
			: money(credit.value.reduce((sum, row) => sum + toNumber(row.credit_to_redeem), 0)),
	);
	const creditAvailable = computed(() =>
		money(credit.value.reduce((sum, row) => sum + toNumber(row.total_credit), 0)),
	);
	/** Redemption covers part of the total before any cash is counted. */
	const redeemed = computed(() =>
		cart.isReturn ? 0 : money(toNumber(cart.loyaltyAmount) + creditApplied.value),
	);
	const payable = computed(() => money(Math.max(cart.payableAmount - redeemed.value, 0)));
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
		touched.value = false;
	}

	function reset() {
		build();
		credit.value = [];
		lastInvoice.value = null;
	}

	/**
	 * Load the credit sitting on this customer's account.
	 *
	 * Unapplied credit notes and advance payments both count. The list is per
	 * customer, so it is reloaded whenever the customer on the ticket changes; a
	 * stale list would offer credit that belongs to somebody else.
	 */
	async function loadCredit() {
		credit.value = [];
		if (!cart.customer || !session.companyName) return;
		if (!session.profile?.use_customer_credit) return;
		loadingCredit.value = true;
		try {
			const rowsFromServer = (await api.availableCredit(
				cart.customer,
				session.companyName,
			)) as CreditRow[];
			credit.value = (rowsFromServer ?? []).map((row) => ({
				...row,
				total_credit: toNumber(row.total_credit),
				credit_to_redeem: 0,
			}));
		} catch {
			// Credit is an optional convenience; failing to read it must not stop a sale.
		} finally {
			loadingCredit.value = false;
		}
	}

	/** Spend an amount from one credit origin, capped at what it holds. */
	function setCredit(origin: string, value: number) {
		const row = credit.value.find((entry) => entry.credit_origin === origin);
		if (!row) return;
		const cap = toNumber(row.total_credit);
		row.credit_to_redeem = money(Math.min(Math.max(toNumber(value), 0), cap));
		// Credit changes what is left to tender, so any auto-tender has to run again.
		touched.value = false;
		clear();
		tenderExact();
	}

	/** Spend as much credit as the sale can absorb, oldest origin first. */
	function applyMaxCredit() {
		let room = money(Math.max(cart.payableAmount - toNumber(cart.loyaltyAmount), 0));
		for (const row of credit.value) {
			const take = money(Math.min(toNumber(row.total_credit), room));
			row.credit_to_redeem = take;
			room = money(room - take);
		}
		touched.value = false;
		clear();
		tenderExact();
	}

	function clearCredit() {
		for (const row of credit.value) row.credit_to_redeem = 0;
		touched.value = false;
		clear();
		tenderExact();
	}

	/** The cashier always types a positive magnitude; direction comes from the sale. */
	function setAmount(mode: string, value: number) {
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		row.amount = money(sign.value * Math.max(Math.abs(toNumber(value)), 0));
		touched.value = true;
	}

	function addAmount(mode: string, delta: number) {
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		const magnitude = Math.max(Math.abs(row.amount) + Math.abs(delta), 0);
		row.amount = money(sign.value * magnitude);
		touched.value = true;
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

			// Saving can move the total (first-time taxes, discount resolution).
			// While the cashier has not hand-tuned amounts, follow the server so
			// paid_amount lands exactly on grand_total — otherwise submission is
			// rejected for being short or over.
			if (!touched.value) {
				clear();
				tenderExact();
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

			const submitData: Record<string, unknown> = {
				due_date: cart.dueDate ?? undefined,
				redeemed_customer_credit: creditApplied.value || undefined,
				customer_credit_dict: creditApplied.value ? credit.value.filter((row) => toNumber(row.credit_to_redeem) > 0) : undefined,
				credit_change: change.value || undefined,
			};

			let result: Record<string, unknown>;
			try {
				result = (await api.submitInvoice(invoice, submitData)) as Record<string, unknown>;
			} catch (error) {
				// The money is already in the drawer and the goods are with the
				// customer. If the only thing that failed was the network, the sale is
				// parked and replayed; anything the server actually answered is a real
				// refusal and has to reach the cashier.
				if (!session.offlineEnabled || !sync.isConnectivityFailure(error)) throw error;

				const uuid = await sync.enqueue({
					invoice,
					data: submitData,
					summary: {
						customer: cart.customer,
						customer_name: cart.customerInfo?.customer_name ?? cart.customer,
						grand_total: payable.value,
						currency: session.currency,
						item_count: cart.itemCount,
					},
				});
				lastInvoice.value = { name: uuid, __queued: true };
				ui.warn(
					"Saved on this terminal",
					"No connection. The sale sends itself as soon as the network is back.",
				);
				return lastInvoice.value;
			}

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
		credit,
		loadingCredit,
		submitting,
		touched,
		lastInvoice,
		sign,
		paid,
		redeemed,
		creditApplied,
		creditAvailable,
		payable,
		remaining,
		outstanding,
		change,
		settled,
		canSubmit,
		build,
		reset,
		loadCredit,
		setCredit,
		applyMaxCredit,
		clearCredit,
		setAmount,
		addAmount,
		tenderExact,
		clear,
		submit,
	};
});
