<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
	modelValue: string | undefined;
	options: { name: string }[];
	placeholder?: string;
	ariaLabel?: string;
	/** Noun used in the "add new" hint, e.g. "type" or "model". */
	createLabel?: string;
}>();

const emit = defineEmits<{
	(e: "update:modelValue", value: string | undefined): void;
}>();

const open = ref(false);
const highlighted = ref(-1);
const inputRef = ref<HTMLInputElement | null>(null);
const rootRef = ref<HTMLDivElement | null>(null);

const query = computed(() => (props.modelValue ?? "").trim());

const filtered = computed(() => {
	const q = query.value.toLowerCase();
	const list = q ? props.options.filter((opt) => opt.name.toLowerCase().includes(q)) : props.options;
	return list.slice(0, 30);
});

const exactMatch = computed(() =>
	props.options.some((opt) => opt.name.toLowerCase() === query.value.toLowerCase()),
);

const showCreateHint = computed(() => query.value.length > 0 && !exactMatch.value);

function openList() {
	open.value = true;
}

function closeList() {
	open.value = false;
	highlighted.value = -1;
}

function onInput(event: Event) {
	emit("update:modelValue", (event.target as HTMLInputElement).value);
	open.value = true;
	highlighted.value = -1;
}

function onFocusOut(event: FocusEvent) {
	const next = event.relatedTarget as Node | null;
	if (rootRef.value && next && rootRef.value.contains(next)) return;
	closeList();
}

function selectOption(name: string) {
	emit("update:modelValue", name);
	closeList();
	inputRef.value?.blur();
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === "ArrowDown") {
		event.preventDefault();
		if (!open.value) {
			open.value = true;
			return;
		}
		const max = filtered.value.length - 1;
		highlighted.value = highlighted.value >= max ? max : highlighted.value + 1;
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		highlighted.value = highlighted.value <= 0 ? -1 : highlighted.value - 1;
	} else if (event.key === "Enter") {
		if (open.value && highlighted.value >= 0 && filtered.value[highlighted.value]) {
			event.preventDefault();
			selectOption(filtered.value[highlighted.value].name);
		} else {
			closeList();
		}
	} else if (event.key === "Escape") {
		closeList();
		inputRef.value?.blur();
	}
}

defineExpose({ focus: () => inputRef.value?.focus() });
</script>

<template>
	<div ref="rootRef" class="relative" @focusout="onFocusOut">
		<input ref="inputRef" type="text" :value="modelValue" :placeholder="placeholder" :aria-label="ariaLabel"
			autocomplete="off" role="combobox" aria-autocomplete="list" :aria-expanded="open"
			class="h-7 w-full min-w-24 rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0"
			@input="onInput" @focus="openList" @keydown="onKeydown" />
		<ul v-if="open && (filtered.length || showCreateHint)"
			class="absolute z-20 mt-1 max-h-40 w-max min-w-full overflow-y-auto rounded-card border border-line bg-surface text-sm shadow-md">
			<li v-for="(opt, i) in filtered" :key="opt.name" role="option" :aria-selected="i === highlighted"
				class="cursor-pointer whitespace-nowrap px-2 py-1"
				:class="i === highlighted ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'"
				@mousedown.prevent="selectOption(opt.name)">
				{{ opt.name }}
			</li>
			<li v-if="showCreateHint"
				class="cursor-pointer whitespace-nowrap border-t border-line px-2 py-1 text-accent"
				@mousedown.prevent="closeList(); inputRef?.blur()">
				＋ Add "{{ query }}" as new {{ createLabel ?? "entry" }}
			</li>
		</ul>
	</div>
</template>