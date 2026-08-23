<script setup lang="ts">
/** The invoice fields a cashier needs occasionally, kept out of the main flow. */
import { onMounted } from "vue";
import { useCartStore } from "@/stores/cart";
import { useCustomerStore } from "@/stores/customers";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

const cart = useCartStore();
const customers = useCustomerStore();
const session = useSessionStore();
const ui = useUiStore();

onMounted(() => {
	void customers.loadSalesPersons();
	if (cart.customer) void customers.loadAddresses(cart.customer);
});
</script>

<template>
	<ModalShell title="Invoice details" width="max-w-md" @close="ui.closeModal()">
		<div class="grid gap-3 p-4 sm:grid-cols-2">
			<label v-if="session.profile?.posa_allow_change_posting_date" class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Posting date
				</span>
				<input
					v-model="cart.postingDate"
					type="date"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>

			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Due date</span>
				<input
					v-model="cart.dueDate"
					type="date"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>

			<label v-if="session.profile?.posa_allow_customer_purchase_order" class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Customer PO number
				</span>
				<input
					v-model="cart.poNumber"
					type="text"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>

			<label v-if="session.profile?.posa_allow_sales_order" class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Delivery date
				</span>
				<input
					v-model="cart.deliveryDate"
					type="date"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
				<span class="mt-1 block text-[11px] text-muted">
					A delivery date turns this into a sales order, so stock is not moved now.
				</span>
			</label>

			<label v-if="customers.salesPersons.length" class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Sales person
				</span>
				<select
					v-model="cart.salesPerson"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				>
					<option value="">—</option>
					<option v-for="person in customers.salesPersons" :key="person.name" :value="person.name">
						{{ person.sales_person_name || person.name }}
					</option>
				</select>
			</label>

			<label v-if="customers.addresses.length" class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
					Shipping address
				</span>
				<select
					v-model="cart.shippingAddress"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				>
					<option :value="null">—</option>
					<option
						v-for="address in customers.addresses"
						:key="address.name as string"
						:value="address.name as string"
					>
						{{ address.address_title || address.name }}
					</option>
				</select>
			</label>

			<label class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Notes</span>
				<textarea
					v-model="cart.notes"
					rows="3"
					class="w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
		</div>

		<template #footer>
			<button
				type="button"
				class="h-11 w-full rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
				@click="ui.closeModal()"
			>
				Done
			</button>
		</template>
	</ModalShell>
</template>
