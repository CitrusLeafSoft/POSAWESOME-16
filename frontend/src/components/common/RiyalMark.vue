<script setup lang="ts">
/**
 * The Saudi Riyal sign as inline SVG.
 *
 * Text contexts get the character itself (U+20C1) resolved from the bundled
 * one-glyph font. This component is for the places where the symbol stands alone as
 * chrome rather than sitting in a sentence — the rate board, the totals — where it
 * needs to scale with a heading and take a colour independent of the text around it.
 *
 * `currentColor` means it inherits whatever the parent sets, so it works on the leaf
 * gradient of the rate board and on a plain surface without a variant.
 */
import { RIYAL_PATH, RIYAL_VIEWBOX } from "@/lib/riyal-path";

withDefaults(defineProps<{ label?: string }>(), { label: "" });
</script>

<template>
	<svg
		:viewBox="RIYAL_VIEWBOX"
		xmlns="http://www.w3.org/2000/svg"
		fill="currentColor"
		:role="label ? 'img' : undefined"
		:aria-label="label || undefined"
		:aria-hidden="label ? undefined : 'true'"
		focusable="false"
		class="inline-block h-[0.82em] w-auto align-[-0.06em]"
	>
		<path :d="RIYAL_PATH" />
	</svg>
</template>
