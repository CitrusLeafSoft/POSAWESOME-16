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
import type { CreditNoteRow, CreditRow, PaymentMethod } from "@/types";
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
	/** Credit notes (returned sales invoices, is_return=1) the customer can spend.
	 *  Kept apart from `credit` (advances) so the two choices stay independent. */
	const creditNotes = ref<CreditNoteRow[]>([]);
	const loadingCreditNotes = ref(false);
	const submitting = ref(false);
	/** True once the cashier edits amounts by hand — auto-tender then stands down. */
	const touched = ref(false);
	/** The invoice that was just completed, for the success panel and reprint. */
	const lastInvoice = ref<Record<string, unknown> | null>(null);

	/** +1 on a sale, -1 on a return. Money flows the other way on a credit note,
	 *  so every comparison below has to be taken relative to this. */
	const sign = computed(() => (cart.isReturn ? -1 : 1));

	/** The Mode of Payment whose tender is treated as credit, not cash taken. */
	const CREDIT_MODE = "Credit";

	/** A tender row routed to the credit mode is credit — it stays outstanding and
	 *  is never booked as a payment, so the invoice can go through approval. */
	function isCreditRow(row: TenderRow): boolean {
		return row.mode_of_payment === CREDIT_MODE;
	}

	/** Money actually taken from the customer — credit-mode lines are excluded. */
	const paid = computed(() =>
		money(
			rows.value.filter((row) => !isCreditRow(row)).reduce((sum, row) => sum + toNumber(row.amount), 0),
		),
	);
	/** The value placed on the customer's credit instead of being paid (sales only). */
	const creditTendered = computed(() =>
		cart.isReturn ? 0 : money(rows.value.filter(isCreditRow).reduce((sum, row) => sum + toNumber(row.amount), 0)),
	);
	/** True once a credit-mode line is on the ticket, so the invoice is a credit sale. */
	const isPosCredit = computed(() => !cart.isReturn && creditTendered.value > 0);
	/** Credit the cashier has chosen to spend on this sale. */
	const creditApplied = computed(() =>
		cart.isReturn
			? 0
			: money(credit.value.reduce((sum, row) => sum + toNumber(row.credit_to_redeem), 0)),
	);
	const creditAvailable = computed(() =>
		money(credit.value.reduce((sum, row) => sum + toNumber(row.total_credit), 0)),
	);

	const creditNoteApplied = computed(() =>
		cart.isReturn
			? 0
			: money(creditNotes.value.reduce((sum, row) => sum + toNumber(row.credit_to_redeem), 0)),
	);
	const creditNoteAvailable = computed(() =>
		money(creditNotes.value.reduce((sum, row) => sum + toNumber(row.total_credit), 0)),
	);
	/** Redemption covers part of the total before any cash is counted. */
	const redeemed = computed(() =>
		cart.isReturn ? 0 : money(toNumber(cart.loyaltyAmount) + creditApplied.value),
	);
	const payable = computed(() => {
		const gross = cart.payableAmount - redeemed.value - creditNoteApplied.value;
		// Only a sale can never fall below zero. A refund's total is negative by
		// design, and clamping it to zero left nothing to tender — so `canSubmit`,
		// which wants a non-zero paid amount, refused every refund outright.
		return money(cart.isReturn ? gross : Math.max(gross, 0));
	});
	/** Signed shortfall: still owed on a sale, still to refund on a return. */
	const remaining = computed(() => money(payable.value - paid.value));
	/** Magnitude still outstanding, whichever way the money is moving. */
	const outstanding = computed(() => money(Math.max(sign.value * remaining.value, 0)));
	/** Over-tender: change owed to the customer, or an over-refund. */
	const change = computed(() => money(Math.max(sign.value * (paid.value - payable.value), 0)));
	const settled = computed(() => sign.value * remaining.value <= 0);
	const allowPartialPayment = computed(() => !!session.profile?.posa_allow_partial_payment);
    const allowCreditSale = computed(() => !!session.profile?.posa_allow_credit_sale);

    /** Nothing is left genuinely unpaid once cash, customer credit and POS credit
	 *  are all put on the ticket. */
    const covered = computed(() =>
		money(sign.value * (payable.value - paid.value - creditTendered.value)) <= 0,
	);

    const canSubmit = computed(
        () =>
			!cart.isEmpty &&
			!!cart.customer &&
			!submitting.value &&
			(
				allowCreditSale.value ||
				// A credit tender covers what cash doesn't — the invoice goes to approval.
				(creditTendered.value > 0 && covered.value) ||
				// Cash / bank tender: settled, or the profile tolerates a partial pay.
				// A credit-note covered ticket settles with no cash leg at all, so
				// `paid` may be zero there.
				((Math.abs(paid.value) > 0 || creditNoteApplied.value > 0) &&
					(covered.value || allowPartialPayment.value))
			),
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
		creditNotes.value = [];
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

	async function loadCreditNotes() {
		creditNotes.value = [];
		if (!cart.customer || !session.companyName) return;
		if (!session.profile?.use_customer_credit) return;
		loadingCreditNotes.value = true;
		try {
			const rowsFromServer = (await api.availableCreditNotes(
				cart.customer,
				session.companyName,
			)) as CreditNoteRow[];
			creditNotes.value = (rowsFromServer ?? []).map((row) => ({
				...row,
				total_credit: toNumber(row.total_credit),
				credit_to_redeem: 0,
				selected: false,
			}));
		} catch {
			// Credit is an optional convenience; failing to read it must not stop a sale.
		} finally {
			loadingCreditNotes.value = false;
		}
	}

	function toggleCreditNote(origin: string, selected: boolean) {
		const row = creditNotes.value.find((entry) => entry.name === origin);
		if (!row) return;
		row.selected = selected;
		if (!selected) row.credit_to_redeem = 0;
		touched.value = false;
		rebalanceCreditNotes();
	}

	function rebalanceCreditNotes() {
		let room = money(
			Math.max(
				cart.payableAmount - toNumber(cart.loyaltyAmount) - creditApplied.value,
				0,
			),
		);
		for (const row of creditNotes.value) {
			if (!row.selected) {
				row.credit_to_redeem = 0;
				continue;
			}
			const take = money(Math.min(toNumber(row.total_credit), room));
			row.credit_to_redeem = take;
			room = money(room - take);
		}
		// Credit changes what is left to tender, so any auto-tender has to run again.
		touched.value = false;
		balanceTender();
	}

	/** Release every credit note back to the customer. */
	function clearCreditNotes() {
		for (const row of creditNotes.value) {
			row.selected = false;
			row.credit_to_redeem = 0;
		}
		touched.value = false;
		balanceTender();
	}

	/** Spend an amount from one credit origin, capped at what it holds. */
	function setCredit(origin: string, value: number) {
		console.log("setCredit")
		const row = credit.value.find((entry) => entry.credit_origin === origin);
		if (!row) return;
		const cap = toNumber(row.total_credit);
		row.credit_to_redeem = money(Math.min(Math.max(toNumber(value), 0), cap));
		// Credit changes what is left to tender, so any auto-tender has to run again.
		touched.value = false;
		// clear();
		// tenderExact();
		balanceTender();
	}

	/** Spend as much credit as the sale can absorb, oldest origin first. */
	function applyMaxCredit() {
		console.log("applyMaxCredit")
		let room = money(Math.max(cart.payableAmount - toNumber(cart.loyaltyAmount), 0));
		for (const row of credit.value) {
			const take = money(Math.min(toNumber(row.total_credit), room));
			row.credit_to_redeem = take;
			room = money(room - take);
		}
		touched.value = false;
		// clear();
		// tenderExact();
		balanceTender();
	}

	function clearCredit() {
		console.log("clearCredit")
		console.log(credit,credit.value,"===================credit value")
		for (const row of credit.value) row.credit_to_redeem = 0;
		touched.value = false;
		// clear();
		// tenderExact();
		balanceTender();
	}

	/** The cashier always types a positive magnitude; direction comes from the sale. */
	function setAmount(mode: string, value: number) {
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		row.amount = money(sign.value * Math.max(Math.abs(toNumber(value)), 0));
		touched.value = true;
	}

	function addAmount(mode: string, delta: number) {
		console.log("addAmount")
		const row = rows.value.find((entry) => entry.mode_of_payment === mode);
		if (!row) return;
		const magnitude = Math.max(Math.abs(row.amount) + Math.abs(delta), 0);
		row.amount = money(sign.value * magnitude);
		touched.value = true;
	}
	function balanceTender() {
		const target =
			rows.value.find((row) => row.default) ??
			rows.value.find((row) => row.amount) ??
			rows.value[0];
		if (!target) return;
		const entered = rows.value
			.filter((row) => row.mode_of_payment !== target.mode_of_payment)
			.reduce((sum, row) => sum + toNumber(row.amount), 0);
		// Signed, not clamped: refunds have to be able to go negative.
		target.amount = money(payable.value - entered);
	}
	/** Drop the whole balance onto one mode — the common single-tender case. */
	function tenderExact(mode?: string) {
		console.log("tenderExact")
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

	/** Offline-capable, and the thing that failed was the network rather than a rule. */
	function canQueue(error: unknown): boolean {
		return session.offlineEnabled && sync.isConnectivityFailure(error);
	}

	/** Everything `submit_invoice` would have received, built from local state. */
	function buildPayload(draftName?: string) {
		const invoice = {
			...cart.toInvoicePayload(),
			name: draftName,
			payments: rows.value
				// Magnitude, not sign: refund rows are negative and a `> 0` test
				// silently drops every one of them, leaving the invoice unpaid.
				// Credit-mode lines are also dropped — that value stays outstanding,
				// it is never booked as a payment.
				.filter((row) => Math.abs(row.amount) > 0 && !isCreditRow(row))
				.map((row) => ({
					mode_of_payment: row.mode_of_payment,
					amount: row.amount,
					account: row.account,
					type: row.type,
					default: row.default ? 1 : 0,
				})),
			paid_amount: paid.value,
			change_amount: change.value,
			// A credit tender turns the invoice into a credit sale that needs approval.
			custom_is_pos_credit: isPosCredit.value ? 1 : 0,
		};

		const applied = money(creditApplied.value + creditNoteApplied.value);

		const data: Record<string, unknown> = {
			due_date: cart.dueDate ?? undefined,
			redeemed_customer_credit: applied || undefined,
			customer_credit_dict: applied
				? [
						...credit.value.filter((row) => toNumber(row.credit_to_redeem) > 0),
						...creditNotes.value
							.filter((row) => toNumber(row.credit_to_redeem) > 0)
							.map((row) => ({
								type: row.type,
								credit_origin: row.name,
								total_credit: row.total_credit,
								credit_to_redeem: row.credit_to_redeem,
							})),
				  ]
				: undefined,
			credit_change: change.value || undefined,
		};

		return { invoice, data };
	}

	/**
	 * Park a completed sale on the terminal.
	 *
	 * The money is in the drawer and the goods have gone, so this must not fail
	 * quietly — if even the local write fails there is nothing left holding the sale
	 * and the cashier has to be told.
	 */
	async function queueSale(invoice: Record<string, unknown>, data: Record<string, unknown>) {
		try {
			return await parkSale(invoice, data);
		} catch (error) {
			// Nothing is holding this sale now — not the server, not the terminal. The
			// cashier has to know before the customer walks away.
			ui.notify({
				title: "This sale was NOT saved",
				detail:
					"No connection, and this terminal cannot store it either. Do not hand over the goods — write the sale down and re-enter it once the connection is back.",
				tone: "danger",
				duration: 0,
			});
			throw error;
		}
	}

	async function parkSale(invoice: Record<string, unknown>, data: Record<string, unknown>) {
		const uuid = await sync.enqueue({
			invoice,
			data,
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
			"Held on this terminal",
			"No connection. It sends itself as soon as the network is back — take the money and hand over the goods.",
		);
		return lastInvoice.value;
	}

	async function submit(): Promise<Record<string, unknown> | null> {
		console.log("submit")
		if (!canSubmit.value) return null;
		submitting.value = true;
		try {
			// Settle the totals on the server when there is one: saving can move them
			// (first-time taxes, discount resolution), and tendering against a figure the
			// server is about to change is how "Pay" ends up rejecting a good sale.
			//
			// Offline there is nothing to settle against, so the local figures stand —
			// they come from the same arithmetic, and the server re-checks everything when
			// the queue drains.
			let draftName: string | undefined;
			try {
				const draft = await cart.saveDraft();
				draftName = draft?.name as string | undefined;
				if (!draftName) {
					ui.fail("Could not save the invoice");
					return null;
				}
				if (!touched.value) {
					console.log("submit touch")
					clear();
					tenderExact();
				}
			} catch (error) {
				// This is where an offline sale used to die: the draft save threw before
				// anything had a chance to queue, and the cashier saw a bare "Offline".
				if (!canQueue(error)) throw error;
				const parked = buildPayload();
				return await queueSale(parked.invoice, parked.data);
			}

			const { invoice, data } = buildPayload(draftName);

			let result: Record<string, unknown>;
			try {
				result = (await api.submitInvoice(invoice, data)) as Record<string, unknown>;
			} catch (error) {
				// Anything the server actually answered — negative stock, a permission
				// refusal — is a real decision and has to reach the cashier. Only a
				// transport failure is replayable.
				if (!canQueue(error)) throw error;
				return await queueSale(invoice, data);
			}

			lastInvoice.value = result;
			ui.success(
				!!result.__credit_pending
					? "Sale held for credit approval"
					: !!result.__discount_pending
						? "Sale held for discount approval"
						: cart.isReturn
							? "Refund complete"
							: "Sale complete",
				!!result.__credit_pending || !!result.__discount_pending
					? `${result.name ?? draftName} · awaiting approval`
					: `${result.name ?? draftName}${change.value ? ` · change ${change.value}` : ""}`,
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
		creditNotes,
		loadingCreditNotes,
		submitting,
		touched,
		lastInvoice,
		sign,
		paid,
		creditTendered,
		isPosCredit,
		redeemed,
		creditApplied,
		creditAvailable,
		creditNoteApplied,
		creditNoteAvailable,
		payable,
		remaining,
		outstanding,
		change,
		settled,
		canSubmit,
		build,
		reset,
		loadCredit,
		loadCreditNotes,
		toggleCreditNote,
		clearCreditNotes,
		setCredit,
		applyMaxCredit,
		clearCredit,
		setAmount,
		addAmount,
		tenderExact,
		balanceTender,
		clear,
		submit,
	};
});
