<script lang="ts">
	import type { GitHubIssue } from '$lib/types';
	import { marked } from 'marked';

	let { issue, commitHash }: { issue: GitHubIssue; commitHash: string } = $props();

	function renderBody(content: string): string {
		if (!content) return '';
		try {
			return marked.parse(content, { async: false, breaks: true, gfm: true }) as string;
		} catch {
			return content;
		}
	}
</script>

<div class="rounded-xl border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] font-sans p-3.5 space-y-3 shadow-lg">
	<!-- Issue Header: Title, Number, Status & Link -->
	<div class="space-y-2 border-b border-[#21262d] pb-2.5">
		<div class="flex items-start justify-between gap-3">
			<h3 class="text-sm font-semibold text-white leading-snug">
				{issue.title}
				<span class="text-[#8b949e] font-normal">#{issue.number}</span>
			</h3>
			<a
				href={issue.html_url}
				target="_blank"
				rel="noreferrer"
				class="text-[11px] font-mono text-[#58a6ff] hover:underline flex items-center space-x-1 shrink-0 bg-[#161b22] px-2.5 py-1 rounded border border-[#30363d] hover:border-[#58a6ff]/50 transition-all"
			>
				<span>View on GitHub</span>
				<span>↗</span>
			</a>
		</div>

		<!-- Status & Meta Bar -->
		<div class="flex flex-wrap items-center gap-2 text-xs text-[#8b949e]">
			<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#238636] text-white">
				<svg aria-hidden="true" height="12" viewBox="0 0 16 16" version="1.1" width="12" fill="currentColor">
					<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path>
					<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path>
				</svg>
				<span>Open</span>
			</span>

			<span class="font-medium text-[#c9d1d9]">{issue.user}</span>
			<span>&bull;</span>
			<span class="font-mono text-[11px] text-[#58a6ff]">commit {commitHash.substring(0, 7)}</span>
		</div>
	</div>

	<!-- Issue Body -->
	<div class="rounded-lg border border-[#30363d]/80 bg-[#161b22] p-3 text-xs text-[#c9d1d9] leading-relaxed">
		<div class="prose prose-invert prose-xs max-w-none prose-headings:text-white prose-p:my-1.5 prose-code:text-[#58a6ff] prose-code:bg-[#0d1117] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-[#30363d] prose-ul:my-1.5 prose-ol:my-1.5">
			{@html renderBody(issue.body)}
		</div>
	</div>
</div>
