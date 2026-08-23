<script setup lang="ts">
/** Mounts whichever dialog the ui store has open. One place, one z-index. */
import { computed, defineAsyncComponent } from "vue";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();

// Async so a dialog the cashier never opens is never downloaded.
const registry: Record<string, ReturnType<typeof defineAsyncComponent>> = {
	drafts: defineAsyncComponent(() => import("@/components/pos/DraftsModal.vue")),
	returns: defineAsyncComponent(() => import("@/components/pos/ReturnsModal.vue")),
	orders: defineAsyncComponent(() => import("@/components/pos/SalesOrdersModal.vue")),
	variants: defineAsyncComponent(() => import("@/components/pos/VariantsModal.vue")),
	customer: defineAsyncComponent(() => import("@/components/customer/CustomerFormModal.vue")),
	invoiceDetails: defineAsyncComponent(() => import("@/components/cart/InvoiceDetailsModal.vue")),
	print: defineAsyncComponent(() => import("@/components/payment/PrintModal.vue")),
};

const current = computed(() => (ui.modal ? registry[ui.modal.name] : null));
</script>

<template>
	<component :is="current" v-if="current" v-bind="ui.modal?.props" />
</template>
