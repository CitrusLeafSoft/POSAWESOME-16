/**
 * Freeze probe.
 *
 * Mounts the sell screen against seeded stores and a stubbed backend, drives it the
 * way a cashier would, and reports whether Vue is looping. A "frozen" POS is almost
 * always Vue hitting its recursive-update ceiling: it logs once and then wedges the
 * render loop, which is invisible unless something is watching the console.
 *
 * Boot is bypassed on purpose — the point is the sell screen, not the shift dialog.
 * Development entry only; not in the production build.
 */
// chrome-headless-shell has no IndexedDB, so the offline queue cannot be exercised
// without one. Installed before anything imports lib/db.ts, which opens Dexie on load.
import "fake-indexeddb/auto";
import { createApp, h } from "vue";
import { createPinia } from "pinia";
import SellView from "./views/SellView.vue";
import ToastHost from "./components/layout/ToastHost.vue";
import ModalHost from "./components/layout/ModalHost.vue";
import { configureFormatting } from "./lib/format";
import { initHotkeys } from "./lib/hotkeys";
import { initTheme } from "./lib/theme";
import { useCartStore } from "./stores/cart";
import { useCatalogStore } from "./stores/catalog";
import { useOffersStore } from "./stores/offers";
import { usePaymentsStore } from "./stores/payments";
import { useSessionStore } from "./stores/session";
import { useUiStore } from "./stores/ui";
import { useSyncStore } from "./stores/sync";
import type { Item } from "./types";
import "./styles/main.css";

/* ---- console capture --------------------------------------------------- */
const seen = new Map<string, number>();
const bump = (kind: string, text: string) => {
	const key = `${kind}: ${text.slice(0, 150)}`;
	seen.set(key, (seen.get(key) ?? 0) + 1);
};
const realWarn = console.warn.bind(console);
console.warn = (...a: unknown[]) => { bump("warn", a.map(String).join(" ")); realWarn(...a); };
addEventListener("error", (e) => bump("uncaught", String(e.message)));
addEventListener("unhandledrejection", (e) => bump("rejection", String((e as PromiseRejectionEvent).reason)));

/* ---- count how often the offer engine runs ----------------------------- */
let refreshCalls = 0;

/* ---- stubbed backend --------------------------------------------------- */
const OFFER = {
	name: "Probe 10 Percent", title: "Probe 10 Percent", offer: "Grand Total",
	apply_on: "Transaction", discount_type: "Discount Percentage", discount_percentage: 10,
	coupon_based: 1, auto: 0,
};
const FLAT = {
	name: "Probe 50 Off", title: "Probe 50 Off", offer: "Grand Total",
	apply_on: "Transaction", discount_type: "Discount Amount", discount_amount: 50,
	min_amt: 0, coupon_based: 1, auto: 0,
};
const WANT = new URLSearchParams(location.search).get("offer") === "flat" ? FLAT : OFFER;
const ROUTES: [string, unknown][] = [
	["offers.get_offers", [WANT]],
	["offers.get_pos_coupon", { msg: "Apply", coupon: { coupon_code: "PROBE", pos_offer: WANT.name } }],
	["customer.get_available_credit", []],
	["catalog.get_item_detail", { income_account: "Sales", cost_center: "Main" }],
	["invoice_api.update_invoice", { name: "SINV-PROBE-1", items: [], taxes: [] }],
];
let networkUp = true;
let syncCalls = 0;
let storageOk: boolean | null = null;
const probeNotes: string[] = [];
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
	if (!networkUp) throw new TypeError("Failed to fetch");

	// Answer the sync endpoint the way the server does: one result per uuid sent.
	if (url.includes("offline.sync_invoices")) {
		syncCalls += 1;
		const sent = JSON.parse(String(init?.body ?? "{}")).batch as { uuid: string }[];
		const results = (sent ?? []).map((entry, i) => ({
			uuid: entry.uuid, status: "synced", name: `SINV-SYNCED-${i + 1}`, docstatus: 1,
		}));
		return new Response(JSON.stringify({ message: results }), {
			status: 200, headers: { "Content-Type": "application/json" },
		});
	}
	const hit = ROUTES.find(([k]) => url.includes(k));
	return new Response(JSON.stringify({ message: hit ? hit[1] : [] }), {
		status: 200, headers: { "Content-Type": "application/json" },
	});
}) as typeof fetch;

// navigator.onLine is read before every call; make it follow the stub.
Object.defineProperty(navigator, "onLine", { get: () => networkUp, configurable: true });

const app = createApp({
	setup: () => () => h("div", { class: "h-dvh bg-bg text-fg" }, [h(SellView), h(ModalHost), h(ToastHost)]),
});
app.config.warnHandler = (msg) => bump("vue-warn", msg);
app.use(createPinia());
initTheme();
initHotkeys();
app.mount("#app");

/* ---- seed -------------------------------------------------------------- */
configureFormatting({ numberFormat: "#,###.##", currency: "SAR", currencySymbol: "SAR",
	currencyPrecision: 2, floatPrecision: 3, dateFormat: "dd-mm-yyyy" });

const session = useSessionStore();
session.profile = {
	name: "Probe POS", company: "Probe Co", currency: "SAR", warehouse: "Main - PC",
	selling_price_list: "Standard Selling",
	payments: [{ mode_of_payment: "Cash", default: 1, type: "Cash" }],
	posa_allow_user_to_edit_additional_discount: 1,
	posa_allow_user_to_edit_rate: 1, posa_allow_user_to_edit_item_discount: 1,
	use_customer_credit: 1, posa_allow_return: 1, posa_allow_offline_mode: 1,
} as never;
session.company = { company_name: "Probe Co" } as never;
session.ready = true;
session.booting = false;

const ITEM: Item = {
	item_code: "PROBE-1", item_name: "Probe Item", stock_uom: "Nos", image: null,
	is_stock_item: 1, has_variants: 0, item_group: "All Item Groups",
	has_batch_no: 0, has_serial_no: 0, rate: 100, currency: "SAR",
	actual_qty: 99, item_barcode: [],
};
const catalog = useCatalogStore();
catalog.load = async () => {};
catalog.loadGroups = async () => {};
catalog.items = [ITEM];

const cart = useCartStore();
cart.customer = "Walk-in";
cart.customerInfo = { name: "Walk-in", customer_name: "Walk-in" } as never;
const offers = useOffersStore();
const payments = usePaymentsStore();

// Wrap refresh so a runaway shows up as a call count, not as a hang.
const originalRefresh = offers.refresh;
offers.refresh = ((...args: unknown[]) => {
	refreshCalls += 1;
	if (refreshCalls > 500) throw new Error("refresh() runaway: called 500+ times");
	return (originalRefresh as (...a: unknown[]) => unknown)(...args);
}) as typeof offers.refresh;

/* ---- drive it ---------------------------------------------------------- */
function report(stage: string) {
	const el = document.getElementById("out") ?? Object.assign(document.createElement("pre"), { id: "out" });
	const recursive = [...seen.entries()].filter(([k]) => /recursive|Maximum/i.test(k));
	el.textContent = [
		`STAGE           : ${stage}`,
		`refresh() calls : ${refreshCalls}`,
		`cart lines      : ${cart.items.length}`,
		`offer          : ${WANT.name}`,
		`addl discount % : ${cart.additionalDiscountPercentage}`,
		`addl discount   : ${cart.additionalDiscount}`,
		`grand total     : ${cart.totals.grandTotal}`,
		`coupons applied : ${offers.coupons.length}`,
		`RECURSIVE LOOP  : ${recursive.length ? recursive.map(([k, n]) => `${n}x ${k}`).join(" | ") : "none"}`,
		`storage usable  : ${storageOk}`,
		`isolation       : ${probeNotes.join(" | ") || "-"}`,
		`toasts          : ${useUiStore().toasts.map((t) => `[${t.tone}] ${t.title}`).join(" | ") || "none"}`,
		`messages        : ${[...seen.entries()].map(([k, n]) => `${n}x ${k}`).join("\n                  ") || "none"}`,
	].join("\n");
	document.body.append(el);
}

const tick = () => new Promise((r) => setTimeout(r, 30));

(async () => {
	await tick();
	await offers.load();
	await cart.addItem(ITEM);
	await tick();
	report("item added");

	try {
		await offers.applyCoupon("PROBE");
	} catch (e) {
		bump("applyCoupon threw", String(e));
	}
	await tick(); await tick();
	report("coupon applied");

	payments.build();
	payments.tenderExact();
	await tick();
	report("tendered");

	/* ---- offline path -------------------------------------------------- */
	try {
	const dbmod = await import("./lib/db");
	storageOk = await dbmod.isStorageUsable();

	// Isolate: does a trivial entry store, and does a payload straight off the cart?
	try {
		await dbmod.enqueueInvoice({
			uuid: "probe-trivial", profile: "P", shift: "S",
			created_at: Date.now(), updated_at: Date.now(), status: "pending", attempts: 0,
			summary: { customer: "c", customer_name: "c", grand_total: 1, currency: "SAR", item_count: 1 },
			payload: { invoice: { a: 1 }, data: {} },
		});
		probeNotes.push("trivial entry: stored");
	} catch (e) {
		probeNotes.push(`trivial entry FAILED: ${e instanceof Error ? `${e.name}: ${(e as Error & {cause?:unknown}).cause ?? e.message}` : String(e)}`);
	}
	try {
		await dbmod.enqueueInvoice({
			uuid: "probe-cart", profile: "P", shift: "S",
			created_at: Date.now(), updated_at: Date.now(), status: "pending", attempts: 0,
			summary: { customer: "c", customer_name: "c", grand_total: 1, currency: "SAR", item_count: 1 },
			payload: { invoice: cart.toInvoicePayload(), data: {} },
		});
		probeNotes.push("raw cart payload stored (unexpected — plain() may be unnecessary now)");
	} catch (e) {
		probeNotes.push("raw cart payload unclonable, as expected — this is why sync.enqueue calls plain()");
	}
	const sync = useSyncStore();
	await sync.refresh();

	networkUp = false;
	session.serverReachable = false;
	session.online = false;

	const queued = await payments.submit();
	await tick();
	await sync.refresh();
	reportOffline("submitted while offline", queued, sync);

	networkUp = true;
	session.online = true;
	const drained = await sync.drain();
	await tick();
	await sync.refresh();
	reportOffline(`drained (${drained.length} result(s), ${syncCalls} sync call(s))`, queued, sync);

	/* ---- returns --------------------------------------------------------- */
	networkUp = true;
	session.serverReachable = true;
	session.online = true;
	cart.reset();
	payments.reset();

	// A submitted invoice, as search_invoices_for_return hands it back.
	const SOLD = {
		name: "SINV-SOLD-1", customer: "Walk-in", customer_name: "Walk-in",
		posting_date: "2026-08-20", grand_total: 100, discount_amount: 0,
		additional_discount_percentage: 0, taxes: [], posa_offers: [], posa_coupons: [],
		items: [{
			name: "row-a", item_code: "PROBE-1", item_name: "Probe Item", description: "",
			stock_uom: "Nos", uom: "Nos", conversion_factor: 1, qty: 2, rate: 50,
			price_list_rate: 50, amount: 100, discount_percentage: 0, discount_amount: 0,
			warehouse: "Main - PC",
		}],
	};

	cart.loadFromDoc(SOLD, { asReturn: true });
	payments.reset();
	payments.tenderExact();
	await tick();

	const rp = document.createElement("pre");
	rp.textContent = [
		"STAGE           : return started",
		`isReturn        : ${cart.isReturn}  returnAgainst=${cart.returnAgainst}`,
		`lines / qty     : ${cart.items.length} / ${cart.items.map((i) => i.qty).join(",")}`,
		`cart payable    : ${cart.payableAmount}`,
		`payments.payable: ${payments.payable}`,
		`tendered        : ${payments.paid}  rows=${payments.rows.map((r) => `${r.mode_of_payment}=${r.amount}`).join(",")}`,
		`settled         : ${payments.settled}   canSubmit=${payments.canSubmit}`,
	].join("\n");
	document.body.append(rp);

	cart.cancelReturn();
	payments.reset();
	await tick();
	const cp = document.createElement("pre");
	cp.textContent = [
		"STAGE           : return cancelled",
		`isReturn        : ${cart.isReturn}  returnAgainst=${cart.returnAgainst}`,
		`lines           : ${cart.items.length}`,
		`tendered        : ${payments.paid}`,
	].join("\n");
	document.body.append(cp);

	/* ---- does the queue dialog actually mount? -------------------------- */
	const ui = useUiStore();
	// Put something in the queue so the dialog has rows to draw.
	networkUp = false;
	session.serverReachable = false;
	await payments.submit();
	await tick();

	ui.openModal("queue");
	for (let i = 0; i < 40; i += 1) await tick();   // async component needs a tick

	const el = document.createElement("pre");
	const dialog = document.querySelector('[role="dialog"]');
	el.textContent = [
		"STAGE           : opened the queue dialog",
		`ui.modal        : ${JSON.stringify(ui.modal)}`,
		`role=dialog     : ${dialog ? "present" : "MISSING"}`,
		`dialog heading  : ${dialog?.querySelector("h2")?.textContent ?? "-"}`,
		`rows drawn      : ${dialog?.querySelectorAll("li").length ?? 0}`,
		`queue entries   : ${sync.entries.length}`,
		`console         : ${[...seen.entries()].map(([k, n]) => `${n}x ${k}`).join(" || ") || "none"}`,
	].join("\n");
	document.body.append(el);
	} catch (e) {
		const el = document.createElement("pre");
		el.textContent = `OFFLINE BLOCK THREW: ${e instanceof Error ? e.stack ?? e.message : String(e)}`;
		document.body.append(el);
	}
})();

function reportOffline(stage: string, queued: unknown, sync: ReturnType<typeof useSyncStore>) {
	const el = document.createElement("pre");
	el.textContent = [
		`STAGE           : ${stage}`,
		`queued marker   : ${JSON.stringify(queued)}`,
		`canSubmit       : ${usePaymentsStore().canSubmit}  paid=${usePaymentsStore().paid} payable=${usePaymentsStore().payable} settled=${usePaymentsStore().settled}`,
		`queue entries   : ${sync.entries.length}  pending=${sync.pending.length} failed=${sync.failed.length}`,
		`outstanding     : ${sync.outstanding}`,
		`storage usable  : ${storageOk}`,
		`isolation       : ${probeNotes.join(" | ") || "-"}`,
		`toasts          : ${useUiStore().toasts.map((t) => `[${t.tone}] ${t.title}`).join(" | ") || "none"}`,
		`messages        : ${[...seen.entries()].map(([k, n]) => `${n}x ${k}`).join("\n                  ") || "none"}`,
	].join("\n");
	document.body.append(el);
}
