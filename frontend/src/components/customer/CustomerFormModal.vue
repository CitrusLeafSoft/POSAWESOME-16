<script setup lang="ts">
/** Create or edit a customer without leaving the till. */
import { onMounted, ref } from "vue";
import { Loader2, UserPlus } from "lucide-vue-next";
import { useCustomerStore } from "@/stores/customers";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";

const props = defineProps<{ customerId?: string }>();

const customers = useCustomerStore();
const cart = useCartStore();
const ui = useUiStore();

const form = ref({
	customer_name: "",
	mobile_no: "",
	email_id: "",
	tax_id: "",
	gender: "",
	customer_type: "Individual",
	birthday: "",
});
const saving = ref(false);

onMounted(async () => {
	if (!props.customerId) return;
	const info = await customers.info(props.customerId);
	if (!info) return;
	form.value = {
		customer_name: info.customer_name ?? "",
		mobile_no: info.mobile_no ?? "",
		email_id: info.email_id ?? "",
		tax_id: info.tax_id ?? "",
		gender: info.gender ?? "",
		customer_type: info.customer_type ?? "Individual",
		birthday: info.birthday ?? "",
	};
});

async function save() {
	if (!form.value.customer_name.trim()) {
		ui.warn("A customer name is required");
		return;
	}
	saving.value = true;
	try {
		const result = await customers.save({ ...form.value, customer_id: props.customerId });
		// Selecting the new customer is almost always what the cashier wants next.
		cart.customer = result.name;
		cart.customerInfo = result;
		ui.success(props.customerId ? "Customer updated" : "Customer created", result.customer_name);
		ui.closeModal();
	} catch (error) {
		ui.fail("Could not save the customer", error instanceof Error ? error.message : String(error));
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<ModalShell
		:title="customerId ? 'Edit customer' : 'New customer'"
		width="max-w-md"
		@close="ui.closeModal()"
	>
		<form id="customer-form" class="grid gap-3 p-4 sm:grid-cols-2" @submit.prevent="save">
			<label class="block sm:col-span-2">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Name</span>
				<input
					v-model="form.customer_name"
					type="text"
					required
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Mobile</span>
				<input
					v-model="form.mobile_no"
					type="tel"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Email</span>
				<input
					v-model="form.email_id"
					type="email"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Tax ID</span>
				<input
					v-model="form.tax_id"
					type="text"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Type</span>
				<select
					v-model="form.customer_type"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				>
					<option value="Individual">Individual</option>
					<option value="Company">Company</option>
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Gender</span>
				<select
					v-model="form.gender"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				>
					<option value="">—</option>
					<option value="Male">Male</option>
					<option value="Female">Female</option>
					<option value="Other">Other</option>
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">Birthday</span>
				<input
					v-model="form.birthday"
					type="date"
					class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
				/>
			</label>
		</form>

		<template #footer>
			<button
				type="submit"
				form="customer-form"
				class="flex h-11 w-full items-center justify-center gap-2 rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover disabled:bg-surface-3 disabled:text-subtle"
				:disabled="saving"
			>
				<Loader2 v-if="saving" class="size-4 animate-spin" />
				<UserPlus v-else class="size-4" />
				{{ customerId ? "Save changes" : "Create customer" }}
			</button>
		</template>
	</ModalShell>
</template>

<script lang="ts">
import ModalShell from "@/components/common/ModalShell.vue";
export default { components: { ModalShell } };
</script>
