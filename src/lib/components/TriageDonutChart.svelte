<script lang="ts">
	import { pie, arc, type PieArcDatum } from 'd3';

	export interface CategoryData {
		id: 'SAFE' | 'FLAGGED' | 'RESOLVED' | 'INCOMPLETE';
		label: string;
		count: number;
		color: string;
	}

	let {
		total = 0,
		categories = [],
		selectedId = 'ALL',
		onSelectCategory
	}: {
		total: number;
		categories: CategoryData[];
		selectedId?: string | null;
		onSelectCategory?: (id: 'ALL' | 'SAFE' | 'FLAGGED' | 'RESOLVED' | 'INCOMPLETE') => void;
	} = $props();

	let hoveredId = $state<string | null>(null);

	let hoveredCategory = $derived(
		categories.find((c) => c.id === hoveredId) || null
	);

	function handleClick(id: 'ALL' | 'SAFE' | 'FLAGGED' | 'RESOLVED' | 'INCOMPLETE') {
		if (!onSelectCategory) return;
		if (id === 'ALL') {
			onSelectCategory('ALL');
		} else if (selectedId === id) {
			onSelectCategory('ALL');
		} else {
			onSelectCategory(id);
		}
	}

	// D3 Pie Generator with responsive padding between non-zero slices
	let pieLayout = $derived.by(() => {
		const nonZeroSlices = categories.filter((c) => c.count > 0).length;
		return pie<CategoryData>()
			.value((d) => d.count)
			.sort(null)
			.padAngle(nonZeroSlices > 1 ? 0.05 : 0);
	});

	let slices = $derived.by(() => {
		const sum = categories.reduce((acc, c) => acc + c.count, 0);
		if (sum === 0) return [];
		return pieLayout(categories);
	});

	// Compact D3 Arc Generators for left-hand panel
	const normalArc = arc<PieArcDatum<CategoryData>>()
		.innerRadius(26)
		.outerRadius(42)
		.cornerRadius(2.5);

	const hoverArc = arc<PieArcDatum<CategoryData>>()
		.innerRadius(26)
		.outerRadius(45)
		.cornerRadius(2.5);

	function formatPercent(count: number): string {
		if (total === 0) return '0%';
		return `${Math.round((count / total) * 100)}%`;
	}
</script>

<div class="p-2.5 rounded-xl bg-[#110D17]/90 border border-[#DDEBFB]/10 shadow-sm flex flex-col space-y-2">
	<!-- Top: Section Header -->
	<div class="flex items-center justify-between text-[11px] font-mono">
		<span class="font-semibold text-[#DDEBFB]/60 uppercase tracking-wider text-[10px]">
			Triage Distribution
		</span>
		<button
			type="button"
			onclick={() => handleClick('ALL')}
			class="text-[10px] px-2 py-0.5 rounded transition-all cursor-pointer font-medium
			{selectedId === 'ALL' || !selectedId
				? 'bg-[#3300FF] text-[#DDEBFB] border border-[#3300FF] font-semibold shadow-[0_0_10px_rgba(51,0,255,0.3)]'
				: 'text-[#DDEBFB]/60 hover:text-[#DDEBFB] bg-[#08060B]/60 border border-[#DDEBFB]/10'}"
			style="outline: none;"
		>
			All ({total})
		</button>
	</div>

	<!-- Content: Compact Donut + Filter Tags Grid -->
	<div class="flex items-center gap-3">
		<!-- Left: Compact Donut SVG -->
		<div class="relative flex items-center justify-center shrink-0 w-[90px] h-[90px]">
			<svg
				viewBox="-48 -48 96 96"
				class="w-full h-full overflow-visible select-none focus:outline-none"
				style="outline: none;"
			>
				<!-- Base Track / Empty Ring -->
				{#if slices.length === 0}
					<circle
						cx="0"
						cy="0"
						r="34"
						fill="none"
						stroke="#181322"
						stroke-width="14"
						stroke-dasharray="3 3"
						opacity="0.5"
					/>
				{:else}
					<circle
						cx="0"
						cy="0"
						r="34"
						fill="none"
						stroke="#110D17"
						stroke-width="16"
						opacity="0.6"
					/>
				{/if}

				<!-- D3 Donut Slices -->
				{#each slices as slice (slice.data.id)}
					{@const isHovered = hoveredId === slice.data.id}
					{@const isSelected = selectedId === slice.data.id}
					{@const dPath = isHovered ? hoverArc(slice) : normalArc(slice)}
					<path
						d={dPath || ''}
						fill={slice.data.color}
						opacity={hoveredId && !isHovered && !isSelected ? 0.35 : 1}
						stroke={isSelected ? '#3300FF' : isHovered ? '#DDEBFB' : '#08060B'}
						stroke-width={isSelected ? 2 : isHovered ? 1.5 : 1}
						class="transition-all duration-150 cursor-pointer outline-none select-none"
						style="outline: none; -webkit-tap-highlight-color: transparent;"
						role="button"
						tabindex="0"
						aria-label="{slice.data.label}: {slice.data.count} ({formatPercent(slice.data.count)})"
						onclick={() => handleClick(slice.data.id)}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick(slice.data.id)}
						onmouseenter={() => (hoveredId = slice.data.id)}
						onmouseleave={() => (hoveredId = null)}
						onfocus={() => (hoveredId = slice.data.id)}
						onblur={() => (hoveredId = null)}
					/>
				{/each}

				<!-- Donut Center Stats -->
				{#if hoveredCategory}
					<text
						y="-3"
						class="text-sm font-bold font-mono tracking-tight pointer-events-none"
						style="fill: {hoveredCategory.color}"
						text-anchor="middle"
						dominant-baseline="middle"
					>
						{hoveredCategory.count}
					</text>
					<text
						y="9"
						class="text-[7.5px] font-semibold tracking-wider uppercase pointer-events-none"
						style="fill: {hoveredCategory.color}"
						text-anchor="middle"
						dominant-baseline="middle"
					>
						{hoveredCategory.id}
					</text>
				{:else}
					<text
						y="-2"
						class="text-base font-black font-mono tracking-tight fill-[#DDEBFB] pointer-events-none"
						text-anchor="middle"
						dominant-baseline="middle"
					>
						{total}
					</text>
					<text
						y="9"
						class="text-[7px] font-bold tracking-wider fill-[#DDEBFB]/50 uppercase font-mono pointer-events-none"
						text-anchor="middle"
						dominant-baseline="middle"
					>
						COMMITS
					</text>
				{/if}
			</svg>
		</div>

		<!-- Right: Interactive Filter Tags Grid -->
		<div class="grid grid-cols-2 gap-1.5 flex-1 min-w-0">
			{#each categories as cat (cat.id)}
				{@const isHovered = hoveredId === cat.id}
				{@const isSelected = selectedId === cat.id}
				{@const pct = formatPercent(cat.count)}
				<button
					type="button"
					onclick={() => handleClick(cat.id)}
					onmouseenter={() => (hoveredId = cat.id)}
					onmouseleave={() => (hoveredId = null)}
					class="flex items-center justify-between px-2 py-1.5 rounded-lg border text-left transition-all cursor-pointer select-none outline-none
					{isSelected
						? 'bg-[#181322] border-[#3300FF] shadow-xs ring-1 ring-[#3300FF]/50 text-[#DDEBFB]'
						: isHovered
						? 'bg-[#181322]/80 border-[#DDEBFB]/20 text-[#DDEBFB]'
						: 'bg-[#08060B]/50 hover:bg-[#110D17] border-[#DDEBFB]/10 text-[#DDEBFB]/80'}"
					style="outline: none;"
					title="Filter by {cat.label} ({cat.count} commits, {pct})"
				>
					<div class="flex items-center space-x-1.5 min-w-0">
						<span
							class="w-2 h-2 rounded-full shrink-0 shadow-xs"
							style="background-color: {cat.color}"
						></span>
						<span class="text-[11px] font-medium truncate {isSelected ? 'text-[#DDEBFB] font-semibold' : ''}">
							{cat.label.split(' ')[0]}
						</span>
					</div>

					<div class="flex items-baseline space-x-1 pl-1 font-mono text-[10px] shrink-0">
						<span class="font-bold {isSelected ? 'text-[#DDEBFB]' : 'text-[#DDEBFB]/80'}">
							{cat.count}
						</span>
						<span class="text-[#DDEBFB]/40 text-[9px]">
							{pct}
						</span>
					</div>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	path,
	path:focus,
	path:focus-visible,
	button:focus,
	button:focus-visible,
	div:focus,
	div:focus-visible,
	svg:focus,
	svg:focus-visible {
		outline: none !important;
		-webkit-tap-highlight-color: transparent;
	}
</style>
