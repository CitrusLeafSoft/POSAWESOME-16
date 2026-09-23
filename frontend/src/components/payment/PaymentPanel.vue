<script setup lang="ts">
/** Tender screen. Big targets, tabular numbers, and one obvious primary action. */
import { computed, ref, watch } from "vue";
import {
	ArrowLeft,
	Banknote,
	Check,
	CheckCircle2,
	CloudOff,
	Coins,
	Loader2,
	Printer,
	Plus,
	RotateCcw,
	Smartphone,
	WalletCards,
} from "lucide-vue-next";
import { formatCurrency, formatDate, formatFloat, toNumber } from "@/lib/format";
import { api } from "@/lib/api";
import { usePaymentsStore } from "@/stores/payments";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import { useOffersStore } from "@/stores/offers";
import { useSessionStore } from "@/stores/session";
import type { CreditNoteRow } from "@/types";

const payments = usePaymentsStore();
const cart = useCartStore();
const ui = useUiStore();
const offers = useOffersStore();
const session = useSessionStore();

/** Round-number shortcuts a cashier actually reaches for. */
// const QUICK = [5, 10, 20, 50, 100, 200, 500];

const done = computed(() => !!payments.lastInvoice);
/** A sale parked on the terminal: real to the customer, not yet on the server. */
const queued = computed(() => !!payments.lastInvoice?.__queued);
const isReturn = computed(() => cart.isReturn);

/** Credit only shows when the profile allows it and the customer actually has some. */
const canUseCredit = computed(
	() => !isReturn.value && !!session.profile?.use_customer_credit && payments.credit.length > 0,
);
/** Credit notes are their own choice, shown separately from advance credit. */
const canUseCreditNotes = computed(
	() => !isReturn.value && !!session.profile?.use_customer_credit && payments.creditNotes.length > 0,
);

/** The original invoice a credit note was issued against. */
function creditNoteAgainst(row: CreditNoteRow): string {
	return row.return_against ?? "";
}
// const mpesaEnabled = computed(() => !!session.profile?.posa_allow_mpesa_reconcile_payments);
/** Loyalty redemption shows whenever the customer carries a balance to spend. */
const canRedeem = computed(
	() =>
		!isReturn.value &&
		toNumber(cart.customerInfo?.loyalty_points) > 0 &&
		toNumber(cart.customerInfo?.conversion_factor) > 0 && !!session.profile?.posa_allow_loyalty_redemption,
);
/** The Mode of Payment treated as credit (its tender stays outstanding). */
const CREDIT_MODE = "Credit";
/** Mode of Payment for EDC machine tenders, shown read-only with its total. */
const PAYTM_MODE = "Paytm Machine";
/** Tender modes the cashier can type into — Paytm machine is handled separately. */
const manualRows = computed(() => payments.rows.filter((row) => row.mode_of_payment !== PAYTM_MODE));

// Totals can settle after entry (taxes arriving with the draft save); while the
// cashier has not touched the amounts, keep tender pinned to what is owed.
watch(
	() => payments.payable,
	() => {
		if (!done.value && !payments.touched) payments.tenderExact();
	},
);

// Credit and credit notes belong to a customer, so a stale list would offer
// somebody else's money.
watch(
	() => cart.customer,
	() => {
		void payments.loadCredit();
		void payments.loadCreditNotes();
	},
	{ immediate: true },
);

function back() {
	ui.setWorkspace("catalog");
}

async function complete() {
	const result = await payments.submit();
	if (!result) return;
	// Keep the receipt on screen; the cart is cleared when the cashier moves on.
	offers.reset();
}

function nextSale() {
	cart.reset();
	payments.reset();
	offers.reset();
	ui.setWorkspace("catalog");
}

function commitRedemption(event: Event) {
	const raw = (event.target as HTMLInputElement).value.trim();
	cart.setLoyaltyRedemption(toNumber(raw));
	// payments.tenderExact();
	payments.balanceTender();
}

/** Open the in-page print dialog; the browser's print sheet stays over this view. */
function print() {
	const name = payments.lastInvoice?.name as string | undefined;
	if (!name || queued.value) return;
	ui.openModal("print", { invoiceName: name });
}

/** Track when the cashier is typing in the Paytm box so the auto-refill stands down. */
function onPaytmFocus() {
	payments.setPaytmEditing(true);
}

function onPaytmBlur() {
	payments.setPaytmEditing(false);
}

// function openMpesa() {
// 	ui.openModal("mpesa");
// }

function openLoyaltyDetails() {
	ui.openModal("loyaltyDetails");
}

/** Amount typed into the Paytm machine box, and whether a request is in flight. */
const paytmProcessing = ref(false);
const paytmStatus = ref("");
/** Seconds left before the Paytm request is abandoned, shown while in flight. */
const paytmRemaining = ref(0);
let paytmTimer: number | undefined;

/**
 * Fire a sale request at the Paytm EDC machine and poll the status enquiry until
 * the machine confirms the money. On success the amount is added to the Paytm
 * Machine tender row, which flows onto the Sales Invoice and back into the panel.
 */
async function payByPaytm() {
	const amount = toNumber(payments.paytmBox);
	if (!amount || amount <= 0) {
		ui.warn("Enter an amount", "Type how much to take through the Paytm machine.");
		return;
	}
	// The Paytm machine cannot take more than is still owed on this sale.
	const outstanding = payments.outstanding;
	if (amount > outstanding) {
		ui.warn(
			"Amount exceeds the balance",
			`Only ${formatCurrency(outstanding)} is still owed on this sale.`,
		);
		return;
	}
	paytmProcessing.value = true;
	paytmStatus.value = "Contacting Paytm machine…";
	try {
		// Make sure there is a draft invoice to record the transaction against.
		let invoiceName: string | undefined = cart.invoiceName ?? undefined;
		if (!invoiceName) {
			const draft = await cart.saveDraft();
			invoiceName = (draft?.name as string) ?? undefined;
		}

		const initiated = (await api.initiatePaytmPayment(amount, invoiceName)) as Record<string, unknown>;
		if (!initiated.payment_status) {
			throw new Error((initiated.message as string) || "Could not reach the Paytm machine.");
		}
		const refId = initiated.merchant_transaction_id as string;

		const deadline = Date.now() + 120_000;
		paytmRemaining.value = Math.ceil((deadline - Date.now()) / 1000);
		if (paytmTimer !== undefined) window.clearInterval(paytmTimer);
		paytmTimer = window.setInterval(() => {
			const left = Math.ceil((deadline - Date.now()) / 1000);
			paytmRemaining.value = Math.max(left, 0);
			if (left <= 0 && paytmTimer !== undefined) {
				window.clearInterval(paytmTimer);
				paytmTimer = undefined;
			}
		}, 1000);

		for (; ;) {
			await new Promise((resolve) => setTimeout(resolve, 10000));

			const result = (await api.checkPaytmPaymentStatus(refId, invoiceName)) as Record<string, any>;

			const response = typeof result.response === "string"
								? JSON.parse(result.response)
								: result.response;
			const status = response?.status as string | undefined;
			const verified = response?.verified as boolean | undefined;

			if (status == "VERIFIED" && verified) {
				payments.applyPaytmPayment(amount);
				paytmStatus.value = "";
				payments.syncPaytmBox();

				ui.success(
					"Paytm payment received",
					`${formatCurrency(amount)} added to this sale`,
				);

				return;
			}

			if (!verified && status == "FAILED") {
				throw new Error(
					(response?.message as string) || "Paytm machine declined the payment.",
				);
			}

			if (!verified && (status === "TIMEOUT" || status === "PENDING")) {
				paytmStatus.value =
					"Payment is still pending. Please check the payment status before retrying.";

				return;
			}

			paytmStatus.value = "Waiting for the customer to pay…";

			if (Date.now() > deadline) {
				throw new Error(
					"Timed out waiting for the Paytm machine. Please check the payment status before retrying.",
				);
			}
		}
	} catch (error) {
		ui.fail("Paytm payment failed", error instanceof Error ? error.message : String(error));
	} finally {
		if (paytmTimer !== undefined) {
			window.clearInterval(paytmTimer);
			paytmTimer = undefined;
		}
		paytmRemaining.value = 0;
		paytmProcessing.value = false;
		paytmStatus.value = "";
	}
}
</script>

<template>
	<section class="panel flex h-full min-h-0 flex-col overflow-hidden">
		<!-- Success state -->
		<div v-if="done" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
			<span class="grid size-16 place-items-center rounded-full animate-pop-in"
				:class="queued ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'">
				<CloudOff v-if="queued" class="size-8" />
				<CheckCircle2 v-else class="size-8" />
			</span>
			<div>
				<h2 class="text-lg font-semibold">
					{{ queued ? "Saved on this terminal" : isReturn ? "Refund complete" : "Sale complete" }}
				</h2>
				<p v-if="queued" class="mx-auto mt-1 max-w-[19rem] text-xs text-muted">
					There is no connection, so this sale is waiting on the till. It sends itself as
					soon as the network is back — take the money and hand over the goods.
				</p>
				<p v-else class="mt-0.5 font-mono text-xs text-subtle">{{ payments.lastInvoice?.name }}</p>
			</div>

			<div v-if="payments.change > 0" class="panel bg-surface-2 px-6 py-4">
				<p class="text-xs font-medium uppercase tracking-wide text-subtle">
					{{ isReturn ? "Over-refunded" : "Change due" }}
				</p>
				<p class="mt-0.5 text-3xl font-bold tnum text-warning">{{ formatCurrency(payments.change) }}</p>
			</div>

			<div class="mt-2 flex w-full max-w-xs flex-col gap-2">
				<button type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
					@click="nextSale">
					<Plus class="size-4" />
					New sale
				</button>
				<button type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card border border-line font-medium text-muted transition hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
					:disabled="queued" :title="queued ? 'Available once the sale has been sent' : undefined"
					@click="print">
					<Printer class="size-4" />
					Print receipt
				</button>
			</div>
		</div>

		<!-- Tender state -->
		<template v-else>
			<header class="flex shrink-0 items-center gap-2 border-b border-line p-3">
				<button type="button"
					class="grid size-9 place-items-center rounded-card text-muted transition hover:bg-surface-2 hover:text-fg"
					aria-label="Back to catalog" @click="back">
					<ArrowLeft class="size-4.5" />
				</button>
				<h2 class="text-sm font-semibold">{{ isReturn ? "Refund" : "Payment" }}</h2>
				<span class="ml-auto text-right">
					<span class="block text-[11px] uppercase tracking-wide text-subtle">
						{{ isReturn ? "Refund due" : "Due" }}
					</span>
					<span class="block text-lg font-bold tnum leading-tight" :class="isReturn && 'text-danger'">{{
						formatCurrency(Math.abs(payments.payable)) }}</span>
				</span>
			</header>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
				<!-- Loyalty redemption — points settle part of the total before cash -->
				<div v-if="canRedeem"
					class="flex items-center gap-2 rounded-card border border-dashed border-violet/40 bg-violet-soft/40 p-2">
					<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-soft text-violet">
						<Coins class="size-4" />
					</span>
					<label class="min-w-0 flex-1 text-sm font-medium" for="loyalty-redeem">
						Redeem loyalty
						<span class="block text-[11px] font-normal text-subtle">
							{{ formatFloat(cart.customerInfo?.loyalty_points ?? 0, 0) }} pts available ·
							{{ formatCurrency(cart.maxLoyaltyAmount) }}
						</span>
					</label>

					<label class="flex cursor-pointer items-center gap-1.5" for="do-not-create-loyalty-points">
						<input id="do-not-create-loyalty-points" type="checkbox"
							class="size-3.5 shrink-0 rounded border-line accent-violet"
							:checked="payments.dontCreateLoyaltyPoints"
							@change="payments.dontCreateLoyaltyPoints = ($event.target as HTMLInputElement).checked" />
						<span class="px-1 py-1 text-[11px] font-semibold text-violet">
							Don't Create Loyalty Points
						</span>
					</label>
					<span>
						<button @click="openLoyaltyDetails"
							class="px-1.5 py-1 text-[11px] font-semibold text-violet hover:underline">
							See details
						</button>
					</span>
					<input id="loyalty-redeem" :value="cart.loyaltyAmount || ''" type="text" inputmode="decimal"
						placeholder="0.00"
						class="h-10 w-28 rounded-card border-line bg-surface text-right text-sm font-semibold tnum focus:border-accent focus:ring-0"
						@focus="($event.target as HTMLInputElement).select()" @change="commitRedemption($event)" />
				</div>
				<!-- Modes -->
				<div class="space-y-2">
					<template v-for="row in manualRows" :key="row.mode_of_payment">
						<div v-if="!isReturn || row.mode_of_payment !== CREDIT_MODE"
							class="flex items-center gap-2 rounded-card border border-line bg-surface p-2 shadow-xs transition focus-within:border-accent">
							<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
								<Banknote class="size-4" />
							</span>

							<label class="min-w-0 flex-1 truncate text-sm font-medium"
								:for="`pay-${row.mode_of_payment}`">
								{{ row.mode_of_payment }}

								<span v-if="row.mode_of_payment === CREDIT_MODE"
									class="ms-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
									Credit
								</span>
							</label>

							<input :id="`pay-${row.mode_of_payment}`" :value="row.amount ? Math.abs(row.amount) : ''"
								type="text" inputmode="decimal" placeholder="0.00"
								class="h-10 w-32 rounded-card border-line bg-surface-2 text-right text-base font-semibold tnum focus:border-accent focus:ring-0"
								@focus="($event.target as HTMLInputElement).select()" @input="payments.setAmount(
									row.mode_of_payment,
									toNumber(($event.target as HTMLInputElement).value)
								)" />
						</div>
					</template>

					<div v-if="payments.paytmTotal > 0"
						class="flex items-center gap-2 rounded-card border border-dashed border-accent/50 bg-accent-soft/30 p-2">
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
							<Smartphone class="size-4" />
						</span>

						<label class="min-w-0 flex-1 truncate text-sm font-medium">
							Paytm Machine
							<span
								class="ms-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
								Paid
							</span>
						</label>

						<span class="text-base font-bold tnum text-accent">
							{{ formatCurrency(payments.paytmTotal) }}
						</span>
					</div>
				</div>

				<!-- Paytm Machine: take a card/QR payment on the EDC terminal. The amount
				     stays here until the machine confirms, then it lands on the ticket. -->
				<div v-if="!isReturn">
					<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Paytm Machine</p>
					<div
						class="flex items-center gap-2 rounded-card border border-dashed border-accent/50 bg-accent-soft/30 p-2">
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
							<Smartphone class="size-4" />
						</span>
						<input v-model="payments.paytmBox" type="text" inputmode="decimal" placeholder="0.00"
							class="h-10 w-32 rounded-card border-line bg-surface text-right text-sm font-semibold tnum focus:border-accent focus:ring-0"
							@focus="($event.target as HTMLInputElement).select(); onPaytmFocus()" @blur="onPaytmBlur()"
							@keydown.enter.prevent="payByPaytm" />
						<button type="button"
							class="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-card bg-accent px-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
							:disabled="paytmProcessing" @click="payByPaytm">
							<Loader2 v-if="paytmProcessing" class="size-4 animate-spin" />
							<span v-else>Pay</span>
						</button>
					</div>
					<p v-if="paytmStatus" class="mt-1 text-[11px] text-muted">
						{{ paytmStatus }}
						<!-- <span v-if="paytmProcessing && paytmRemaining > 0" class="ms-1 font-semibold tnum text-accent">
						{{ paytmRemaining }}s left
					</span> -->
					</p>
				</div>

				<!-- Customer credit — unapplied credit notes and advances on the account -->
				<div v-if="canUseCredit" class="space-y-2 rounded-card border border-info/40 bg-info-soft/40 p-2">
					<div class="flex items-center gap-2">
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-info-soft text-info">
							<WalletCards class="size-4" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">Customer credit</p>
							<p class="text-[11px] text-subtle">
								{{ formatCurrency(payments.creditAvailable) }} available ·
								{{ formatCurrency(payments.creditApplied) }} applied
							</p>
						</div>
						<button type="button"
							class="h-8 rounded-card border border-info px-2.5 text-xs font-semibold text-info transition hover:opacity-85"
							@click="payments.applyMaxCredit()">
							Use max
						</button>
						<button v-if="payments.creditApplied > 0" type="button"
							class="h-8 rounded-card px-2 text-xs font-medium text-subtle transition hover:text-danger"
							@click="payments.clearCredit()">
							Clear
						</button>
					</div>

					<div v-for="row in payments.credit" :key="row.credit_origin" class="flex items-center gap-2 ps-11">
						<label class="min-w-0 flex-1 truncate text-xs" :for="`credit-${row.credit_origin}`">
							<span class="font-medium">{{ row.type }}</span>
							<span class="ms-1 font-mono text-subtle">{{ row.credit_origin }}</span>
							<span class="ms-1 tnum text-subtle">· {{ formatCurrency(row.total_credit) }}</span>
						</label>
						<input :id="`credit-${row.credit_origin}`" :value="row.credit_to_redeem || ''" type="text"
							inputmode="decimal" placeholder="0.00"
							class="h-9 w-24 rounded-card border-line bg-surface text-right text-sm font-semibold tnum focus:border-info focus:ring-0"
							@focus="($event.target as HTMLInputElement).select()"
							@change="payments.setCredit(row.credit_origin, toNumber(($event.target as HTMLInputElement).value))" />
					</div>
				</div>



				<!-- Credit notes — returned invoices the customer can spend. Separate
				     from the advance credit above: checking a note applies its whole
				     remaining balance, and the cash due drops at once. -->
				<div v-if="canUseCreditNotes"
					class="space-y-2 rounded-card border border-success/40 bg-success-soft/30 p-2">
					<div class="flex items-center gap-2">
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
							<RotateCcw class="size-4" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">Credit notes</p>
							<p class="text-[11px] text-subtle">
								{{ formatCurrency(payments.creditNoteAvailable) }} available ·
								{{ formatCurrency(payments.creditNoteApplied) }} applied
							</p>
						</div>
						<button v-if="payments.creditNoteApplied > 0" type="button"
							class="h-8 rounded-card px-2 text-xs font-medium text-subtle transition hover:text-danger"
							@click="payments.clearCreditNotes()">
							Clear
						</button>
					</div>

					<div v-for="row in payments.creditNotes" :key="row.name" class="flex items-start gap-2 ps-11">
						<input :id="`credit-note-${row.name}`" type="checkbox"
							class="mt-1 size-4 shrink-0 rounded border-line accent-accent" :checked="!!row.selected"
							@change="payments.toggleCreditNote(row.name, ($event.target as HTMLInputElement).checked)" />
						<label class="min-w-0 flex-1 cursor-pointer" :for="`credit-note-${row.name}`">
							<span class="flex items-center gap-1.5 text-xs font-medium">
								<span class="truncate">Credit note</span>
								<span class="shrink-0 font-mono font-normal text-subtle">{{ row.name }}</span>
							</span>
							<span class="block text-[11px] text-subtle">
								{{ formatDate(row.posting_date as string) }} ·
								{{ formatCurrency(row.total_credit) }} available
								<template v-if="creditNoteAgainst(row)">
									· against {{ creditNoteAgainst(row) }}
								</template>
							</span>
						</label>
						<span class="shrink-0 text-right text-xs font-semibold tnum">
							<span v-if="toNumber(row.credit_to_redeem) > 0" class="text-success">
								−{{ formatCurrency(row.credit_to_redeem) }}
							</span>
							<span v-else class="text-subtle">0</span>
						</span>
					</div>
				</div>

				<!-- M-Pesa: reconcile a transaction the customer has already sent -->
				<!-- <button
					v-if="mpesaEnabled"
					type="button"
					class="flex w-full items-center gap-2 rounded-card border border-dashed border-success/50 bg-success-soft/30 p-2 text-left transition hover:border-success"
					@click="openMpesa"
				>
					<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
						<Smartphone class="size-4" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">M-Pesa</span>
						<span class="block text-[11px] text-subtle">Match a transaction the customer has paid</span>
					</span>
				</button> -->

				<!-- Quick cash -->
				<!-- <div>
					<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Quick add</p>
					<div class="flex flex-wrap gap-1.5">
						<button v-for="amount in QUICK" :key="amount" type="button"
							class="h-9 min-w-14 rounded-card border border-line bg-surface px-3 text-sm font-semibold tnum shadow-xs transition hover:border-accent hover:text-accent"
							@click="payments.addAmount(payments.rows.find((r) => r.default)?.mode_of_payment ?? payments.rows[0]?.mode_of_payment ?? '', amount)">
							+{{ amount }}
						</button>
						<button type="button"
							class="h-9 rounded-card border border-accent bg-accent-soft px-3 text-sm font-semibold text-accent transition hover:opacity-85"
							@click="payments.tenderExact()">
							Exact
						</button>
						<button type="button"
							class="h-9 rounded-card border border-line px-3 text-sm font-medium text-muted transition hover:bg-surface-2"
							@click="payments.clear()">
							Clear
						</button>
					</div>
				</div> -->
			</div>

			<footer class="shrink-0 space-y-2 border-t border-line p-3">
				<div class="flex justify-between text-sm">
					<span class="text-muted">{{ isReturn ? "Refunded" : "Tendered" }}</span>
					<span class="font-semibold tnum">{{ formatCurrency(Math.abs(payments.paid)) }}</span>
				</div>
				<div v-if="payments.creditTendered > 0 && !isReturn" class="flex justify-between text-sm">
					<span class="text-warning">On credit</span>
					<span class="font-semibold tnum text-warning">{{ formatCurrency(payments.creditTendered) }}</span>
				</div>
				<div v-if="payments.creditNoteApplied > 0 && !isReturn" class="flex justify-between text-sm">
					<span class="text-success">By credit note</span>
					<span class="font-semibold tnum text-success">−{{ formatCurrency(payments.creditNoteApplied)
					}}</span>
				</div>
				<div class="flex justify-between text-sm">
					<span :class="payments.outstanding > 0 ? 'text-danger' : 'text-muted'">
						{{
							payments.outstanding > 0
								? isReturn
									? "Still to refund"
									: "Still owed"
								: isReturn
									? "Over-refunded"
									: "Change"
						}}
					</span>
					<span class="font-bold tnum" :class="payments.outstanding > 0 ? 'text-danger' : 'text-success'">
						{{ formatCurrency(payments.outstanding > 0 ? payments.outstanding : payments.change) }}
					</span>
				</div>

				<button type="button"
					class="flex h-13 w-full items-center justify-center gap-2 rounded-card text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none"
					:class="isReturn ? 'bg-danger' : 'bg-success'" :disabled="!payments.canSubmit" @click="complete">
					<Loader2 v-if="payments.submitting" class="size-5 animate-spin" />
					<Check v-else class="size-5" />
					{{
						payments.submitting
							? isReturn
								? "Refunding…"
								: "Completing…"
							: isReturn
								? "Complete refund"
								: "Complete sale"
					}}
				</button>
			</footer>
		</template>
	</section>
</template>
