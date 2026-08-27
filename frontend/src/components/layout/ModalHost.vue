<script setup lang="ts">
/** Mounts whichever dialog the ui store has open. One place, one z-index. */
import { computed, defineAsyncComponent, h, type Component } from "vue";
import { useUiStore } from "@/stores/ui";
// Bundled, not code-split: this is the dialog for looking at sales that could not be
// sent, so it is needed exactly when the network is gone. As a lazy chunk its
// import() failed offline and defineAsyncComponent rendered nothing, silently — the
// one modal that had to work without a connection was the one that could not load.
import SyncQueueModal from "@/components/pos/SyncQueueModal.vue";

const ui = useUiStore();

/** Shown when a lazily-loaded dialog cannot be fetched, instead of nothing at all. */
const LoadFailed: Component = {
	setup() {
		return () =>
			h(
				"div",
				{ class: "fixed inset-0 z-50 grid place-items-center bg-overlay p-4", role: "dialog" },
				h("div", { class: "panel max-w-sm p-5 text-center" }, [
					h("p", { class: "text-sm font-semibold" }, "Could not open that dialog"),
					h(
						"p",
						{ class: "mt-1 text-xs text-muted" },
						"It could not be downloaded. Check the connection, then try again.",
					),
					h(
						"button",
						{
							type: "button",
							class:
								"mt-4 h-10 w-full rounded-card bg-accent text-sm font-semibold text-accent-fg",
							onClick: () => ui.closeModal(),
						},
						"Close",
					),
				]),
			);
	},
};

const lazy = (loader: () => Promise<unknown>) =>
	defineAsyncComponent({ loader: loader as never, errorComponent: LoadFailed, timeout: 10_000 });

// Async so a dialog the cashier never opens is never downloaded — except the queue,
// which is bundled above.
const registry: Record<string, Component> = {
	drafts: lazy(() => import("@/components/pos/DraftsModal.vue")),
	returns: lazy(() => import("@/components/pos/ReturnsModal.vue")),
	orders: lazy(() => import("@/components/pos/SalesOrdersModal.vue")),
	variants: lazy(() => import("@/components/pos/VariantsModal.vue")),
	customer: lazy(() => import("@/components/customer/CustomerFormModal.vue")),
	invoiceDetails: lazy(() => import("@/components/cart/InvoiceDetailsModal.vue")),
	lineDetails: lazy(() => import("@/components/cart/CartLineDetailsModal.vue")),
	serialBatch: lazy(() => import("@/components/cart/SerialBatchPickerModal.vue")),
	mpesa: lazy(() => import("@/components/payment/MpesaModal.vue")),
	queue: SyncQueueModal,
	print: lazy(() => import("@/components/payment/PrintModal.vue")),
};

const current = computed(() => (ui.modal ? registry[ui.modal.name] : null));
</script>

<template>
	<component :is="current" v-if="current" v-bind="ui.modal?.props" />
</template>
