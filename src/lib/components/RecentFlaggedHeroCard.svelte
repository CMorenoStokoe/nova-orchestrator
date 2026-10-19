<script lang="ts">
	import type { ReportSummary, FullReport } from '$lib/types';
	import { VIBE_CRITERIA } from '$lib/types';

	let {
		commit = null,
		fullReport = null,
		branch = 'main',
		onReview,
		onOpenAudit,
		formatDate
	}: {
		commit: ReportSummary | null;
		fullReport?: FullReport | null;
		branch?: string;
		onReview: (hash: string) => void;
		onOpenAudit: (hash: string) => void;
		formatDate: (dateStr?: string) => string;
	} = $props();

	// Primary defect rationale / flagged Quality Marker hint
	let defectHint = $derived.by(() => {
		if (!commit) return null;

		// 1. Check fullReport findings if loaded
		if (fullReport?.findings_list && fullReport.findings_list.length > 0) {
			const firstFinding = fullReport.findings_list[0];
			const critDef = VIBE_CRITERIA.find(
				(c) => c.key === firstFinding.domain || c.code === firstFinding.criterion_code
			);
			return {
				code: critDef ? critDef.code : (firstFinding.criterion_code || 'QM'),
				name: critDef ? critDef.name : firstFinding.domain.replace(/_/g, ' '),
				title: firstFinding.title,
				rationale: firstFinding.reasoning || firstFinding.title
			};
		}

		// 2. Check fullReport criteria if loaded
		if (fullReport?.criteria) {
			for (const crit of VIBE_CRITERIA) {
				const res = fullReport.criteria[crit.key];
				if (res && (res.status === 'FAIL' || res.status === 'WARN')) {
					return {
						code: crit.code,
						name: crit.name,
						title: res.summary || `${crit.name} defect`,
						rationale: res.comment || res.summary || crit.description
					};
				}
			}
		}

		// 3. Check commit criteria_badges / domain_badges
		const badges = { ...(commit.domain_badges || {}), ...(commit.criteria_badges || {}) };
		const failedCritDef =
			VIBE_CRITERIA.find((c) => badges[c.code] === 'FAIL' || badges[c.badge] === 'FAIL') ||
			VIBE_CRITERIA.find((c) => badges[c.code] === 'WARN' || badges[c.badge] === 'WARN');

		if (failedCritDef) {
			return {
				code: failedCritDef.code,
				name: failedCritDef.name,
				title: failedCritDef.name,
				rationale: failedCritDef.description
			};
		}

		// 4. Fallback to material changes or intent summary
		if (commit.material_changes_summary) {
			return {
				code: 'DEFECT',
				name: 'Constraint / Quality Marker Violation',
				title: 'Potential regression detected',
				rationale: commit.material_changes_summary
			};
		}

		return {
			code: 'DEFECT',
			name: 'Quality Marker Flagged',
			title: 'Defect requiring triage',
			rationale: commit.high_level_intent || 'Autonomous audit flagged critical issues requiring developer verification.'
		};
	});

	let confidenceScore = $derived(
		commit?.composite_score !== null && commit?.composite_score !== undefined
			? `${commit.composite_score}%`
			: '90%'
	);
</script>

{#if !commit}
	<!-- All-Clear Card State -->
	<div class="flex flex-col justify-center p-4 rounded-xl bg-gradient-to-r from-emerald-950/30 via-slate-900/70 to-slate-900 border border-emerald-800/60 shadow-sm h-full">
		<div class="flex items-center space-x-2 text-emerald-400 font-semibold text-xs sm:text-sm">
			<span class="flex h-2.5 w-2.5 relative">
				<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
				<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
			</span>
			<span>✓ All Clear: 0 Flagged Commits Waiting Attention</span>
		</div>
		<p class="text-xs text-slate-400 mt-2 leading-relaxed">
			All evaluated commits on branch <code class="text-slate-300 font-mono bg-slate-800/90 px-1 py-0.5 rounded text-[11px]">{branch}</code> have passed automated Quality Markers or have been formally remediated. The codebase is in a verified safe state.
		</p>
		<div class="mt-3 flex items-center space-x-3 text-xs text-slate-400">
			<span class="inline-flex items-center space-x-1.5 font-mono text-[11px] text-emerald-400">
				<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
				<span>Continuous Verification Active</span>
			</span>
		</div>
	</div>
{:else}
	<!-- High-Visibility Hero Triage Card: Most Recent Flagged Commit -->
	<div class="flex flex-col justify-between p-3.5 sm:p-4 rounded-xl bg-gradient-to-br from-rose-950/40 via-slate-900/90 to-slate-950 border border-rose-800/70 hover:border-rose-600/90 transition-all shadow-md shadow-rose-950/20 h-full space-y-2.5">
		<!-- Top Row: Beacon & Confidence Pill -->
		<div class="flex items-center justify-between gap-2">
			<!-- "⚡ ATTENTION REQUIRED" Priority Beacon -->
			<div class="flex items-center space-x-2 min-w-0">
				<span class="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.35)] shrink-0">
					<span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
					<span>⚡ ATTENTION REQUIRED</span>
				</span>
				<span class="text-[11px] font-mono text-slate-400 hidden sm:inline truncate">
					Most Recent Defect
				</span>
			</div>

			<!-- Confidence Score Percentage -->
			<div class="shrink-0">
				<span
					class="text-xs font-mono font-bold px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/80 shadow-xs"
					title="Composite confidence score"
				>
					Confidence: {confidenceScore}
				</span>
			</div>
		</div>

		<!-- Middle Row 1: Commit SHA, Branch Badge, Author & Formatted Relative Time -->
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<!-- Commit SHA -->
			<span class="font-mono font-bold text-xs text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
				{commit.hash.substring(0, 7)}
			</span>

			<!-- Branch Badge -->
			<span class="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/80 flex items-center space-x-1.5">
				<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
				<span class="truncate max-w-[120px]">{commit.branch || branch}</span>
			</span>

			<!-- Author -->
			<span class="text-slate-400 truncate max-w-[180px]">
				by <span class="text-slate-200 font-medium">{commit.author || 'Unknown'}</span>
			</span>

			<!-- Relative Time -->
			{#if commit.timestamp || commit.created_at}
				<span class="text-slate-500 font-mono text-[11px]">
					&bull; {formatDate(commit.timestamp || commit.created_at)}
				</span>
			{/if}
		</div>

		<!-- Middle Row 2: Commit Message -->
		<div class="text-xs sm:text-sm font-semibold text-slate-100 line-clamp-1" title={commit.message}>
			{commit.message || 'No commit message'}
		</div>

		<!-- Primary Defect Rationale / Flagged Quality Marker Hint -->
		{#if defectHint}
			<div class="p-2 sm:p-2.5 rounded-lg bg-rose-950/30 border border-rose-900/50 text-xs text-rose-200 flex items-start space-x-2">
				<span class="text-rose-400 text-sm shrink-0 leading-none mt-0.5">⚠️</span>
				<div class="min-w-0 flex-1 leading-relaxed">
					{#if defectHint.code}
						<span class="font-mono font-bold text-[10px] text-rose-300 bg-rose-950/90 px-1.5 py-0.5 rounded border border-rose-800/70 mr-1">
							{defectHint.code}
						</span>
					{/if}
					{#if defectHint.name && defectHint.name !== defectHint.code}
						<span class="font-semibold text-slate-200 mr-1">{defectHint.name}:</span>
					{/if}
					<span class="text-rose-200/90 line-clamp-2">
						{defectHint.rationale}
					</span>
				</div>
			</div>
		{/if}

		<!-- Bottom Row: Clickable Action CTAs -->
		<div class="flex items-center flex-wrap gap-2 pt-0.5">
			<!-- Primary CTA: Review & Interrogate Defect -->
			<button
				type="button"
				onclick={() => onReview(commit.hash)}
				class="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white transition-all shadow-md shadow-rose-950/50 flex items-center space-x-1.5 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-rose-500/50"
			>
				<span>Review & Interrogate Defect</span>
				<span class="transition-transform group-hover:translate-x-0.5 font-bold">→</span>
			</button>

			<!-- Localized Audit Trail & Steps CTA -->
			<button
				type="button"
				onclick={() => onOpenAudit(commit.hash)}
				class="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/90 hover:bg-slate-750 active:bg-slate-700 text-cyan-300 border border-cyan-800/70 hover:border-cyan-500 transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
				title="View audit logs, pipeline step traces, and execution events for this commit"
			>
				<span>📜</span>
				<span>Audit Trail & Steps</span>
			</button>
		</div>
	</div>
{/if}
