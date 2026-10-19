<script lang="ts">
	import { VIBE_CRITERIA, type ReportSummary, type FullReport } from '$lib/types';

	interface Props {
		summaries: ReportSummary[];
		fullReports?: Record<string, FullReport>;
	}

	let { summaries = [], fullReports = {} }: Props = $props();

	let hoveredCriterionCode = $state<string | null>(null);

	interface CriterionMetric {
		code: string; // 'VBC-01'
		badge: string; // 'V01'
		name: string;
		description: string;
		failCount: number;
		passCount: number;
		naCount: number;
		totalEvaluated: number;
		failPercent: number; // 0 to 100
		passPercent: number; // 0 to 100
	}

	let metrics = $derived.by(() => {
		const total = summaries.length;
		if (total === 0) {
			return {
				criteria: [] as CriterionMetric[],
				avgPassPercent: 100,
				avgFailPercent: 0,
				totalEvaluated: 0,
				failingCriteriaCount: 0
			};
		}

		// Evaluated commits are those with a verdict or criteria badges
		const evaluated = summaries.filter(
			(c) => c.validation_status !== 'INCOMPLETE' || (c.criteria_badges && Object.keys(c.criteria_badges).length > 0)
		);
		const evalCount = evaluated.length > 0 ? evaluated.length : total;

		const criteria: CriterionMetric[] = VIBE_CRITERIA.map((crit) => {
			let failCount = 0;
			let passCount = 0;
			let naCount = 0;

			for (const commit of evaluated) {
				const full = fullReports[commit.hash];
				const critResult = full?.criteria?.[crit.key];
				const badges = { ...(commit.domain_badges || {}), ...(commit.criteria_badges || {}) };
				const badge = badges[crit.code] || badges[crit.badge];

				if (critResult) {
					if (critResult.status === 'FAIL' || critResult.status === 'WARN') {
						failCount++;
					} else if (critResult.status === 'PASS') {
						passCount++;
					} else if (critResult.status === 'NA') {
						naCount++;
					}
				} else if (badge === 'FAIL' || badge === 'WARN' || badge === 'ERROR') {
					failCount++;
				} else if (badge === 'PASS') {
					passCount++;
				} else if (badge === 'NA') {
					naCount++;
				} else if (commit.validation_status === 'FLAGGED' && (crit.code === 'VBC-04' || crit.code === 'VBC-08')) {
					failCount++;
				} else if (commit.validation_status === 'SAFE') {
					passCount++;
				}
			}

			const applicable = failCount + passCount;
			const failPercent = applicable > 0 ? Math.round((failCount / applicable) * 100) : 0;
			const passPercent = applicable > 0 ? Math.round((passCount / applicable) * 100) : 100;

			return {
				code: crit.code,
				badge: crit.badge,
				name: crit.name,
				description: crit.description,
				failCount,
				passCount,
				naCount,
				totalEvaluated: applicable,
				failPercent,
				passPercent
			};
		});

		const sumPass = criteria.reduce((acc, c) => acc + c.passPercent, 0);
		const avgPassPercent = criteria.length > 0 ? Math.round(sumPass / criteria.length) : 100;
		const avgFailPercent = 100 - avgPassPercent;
		const failingCriteriaCount = criteria.filter((c) => c.failPercent > 0).length;

		return {
			criteria,
			avgPassPercent,
			avgFailPercent,
			totalEvaluated: evalCount,
			failingCriteriaCount
		};
	});
</script>

<div class="p-2.5 rounded-xl bg-[#110D17]/90 border border-[#DDEBFB]/10 shadow-sm flex flex-col space-y-2">
	<!-- Top: Section Header -->
	<div class="flex items-center justify-between text-[11px] font-mono">
		<span class="font-semibold text-[#DDEBFB]/60 uppercase tracking-wider text-[10px]">
			Criteria Failure Rates
		</span>

		<!-- Average % Pass Indicator -->
		<div
			class="text-[10px] px-2 py-0.5 rounded transition-all font-mono font-medium flex items-center gap-1.5 bg-[#08060B]/60 border border-[#DDEBFB]/10 text-[#DDEBFB]/80"
			title="Average pass rate across all 17 Quality Markers ({metrics.totalEvaluated} evaluated commits)"
		>
			<span class="text-[#DDEBFB]/50 uppercase tracking-wider text-[9px]">Avg Pass</span>
			<span class="font-semibold text-emerald-400 font-mono text-[10px]">{metrics.avgPassPercent}%</span>
		</div>
	</div>

	<!-- 17-Step Pipeline Spectrum Visual (Horizontal Spark-strip) -->
	<div class="space-y-1">
		<div class="grid grid-cols-17 gap-0.5 sm:gap-1 items-end pt-1 bg-[#08060B]/60 p-1 sm:p-1.5 rounded-md border border-[#DDEBFB]/5">
			{#each metrics.criteria as crit}
				{@const isHovered = hoveredCriterionCode === crit.code}
				{@const hasFailure = crit.failPercent > 0}
				<div
					role="group"
					aria-label="Quality Marker {crit.code}"
					onmouseenter={() => (hoveredCriterionCode = crit.code)}
					onmouseleave={() => (hoveredCriterionCode = null)}
					class="flex flex-col items-center gap-0.5 cursor-pointer group transition-transform hover:scale-105"
					title="[{crit.code}] {crit.name}&#10;Fail Rate: {crit.failPercent}% ({crit.failCount}/{crit.totalEvaluated} commits)&#10;Pass Rate: {crit.passPercent}%"
				>
					<!-- Micro Vertical Bar -->
					<div
						class="w-full h-7 rounded-[2px] overflow-hidden flex flex-col justify-end bg-slate-900 border transition-all {isHovered ? 'ring-1 ring-[#3300FF] border-[#3300FF]' : 'border-white/5'}"
					>
						<!-- Pass Portion (Emerald) -->
						<div
							style="height: {crit.passPercent}%;"
							class="w-full {hasFailure ? 'bg-emerald-500/60' : 'bg-emerald-500/80'} transition-all"
						></div>
						<!-- Fail Portion (Rose) -->
						{#if hasFailure}
							<div
								style="height: {crit.failPercent}%;"
								class="w-full bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.6)]"
							></div>
						{/if}
					</div>

					<!-- Step Badge -->
					<span
						class="text-[8px] font-mono leading-none {hasFailure ? 'text-rose-400 font-bold' : isHovered ? 'text-[#DDEBFB]' : 'text-[#DDEBFB]/40'}"
					>
						{crit.badge.replace('V', '')}
					</span>

					<!-- Failure Indicator Dot/Percentage -->
					{#if hasFailure}
						<span class="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.7)]"></span>
					{:else}
						<span class="w-1 h-1 rounded-full bg-emerald-500/40"></span>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Hovered / Active Status Subtitle -->
		{#if hoveredCriterionCode}
			{@const active = metrics.criteria.find((c) => c.code === hoveredCriterionCode)}
			{#if active}
				<div class="flex items-center justify-between text-[10px] font-mono text-[#DDEBFB]/80 px-1 py-0.5 bg-[#181322] rounded border border-[#3300FF]/40">
					<span class="truncate">
						<strong class="text-[#DDEBFB]">{active.code}</strong>: {active.name}
					</span>
					<span class="{active.failPercent > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'} shrink-0 ml-1">
						{active.failPercent}% fail &bull; {active.passPercent}% pass
					</span>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	/* Custom 17-column grid layout for the 17 Quality Markers */
	.grid-cols-17 {
		display: grid;
		grid-template-columns: repeat(17, minmax(0, 1fr));
	}
</style>
