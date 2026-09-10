<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { api } from "@/lib/api";
import { formatCurrency, formatFloat, toNumber } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { useOffersStore } from "@/stores/offers";
import { useSessionStore } from "@/stores/session";

const cart = useCartStore();
const offers = useOffersStore();
const session = useSessionStore();

const t = computed(() => cart.totals);
const canDiscount = computed(() => !!session.profile?.posa_allow_user_to_edit_additional_discount);
const usePercentage = computed(() => !!session.profile?.posa_use_percentage_discount);

// Checkbox starts checked if a warranty number already exists on the cart (e.g. editing an existing invoice)
const warrantyApplied = ref(!!cart.warrantyNumber);

// Clearing the checkbox clears the stored warranty number too, so nothing stale gets submitted
watch(warrantyApplied, (applied) => {
	if (!applied) cart.warrantyNumber = "";
});

const vehicleTypes = ref<{ name: string }[]>([]);
const vehicleModels = ref<{ name: string }[]>([]);

async function loadVehicleOptions() {
	if (vehicleTypes.value.length && vehicleModels.value.length) return;
	try {
		const data = await api.vehicleTypesModels();
		vehicleTypes.value = data.vehicle_types ?? [];
		vehicleModels.value = data.vehicle_models ?? [];
	} catch {
		// Offline or unavailable — the sale itself must not be blocked.
	}
}

// A held draft may already carry vehicle details; preload so the selects have options.
if (cart.vehicleDetailsEnabled) void loadVehicleOptions();

function toggleVehicleDetails() {
	if (cart.vehicleDetailsEnabled) void loadVehicleOptions();
}

function commit(event: Event) {
	const raw = (event.target as HTMLInputElement).value.trim();
	if (!raw) {
		cart.setAdditionalDiscount(0, "percentage");
		return;
	}
	if (raw.endsWith("%")) cart.setAdditionalDiscount(toNumber(raw.slice(0, -1)), "percentage");
	else cart.setAdditionalDiscount(toNumber(raw), usePercentage.value ? "percentage" : "amount");
}
</script>

<template>
	<!-- Warranty: unrelated to pricing, kept in its own block -->
	<div class="space-y-1.5 border-t border-line px-4 py-3 text-sm">
		<div class="flex items-center gap-2 text-muted">
			<input id="warranty-applied" v-model="warrantyApplied" type="checkbox"
				class="h-4 w-4 rounded border-line text-accent focus:ring-0" />
			<label for="warranty-applied" class="cursor-pointer select-none">
				Warranty Applied <span class="text-subtle">(warranty required)</span>
			</label>
		</div>

		<div v-if="warrantyApplied" class="flex items-center justify-between gap-2 text-muted">
			<label for="warranty-no" class="shrink-0">Warranty Number</label>
			<input id="warranty-no" v-model="cart.warrantyNumber" type="text" placeholder="warranty no."
				class="h-8 w-40 rounded-card border-line bg-surface text-right text-sm tnum shadow-xs focus:border-accent focus:ring-0" />
		</div>
	</div>

	<!-- Vehicle details: unrelated to pricing, kept in its own block -->
	<div class="space-y-1.5 border-t border-line px-4 py-3 text-sm">
		<div class="flex items-center gap-2 text-muted">
			<input id="vehicle-details" v-model="cart.vehicleDetailsEnabled" type="checkbox"
				class="h-4 w-4 rounded border-line text-accent focus:ring-0" @change="toggleVehicleDetails" />
			<label for="vehicle-details" class="cursor-pointer select-none">Vehicle Details</label>
		</div>

		<div v-if="cart.vehicleDetailsEnabled" class="space-y-2 text-muted">
			<button type="button"
				class="h-7 w-full rounded-card border border-line bg-surface text-xs font-semibold text-accent transition hover:bg-accent-soft"
				@click="cart.addVehicleRow">
				+ Add Vehicle
			</button>

			<div class="max-h-48 min-h-12 overflow-y-auto rounded-card border border-line">
				<table class="w-full text-xs">
					<thead>
						<tr class="sticky top-0 bg-surface-2 text-left">
							<th class="w-7 px-1.5 py-1 font-semibold text-subtle">#</th>
							<th class="px-1.5 py-1 font-semibold text-subtle">Vehicle No</th>
							<th class="px-1.5 py-1 font-semibold text-subtle">Mileage/Odometer</th>
							<th class="px-1.5 py-1 font-semibold text-subtle">Category</th>
							<th class="px-1.5 py-1 font-semibold text-subtle">Type</th>
							<th class="px-1.5 py-1 font-semibold text-subtle">Model</th>
							<th class="w-14 px-1.5 py-1" />
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, index) in cart.vehicleDetails" :key="row.posa_row_id"
							class="border-t border-line">
							<td class="px-1.5 py-1 text-subtle">{{ index + 1 }}</td>
							<td class="px-1 py-0.5">
								<input v-model="row.vehicle_number" type="text" placeholder="no."
									class="h-7 w-full min-w-20 rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0" />
							</td>
							<td class="px-1 py-0.5">
								<input v-model="row.vehicle_mileage" type="text" placeholder="km"
									class="h-7 w-full min-w-20 rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0" />
							</td>
							<td class="px-1 py-0.5">
								<select v-model="row.vehicle_category"
									class="h-7 w-full min-w-20 rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0">
									<option value="">—</option>
									<option value="Private">Private</option>
									<option value="Commercial">Commercial</option>
								</select>
							</td>
							<td class="px-1 py-0.5">
								<select v-model="row.vehicle_type" :disabled="!vehicleTypes.length"
									class="h-7 w-full min-w-24 rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0">
									<option value="">—</option>
									<option v-for="opt in vehicleTypes" :key="opt.name" :value="opt.name">{{ opt.name }}</option>
								</select>
							</td>
							<td class="px-1 py-0.5">
								<select v-model="row.vehicle_model" :disabled="!vehicleModels.length"
									class="h-7 w-full min-w-24 rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0">
									<option value="">—</option>
									<option v-for="opt in vehicleModels" :key="opt.name" :value="opt.name">{{ opt.name }}</option>
								</select>
							</td>
							<td class="px-1 py-0.5">
								<button type="button"
									class="grid size-7 place-items-center rounded-card border border-line bg-surface text-danger transition hover:bg-danger-soft"
									:aria-label="`Remove vehicle ${index + 1}`" @click="cart.removeVehicleRow(row.posa_row_id)">
									<X class="size-3.5" />
								</button>
							</td>
						</tr>
						<tr v-if="!cart.vehicleDetails.length">
							<td colspan="7" class="px-2 py-2 text-center text-subtle">
								No vehicles added yet.
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- Payment / totals -->
	<div class="space-y-1.5 border-t border-line px-4 py-3 text-sm">
		<div class="flex justify-between text-muted">
			<span>Subtotal <span class="text-subtle">({{ formatFloat(t.totalQty) }} qty)</span></span>
			<span class="tnum">{{ formatCurrency(t.total) }}</span>
		</div>

		<div v-if="t.itemDiscountTotal > 0" class="flex justify-between text-success">
			<span>Item discounts</span>
			<span class="tnum">− {{ formatCurrency(t.itemDiscountTotal) }}</span>
		</div>

		<div class="flex items-center justify-between gap-2 text-muted">
			<label for="addl-disc" class="shrink-0">
				Discount<span class="text-subtle"> (10 or 10%)</span>
			</label>
			<input id="addl-disc" :value="usePercentage
					? formatFloat(cart.additionalDiscountPercentage, 2)
					: formatFloat(cart.additionalDiscount, 2)
				" type="text" inputmode="decimal" placeholder="0" :disabled="!canDiscount"
				class="h-8 w-24 rounded-card border-line bg-surface text-right text-sm tnum shadow-xs focus:border-accent focus:ring-0 disabled:bg-surface-2 disabled:text-subtle"
				@change="commit($event)" />
		</div>

		<p v-if="offers.invoiceDiscountOverridden"
			class="rounded-card bg-info-soft px-2 py-1.5 text-[11px] leading-snug text-info">
			Your discount is being used instead of the offer's. Clear it to put the offer back.
		</p>

		<div v-for="tax in t.taxes" :key="tax.idx" class="flex justify-between text-muted">
			<span class="truncate pr-2">{{ tax.description || tax.account_head }}</span>
			<span class="tnum">{{ formatCurrency(tax.tax_amount) }}</span>
		</div>

		<div v-if="t.roundingAdjustment" class="flex justify-between text-xs text-subtle">
			<span>Rounding</span>
			<span class="tnum">{{ formatCurrency(t.roundingAdjustment) }}</span>
		</div>

		<div class="flex items-baseline justify-between border-t border-line pt-2">
			<span class="font-semibold">Total</span>
			<span class="text-xl font-bold tnum text-accent">{{ formatCurrency(cart.payableAmount) }}</span>
		</div>
	</div>
</template>