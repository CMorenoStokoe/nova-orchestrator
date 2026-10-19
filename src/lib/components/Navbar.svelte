<script lang="ts">
	import { appSelection } from '$lib/state.svelte';

	let commit = $derived(appSelection.selectedCommit);
</script>

{#if commit}
	<!-- Active navigation header when a commit is selected -->
	<header
		class="border-b border-[#DDEBFB]/10 bg-[#08060B]/85 backdrop-blur-md sticky top-0 z-30 px-6 py-3 flex items-center justify-between transition-all duration-300"
	>
		<div class="flex items-center space-x-3">
			<img src="/logo.svg" alt="Nova" class="h-6 w-auto object-contain" />
			<div class="flex items-baseline space-x-2">
				<h1 class="font-semibold text-sm tracking-tight text-[#DDEBFB]"><span class="font-space">Nova</span> Orchestrator</h1>
				<span class="text-xs text-[#DDEBFB]/60 font-mono">/ Terminus</span>
			</div>
		</div>

		<div class="flex items-center space-x-3 text-xs">
			<span
				class="px-2 py-0.5 rounded font-mono text-xs bg-[#3300FF]/25 border border-[#3300FF]/60 text-[#DDEBFB] font-semibold shadow-[0_0_10px_rgba(51,0,255,0.2)]"
				title={commit.hash}
			>
				{commit.hash.substring(0, 7)}
			</span>
			<span
				class="px-2.5 py-0.5 rounded-md bg-[#110D17] border border-[#DDEBFB]/10 font-mono text-[#DDEBFB]/80"
			>
				{commit.branch || 'main'}
			</span>

			{#if commit.resolved_by_commit || commit.remediation_status === 'RESOLVED'}
				<span
					class="px-2 py-0.5 rounded font-mono text-xs font-semibold bg-sky-950/80 text-sky-300 border border-sky-800/80 flex items-center space-x-1"
				>
					<span>✓ RESOLVED</span>
					{#if commit.composite_score !== null}
						<span class="font-normal opacity-80">({commit.composite_score}%)</span>
					{/if}
				</span>
				{#if commit.resolved_by_commit}
					{@const resRef = commit.resolved_by_commit}
					{@const isIssue = resRef.startsWith('gh-issue-')}
					{@const label = isIssue ? `issue #${resRef.replace('gh-issue-', '')}` : `commit ${resRef.substring(0, 7)}`}
					<span class="px-2 py-0.5 rounded font-mono text-[11px] bg-sky-950/70 text-sky-200 border border-sky-700/60 flex items-center space-x-1">
						<span class="text-sky-400 font-bold">✓</span>
						<span>Resolved in {label}</span>
					</span>
				{/if}
			{:else if commit.validation_status === 'INCOMPLETE' || commit.safety_verdict === 'INCOMPLETE'}
				<span
					class="px-2 py-0.5 rounded font-mono text-xs font-semibold bg-yellow-950/80 text-yellow-300 border border-yellow-500/60 animate-pulse"
				>
					INCOMPLETE {commit.composite_score !== null ? `${commit.composite_score}%` : ''}
				</span>
			{:else if commit.safety_verdict === 'SAFE'}
				<span
					class="px-2 py-0.5 rounded font-mono text-xs font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/80"
				>
					SAFE {commit.composite_score !== null ? `${commit.composite_score}%` : ''}
				</span>
			{:else}
				<span
					class="px-2 py-0.5 rounded font-mono text-xs font-semibold bg-rose-950/80 text-rose-400 border border-rose-800/80"
				>
					FLAGGED {commit.composite_score !== null ? `${commit.composite_score}%` : ''}
				</span>
			{/if}

			<button
				type="button"
				onclick={() => appSelection.clear()}
				class="px-2.5 py-1 text-xs font-mono text-[#DDEBFB]/70 hover:text-[#DDEBFB] bg-[#110D17] hover:bg-[#181322] rounded border border-[#DDEBFB]/10 transition-colors flex items-center space-x-1 cursor-pointer ml-1"
				title="Deselect commit"
			>
				<span class="text-[#DDEBFB]/50">✕</span>
				<span>Deselect</span>
			</button>
		</div>
	</header>
{/if}
