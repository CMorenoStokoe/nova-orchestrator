import type { ReportSummary } from '$lib/types';

class AppSelectionState {
	selectedHash = $state<string>('');
	selectedCommit = $state<ReportSummary | null>(null);

	setCommit(commit: ReportSummary | null) {
		this.selectedCommit = commit;
		this.selectedHash = commit?.hash || '';
	}

	clear() {
		this.selectedCommit = null;
		this.selectedHash = '';
	}
}

export const appSelection = new AppSelectionState();
