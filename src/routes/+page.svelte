<script lang="ts">
	import type { PageData } from './$types';
	import { marked } from 'marked';
	import {
		VIBE_CRITERIA,
		type FullReport,
		type ReportSummary,
		type FindingItem,
		type ScopedFindingContext,
		type DomainBadgeStatus,
		type GitHubIssue
	} from '$lib/types';
	import TriageDonutChart, { type CategoryData } from '$lib/components/TriageDonutChart.svelte';
	import CriteriaFailureSummary from '$lib/components/CriteriaFailureSummary.svelte';
	import { slide } from 'svelte/transition';
	import { appSelection } from '$lib/state.svelte';
	import { normalizeCommitBranches } from '$lib/git/lineage';
	import GitHubIssueCard from '$lib/components/GitHubIssueCard.svelte';

	let { data }: { data: PageData } = $props();

	// Stage 1: Triage Selection & Filtering
	let filterStatus = $state<'ALL' | 'FLAGGED' | 'SAFE' | 'RESOLVED' | 'INCOMPLETE'>('ALL');
	let branchFilter = $state<string>('ALL');
	let searchQuery = $state('');

	// Infinite Scroll Auto-Paging: automatically page in the next 25 results as user scrolls down
	let allCommits = $state<ReportSummary[]>([]);
	let nextPage = $state(2);
	let isLoadingMore = $state(false);
	let hasMore = $state(true);
	let sentinelEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (data.summaries) {
			const existing = new Set(allCommits.map((c) => c.hash));
			const fresh = data.summaries.filter((c) => !existing.has(c.hash));
			if (allCommits.length === 0) {
				allCommits = normalizeCommitBranches([...data.summaries], 'main');
				hasMore = data.summaries.length >= (data.limit || 25);
			} else if (fresh.length > 0) {
				allCommits = normalizeCommitBranches([...allCommits, ...fresh], 'main');
			}
		}
	});

	async function loadNextPage() {
		if (isLoadingMore || !hasMore) return;
		isLoadingMore = true;
		try {
			const res = await fetch(`/v1/public/get/reports/summary?page=${nextPage}&limit=25`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const newReports: ReportSummary[] = await res.json();
			if (!Array.isArray(newReports) || newReports.length === 0) {
				hasMore = false;
			} else {
				const existing = new Set(allCommits.map((c) => c.hash));
				const uniqueNew = newReports.filter((c) => !existing.has(c.hash));
				if (uniqueNew.length > 0) {
					allCommits = normalizeCommitBranches([...allCommits, ...uniqueNew], 'main');
				}
				if (newReports.length < 25) {
					hasMore = false;
				} else {
					nextPage++;
				}
			}
		} catch (err) {
			console.error('Error auto-paging next 25 commits:', err);
		} finally {
			isLoadingMore = false;
		}
	}

	function handleTimelineScroll(e: Event) {
		const target = e.currentTarget as HTMLElement;
		if (!target || isLoadingMore || !hasMore) return;
		const threshold = 160;
		if (target.scrollTop + target.clientHeight >= target.scrollHeight - threshold) {
			loadNextPage();
		}
	}

	$effect(() => {
		if (!sentinelEl) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					loadNextPage();
				}
			},
			{ rootMargin: '160px' }
		);
		observer.observe(sentinelEl);
		return () => observer.disconnect();
	});

	let branchCounts = $derived.by(() => {
		const counts: Record<string, number> = { ALL: allCommits.length };
		allCommits.forEach((c) => {
			const b = c.branch || 'main';
			counts[b] = (counts[b] || 0) + 1;
		});
		return counts;
	});

	let availableBranches = $derived.by(() => {
		const branchesSet = new Set<string>();
		allCommits.forEach((c) => {
			const b = c.branch || 'main';
			if ((branchCounts[b] || 0) > 0) {
				branchesSet.add(b);
			}
		});
		return Array.from(branchesSet).sort((a, b) => {
			if (a === 'main') return -1;
			if (b === 'main') return 1;
			return a.localeCompare(b);
		});
	});

	let selectedHash = $derived(appSelection.selectedHash);
	let selectedCommit = $derived(
		selectedHash ? (allCommits.find((s) => s.hash === selectedHash) || appSelection.selectedCommit || null) : null
	);

	$effect(() => {
		if (selectedCommit && appSelection.selectedCommit !== selectedCommit) {
			appSelection.setCommit(selectedCommit);
		}
	});

	// Top-Level Executive Summary Header: Triage Breakdown & Most Recent Flagged Commit
	let totalCommitsCount = $derived(
		Number(data.totalReports) || allCommits.length
	);

	let triageCategoryCounts = $derived.by(() => {
		if (allCommits.length > 0) {
			let safe = 0;
			let flagged = 0;
			let resolved = 0;
			let incomplete = 0;

			for (const c of allCommits) {
				if (c.resolved_by_commit || c.remediation_status === 'RESOLVED') {
					resolved++;
				} else if (c.safety_verdict === 'FLAGGED' || c.validation_status === 'FLAGGED') {
					flagged++;
				} else if (c.validation_status === 'INCOMPLETE' || c.safety_verdict === 'INCOMPLETE') {
					incomplete++;
				} else {
					safe++;
				}
			}

			return { safe, flagged, resolved, incomplete };
		}

		const safe = Number(data.stats?.safe_count) || 0;
		const flagged = Number(data.stats?.flagged_count) || 0;
		const resolved = Number(data.stats?.resolved_count) || 0;
		const total = Number(data.stats?.total_reports) || 0;
		const incomplete = Math.max(0, total - (safe + flagged + resolved));

		return { safe, flagged, resolved, incomplete };
	});

	let donutCategories = $derived<CategoryData[]>([
		{
			id: 'SAFE',
			label: 'Safe / Passed',
			count: triageCategoryCounts.safe,
			color: '#10b981'
		},
		{
			id: 'FLAGGED',
			label: 'Flagged',
			count: triageCategoryCounts.flagged,
			color: '#f43f5e'
		},
		{
			id: 'RESOLVED',
			label: 'Resolved',
			count: triageCategoryCounts.resolved,
			color: '#38bdf8'
		},
		{
			id: 'INCOMPLETE',
			label: 'Incomplete / Pending',
			count: triageCategoryCounts.incomplete,
			color: '#f59e0b'
		}
	]);

	// Primary defect rationale / Quality Marker hint for commit cards
	function getCommitDefectHint(commit: ReportSummary, fullReport?: FullReport | null) {
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
				name: 'Quality Marker Flagged',
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
	}

	function focusStage2Detail() {
		const el = document.getElementById('stage-2-detail');
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	}

	// Stage 2: Exception Drill-down Cache
	let fullReports = $state<Record<string, FullReport>>({});
	let loadingReport = $state(false);

	// Expanded state for passing criteria (collapsed by default per Optimization 1)
	let showPassingCriteria = $state(false);
	// Streamlined full details state (collapsed by default behind grey button)
	let showFullDetails = $state(false);

	// Stage 3 & 4: Scoped Interrogation Drawer
	let isChatDrawerOpen = $state(false);
	let activeScopedFinding = $state<ScopedFindingContext | null>(null);
	let chatMessages = $state<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
	let chatInput = $state('');
	let isChatSending = $state(false);
	let isGeneratingPlan = $state(false);
	let chatContainerEl = $state<HTMLDivElement | null>(null);

	// Stage 3 & 4: Commit-Level Fix Drafter & GitHub Issue State
	let activeDraftCommit = $state<ReportSummary | null>(null);
	let draftIssueTitle = $state<string>('');
	let draftIssueBody = $state<string>('');
	let loggedGithubIssues = $state<Record<string, GitHubIssue>>({});
	let isFilingIssue = $state(false);

	// Stage 4 & 5: Remediation Spec & Sign-off
	let remediationPlan = $state<{
		id: string;
		commit_hash: string;
		issue_id?: string;
		title: string;
		plan_markdown: string;
		status: 'PENDING_APPROVAL' | 'RESOLVED';
	} | null>(null);
	let isApproving = $state(false);
	let approvalSuccess = $state(false);

	// Unified Audit Trail & Pipeline Step Execution Drawer
	let isAuditDrawerOpen = $state(false);
	let auditTrailLoading = $state(false);
	let auditTrailData = $state<{
		commit_hash: string;
		total_events: number;
		steps_count: number;
		audit_logs_count: number;
		events: any[];
		audit_logs: any[];
		steps: any[];
	} | null>(null);
	let auditTrailCache = $state<Record<string, any>>({});
	let auditTrailFilter = $state<'ALL' | 'STEPS' | 'AUDIT'>('ALL');
	let auditTrailSearch = $state('');
	let auditTrailSort = $state<'ASC' | 'DESC'>('DESC');

	async function openAuditTrail(hash: string) {
		isAuditDrawerOpen = true;
		auditTrailLoading = true;

		try {
			const res = await fetch(`/v1/public/get/reports/audit?hash=${encodeURIComponent(hash)}`);
			if (res.ok) {
				const data = await res.json();
				auditTrailData = data;
				auditTrailCache[hash] = data;
			} else {
				fallbackAuditData(hash);
			}
		} catch (e) {
			console.error('Failed to load audit trail:', e);
			fallbackAuditData(hash);
		} finally {
			auditTrailLoading = false;
		}
	}

	function fallbackAuditData(hash: string) {
		const steps = fullReports[hash]?.steps || [];
		const matchedLogs = (data.recentAuditLogs || []).filter(
			(l: any) => l.target_id === hash || l.details?.commitHash === hash || l.details?.commit_hash === hash
		);
		const events = [
			...steps.map((s: any) => ({
				id: `step-${s.step_index}-${s.node}`,
				timestamp: s.timestamp || new Date().toISOString(),
				type: 'PIPELINE_STEP',
				action: s.node,
				actor: 'nova-orchestrator',
				status: s.status,
				score: s.score,
				comment: s.comment || s.summary || (s.status === 'PASS' ? 'Quality Marker validated successfully.' : 'Step finished.'),
				criterion_code: s.criterion_code,
				execution_status: s.execution_status,
				details: {
					step_index: s.step_index,
					node: s.node,
					findings_count: s.findings?.length || 0
				}
			})),
			...matchedLogs.map((l: any) => {
				const details = typeof l.details === 'string' ? JSON.parse(l.details) : l.details;
				return {
					id: `audit-${l.id}`,
					timestamp: new Date(l.created_at).toISOString(),
					type: l.action.includes('APPROVE') ? 'GOVERNANCE' : 'AUDIT_LOG',
					action: l.action,
					actor: l.actor || 'system',
					status: details?.validationStatus || details?.status || 'INFO',
					score: details?.compositeScore ?? details?.score ?? null,
					comment: details?.reason || details?.summary || `Audit record for ${l.action}`,
					details
				};
			})
		];
		events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
		const synthesized = {
			commit_hash: hash,
			total_events: events.length,
			steps_count: steps.length,
			audit_logs_count: matchedLogs.length,
			events,
			audit_logs: matchedLogs,
			steps
		};
		auditTrailData = synthesized;
		auditTrailCache[hash] = synthesized;
	}

	// Filtered Commits
	let filteredCommits = $derived(
		allCommits.filter((c) => {
			const matchesFilter =
				filterStatus === 'ALL' ||
				(filterStatus === 'FLAGGED' && (c.safety_verdict === 'FLAGGED' || c.validation_status === 'FLAGGED') && !c.resolved_by_commit && c.remediation_status !== 'RESOLVED') ||
				(filterStatus === 'SAFE' && (c.safety_verdict === 'SAFE' || c.validation_status === 'SAFE')) ||
				(filterStatus === 'RESOLVED' && (Boolean(c.resolved_by_commit) || c.remediation_status === 'RESOLVED')) ||
				(filterStatus === 'INCOMPLETE' && (c.validation_status === 'INCOMPLETE' || c.safety_verdict === 'INCOMPLETE'));

			const matchesBranch =
				branchFilter === 'ALL' ||
				(c.branch && c.branch.toLowerCase() === branchFilter.toLowerCase());

			const q = searchQuery.toLowerCase().trim();
			const matchesSearch =
				!q ||
				c.hash.toLowerCase().includes(q) ||
				(c.message && c.message.toLowerCase().includes(q)) ||
				(c.author && c.author.toLowerCase().includes(q)) ||
				(c.branch && c.branch.toLowerCase().includes(q));

			return matchesFilter && matchesBranch && matchesSearch;
		})
		.slice()
		.sort((a, b) => {
			const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
			const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
			return timeB - timeA; // Newest first, oldest last
		})
	);

	// Helper for relative/formatted timestamp
	function formatCommitDate(dateStr?: string): string {
		if (!dateStr) return '';
		try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return dateStr;
			const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
			if (diffSec < 60) return 'just now';
			const diffMin = Math.floor(diffSec / 60);
			if (diffMin < 60) return `${diffMin}m ago`;
			const diffHr = Math.floor(diffMin / 60);
			if (diffHr < 24) return `${diffHr}h ago`;
			const diffDay = Math.floor(diffHr / 24);
			if (diffDay < 30) return `${diffDay}d ago`;
			return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
		} catch {
			return dateStr;
		}
	}

	interface GitGraphLaneColor {
		stroke: string;
		fill: string;
		badgeClass: string;
	}

	const LANE_PALETTE: GitGraphLaneColor[] = [
		{
			stroke: '#06b6d4', // cyan-500
			fill: '#0891b2',   // cyan-600
			badgeClass: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60'
		},
		{
			stroke: '#a855f7', // purple-500
			fill: '#9333ea',   // purple-600
			badgeClass: 'bg-purple-950/80 text-purple-300 border-purple-800/60'
		},
		{
			stroke: '#3b82f6', // blue-500
			fill: '#2563eb',   // blue-600
			badgeClass: 'bg-blue-950/80 text-blue-300 border-blue-800/60'
		},
		{
			stroke: '#f59e0b', // amber-500
			fill: '#d97706',   // amber-600
			badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-800/60'
		},
		{
			stroke: '#ec4899', // pink-500
			fill: '#db2777',   // pink-600
			badgeClass: 'bg-pink-950/80 text-pink-300 border-pink-800/60'
		},
		{
			stroke: '#10b981', // emerald-500
			fill: '#059669',   // emerald-600
			badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
		}
	];

	interface ForkInItem {
		fromLane: number;
		color: GitGraphLaneColor;
		branchName?: string;
		fromHash?: string;
	}

	interface GitGraphItem {
		commit: ReportSummary;
		lane: number;
		color: GitGraphLaneColor;
		x: number;
		isHead: boolean;
		isRoot: boolean;
		hasUpperLine: boolean;
		hasLowerLine: boolean;
		forksIn: ForkInItem[];
		isBranchRoot?: boolean;
		isBranchTip?: boolean;
		forkedFromBranch?: string;
		forkedFromHash?: string;
		mergedBranchName?: string;
		activeLanes: number[];
	}

	const LANE_WIDTH = 22;
	const LANE_OFFSET = 18;

	let gitGraphData = $derived.by(() => {
		const commits = filteredCommits;
		if (commits.length === 0) {
			return { items: [] as GitGraphItem[], maxLane: 0, trackWidth: 38 };
		}

		// 0. Quick index lookup map for commits by full SHA and 7-character prefix
		const commitIndexMap = new Map<string, number>();
		commits.forEach((c, idx) => {
			commitIndexMap.set(c.hash, idx);
			if (c.hash.length >= 7) {
				commitIndexMap.set(c.hash.substring(0, 7), idx);
			}
		});

		// 1. Assign branch lanes
		const branchToLane = new Map<string, number>();
		const primaryBranch = data.branch || 'main';
		branchToLane.set(primaryBranch, 0);
		branchToLane.set('main', 0);
		branchToLane.set('master', 0);

		let nextLane = 1;
		commits.forEach((c) => {
			const b = c.branch || primaryBranch;
			if (!branchToLane.has(b)) {
				branchToLane.set(b, nextLane % LANE_PALETTE.length);
				nextLane++;
			}
		});

		let maxLane = 0;
		const commitLanes = commits.map((c) => {
			const b = c.branch || primaryBranch;
			const lane = branchToLane.get(b) ?? 0;
			if (lane > maxLane) maxLane = lane;
			return lane;
		});

		// Find first (newest/top) and last (oldest/bottom) appearance for each lane
		const laneFirst = new Map<number, number>();
		const laneLast = new Map<number, number>();
		commitLanes.forEach((lane, idx) => {
			if (!laneFirst.has(lane)) laneFirst.set(lane, idx);
			laneLast.set(lane, idx);
		});

		// For each commit, find its parent commit indices in the visible list
		const commitParentIndices: number[][] = commits.map((commit, idx) => {
			const parents = commit.parents || commit.parent_shas || [];
			const foundIndices: number[] = [];
			for (const p of parents) {
				const foundIdx = commitIndexMap.get(p) ?? commitIndexMap.get(p.substring(0, 7));
				if (foundIdx !== undefined && foundIdx > idx) {
					foundIndices.push(foundIdx);
				}
			}
			return foundIndices;
		});

		// Track cross-lane branch connectors (e.g. from child commit idx on feature branch down to parentIdx on trunk)
		const branchConnectors: Array<{
			fromIdx: number;
			toIdx: number;
			childLane: number;
			parentLane: number;
			branchName?: string;
			fromHash?: string;
		}> = [];

		commits.forEach((commit, idx) => {
			const lane = commitLanes[idx];
			const parentIndices = commitParentIndices[idx];

			for (const parentIdx of parentIndices) {
				const pLane = commitLanes[parentIdx];
				if (lane !== pLane) {
					branchConnectors.push({
						fromIdx: idx,
						toIdx: parentIdx,
						childLane: lane,
						parentLane: pLane,
						branchName: commit.branch,
						fromHash: commit.hash.substring(0, 7)
					});
				}
			}
		});

		const items: GitGraphItem[] = commits.map((commit, idx) => {
			const lane = commitLanes[idx];
			const color = LANE_PALETTE[lane % LANE_PALETTE.length];
			const x = LANE_OFFSET + lane * LANE_WIDTH;

			const isFirstOfLane = laneFirst.get(lane) === idx;
			const isLastOfLane = laneLast.get(lane) === idx;

			// Upper line: if this lane continues from above
			const hasUpperLine = !isFirstOfLane;

			// Lower line:
			// For trunk (lane 0): continues if not the very last commit of trunk
			// For feature branches: continues if not the last commit of that lane OR it branches down to a parent commit
			const hasConnectorBelow = branchConnectors.some(
				(conn) => conn.fromIdx === idx && conn.childLane === lane
			);
			const hasLowerLine = !isLastOfLane || hasConnectorBelow;

			// Incoming branch forks arriving at this parent commit
			const forksIn: ForkInItem[] = [];
			branchConnectors.forEach((conn) => {
				if (conn.toIdx === idx) {
					forksIn.push({
						fromLane: conn.childLane,
						color: LANE_PALETTE[conn.childLane % LANE_PALETTE.length],
						branchName: conn.branchName,
						fromHash: conn.fromHash
					});
				}
			});

			// Branch Origin details (for badge and metadata)
			const parents = commit.parents || commit.parent_shas || [];
			let parentCommit: ReportSummary | undefined;
			if (commitParentIndices[idx].length > 0) {
				parentCommit = commits[commitParentIndices[idx][0]];
			}

			let isBranchRoot = false;
			let forkedFromBranch: string | undefined;
			let forkedFromHash: string | undefined;

			if (lane !== 0 && (isLastOfLane || hasConnectorBelow)) {
				isBranchRoot = true;
				forkedFromBranch = parentCommit?.branch || 'main';
				forkedFromHash = parentCommit?.hash
					? parentCommit.hash.substring(0, 7)
					: parents[0]
					? parents[0].substring(0, 7)
					: undefined;
			}

			// Branch Merge: if this commit on main merges from a feature branch
			let mergedBranchName: string | undefined;
			if (lane === 0) {
				for (const p of parents) {
					const foundIdx = commitIndexMap.get(p) ?? commitIndexMap.get(p.substring(0, 7));
					if (foundIdx !== undefined && commitLanes[foundIdx] !== 0) {
						mergedBranchName = commits[foundIdx].branch;
						break;
					}
				}
			}

			// Active lanes passing through this row:
			// 1. Trunk (lane 0) passes through whenever it exists both above and below this row
			// 2. Branch connectors running parallel downwards from child commit to parent commit
			const activeLanesSet = new Set<number>();

			const trunkFirst = laneFirst.get(0);
			const trunkLast = laneLast.get(0);
			if (lane !== 0 && trunkFirst !== undefined && trunkLast !== undefined && trunkFirst < idx && idx < trunkLast) {
				activeLanesSet.add(0);
			}

			for (const conn of branchConnectors) {
				if (conn.fromIdx < idx && idx < conn.toIdx) {
					if (conn.childLane !== lane) {
						activeLanesSet.add(conn.childLane);
					}
				}
			}

			const activeLanes = Array.from(activeLanesSet).sort((a, b) => a - b);

			return {
				commit,
				lane,
				color,
				x,
				isHead: idx === 0,
				isRoot: idx === commits.length - 1,
				hasUpperLine,
				hasLowerLine,
				forksIn,
				isBranchRoot,
				isBranchTip: lane !== 0 && isFirstOfLane,
				forkedFromBranch,
				forkedFromHash,
				mergedBranchName,
				activeLanes
			};
		});

		const trackWidth = Math.max(38, (maxLane + 1) * LANE_WIDTH + 16);

		return { items, maxLane, trackWidth };
	});


	// Expanded state for defect code diff hunks (hidden by default)
	let expandedDiffs = $state<Record<string, boolean>>({});

	function toggleDiff(findingId: string) {
		expandedDiffs[findingId] = !expandedDiffs[findingId];
	}

	function getFindingCriterion(finding: FindingItem) {
		if (finding.criterion_code) {
			const c = VIBE_CRITERIA.find((item) => item.code === finding.criterion_code);
			if (c) return c;
		}
		if (finding.domain) {
			const c = VIBE_CRITERIA.find((item) => item.key === finding.domain || item.code === finding.domain);
			if (c) return c;
		}
		if (finding.id) {
			for (const c of VIBE_CRITERIA) {
				const num = c.code.replace('VBC-', '');
				if (finding.id.includes(c.code) || finding.id.includes(`L${num}`) || finding.id.includes(`V${num}`)) {
					return c;
				}
			}
		}
		return null;
	}

	function getFindingTheme(finding: FindingItem, failedCrit?: any) {
		const code = (failedCrit?.code || finding.criterion_code || '').toUpperCase();
		const domain = (finding.domain || '').toLowerCase();
		const severity = (finding.severity || '').toUpperCase();

		// Security & Safety (VBC-08, VBC-09, VBC-10)
		if (
			code === 'VBC-08' ||
			code === 'VBC-09' ||
			code === 'VBC-10' ||
			domain.includes('sec') ||
			domain.includes('safe')
		) {
			return {
				bg: 'bg-rose-950/20 border-rose-800/40',
				badge: 'bg-rose-950/90 text-rose-300 border-rose-700/60',
				text: 'text-rose-200',
				accent: 'text-rose-400',
				icon: '🛡️'
			};
		}
		// Architecture, Problem Decomposition & Ontology (VBC-01, VBC-02, VBC-04, VBC-05)
		if (
			code === 'VBC-01' ||
			code === 'VBC-02' ||
			code === 'VBC-04' ||
			code === 'VBC-05' ||
			domain.includes('decomp') ||
			domain.includes('arch') ||
			domain.includes('intent') ||
			domain.includes('onto')
		) {
			return {
				bg: 'bg-purple-950/20 border-purple-800/40',
				badge: 'bg-purple-950/90 text-purple-300 border-purple-700/60',
				text: 'text-purple-200',
				accent: 'text-purple-300',
				icon: '🧩'
			};
		}
		// Testing, Invariants & Verification (VBC-11, VBC-12, VBC-13)
		if (
			code === 'VBC-11' ||
			code === 'VBC-12' ||
			code === 'VBC-13' ||
			domain.includes('test') ||
			domain.includes('verif') ||
			domain.includes('tst')
		) {
			return {
				bg: 'bg-sky-950/20 border-sky-800/40',
				badge: 'bg-sky-950/90 text-sky-300 border-sky-700/60',
				text: 'text-sky-200',
				accent: 'text-sky-300',
				icon: '🧪'
			};
		}
		// Context Economics, Querying & Performance (VBC-03, VBC-06, VBC-07)
		if (
			code === 'VBC-03' ||
			code === 'VBC-06' ||
			code === 'VBC-07' ||
			domain.includes('context') ||
			domain.includes('search') ||
			domain.includes('perf') ||
			domain.includes('econ')
		) {
			return {
				bg: 'bg-amber-950/20 border-amber-800/40',
				badge: 'bg-amber-950/90 text-amber-300 border-amber-700/60',
				text: 'text-amber-200',
				accent: 'text-amber-400',
				icon: '⚡'
			};
		}
		// Operations, Lifecycle & Observability (VBC-14, VBC-15, VBC-16, VBC-17)
		if (code.startsWith('VBC-1') || domain.includes('ops') || domain.includes('doc')) {
			return {
				bg: 'bg-emerald-950/20 border-emerald-800/40',
				badge: 'bg-emerald-950/90 text-emerald-300 border-emerald-700/60',
				text: 'text-emerald-200',
				accent: 'text-emerald-400',
				icon: '⚙️'
			};
		}

		// Fallback by severity
		if (severity === 'CRITICAL') {
			return {
				bg: 'bg-rose-950/20 border-rose-800/40',
				badge: 'bg-rose-950/90 text-rose-300 border-rose-700/60',
				text: 'text-rose-200',
				accent: 'text-rose-400',
				icon: '⚠️'
			};
		}
		if (severity === 'HIGH') {
			return {
				bg: 'bg-amber-950/20 border-amber-800/40',
				badge: 'bg-amber-950/90 text-amber-300 border-amber-700/60',
				text: 'text-amber-200',
				accent: 'text-amber-400',
				icon: '⚠️'
			};
		}

		return {
			bg: 'bg-[#110D17]/80 border-[#DDEBFB]/10',
			badge: 'bg-slate-900 text-slate-300 border-slate-700',
			text: 'text-slate-200',
			accent: 'text-slate-400',
			icon: 'ℹ️'
		};
	}

	// On selection change, load full report asynchronously
	$effect(() => {
		if (selectedHash) {
			loadFullReport(selectedHash);
			showPassingCriteria = false;
			showFullDetails = false;
			expandedDiffs = {};
		}
	});

	// Helper to syntax color diff hunks (Stage 2 & Stage 4)
	function parseDiffLines(diffText?: string) {
		if (!diffText) return [];
		return diffText.split('\n').map((line) => {
			let type: 'add' | 'del' | 'header' | 'hunk' | 'normal' = 'normal';
			if (line.startsWith('+++') || line.startsWith('---')) {
				type = 'header';
			} else if (line.startsWith('@@')) {
				type = 'hunk';
			} else if (line.startsWith('+')) {
				type = 'add';
			} else if (line.startsWith('-')) {
				type = 'del';
			}
			return { text: line, type };
		});
	}

	// Constraint 3: Auto-poll live stages silently while INCOMPLETE
	$effect(() => {
		const target = selectedCommit;
		if (target && target.validation_status === 'INCOMPLETE') {
			const targetHash = target.hash;
			const pollTimer = setInterval(async () => {
				try {
					const res = await fetch(`/v1/public/get/reports/full?hash=${targetHash}`);
					if (res.ok) {
						const updated = await res.json();
						fullReports[targetHash] = updated;

						if (updated.validation_status !== 'INCOMPLETE') {
							// Update summary state reactively
							const summaryItem = data.summaries.find((s) => s.hash === targetHash);
							if (summaryItem) {
								summaryItem.validation_status = updated.validation_status;
								summaryItem.safety_verdict = updated.validation_status;
							}
							clearInterval(pollTimer);
						}
					}
				} catch {
					// Silent fallback
				}
			}, 3000);

			return () => clearInterval(pollTimer);
		}
	});

	// In-flight request deduplication map to prevent duplicate parallel fetches
	const inFlightReports = new Map<string, Promise<FullReport | null>>();

	// Proactively prefetch latest commit on load so initial click is instant (< 10 ms)
	$effect(() => {
		const firstHash = gitGraphData.items[0]?.commit?.hash || data.summaries[0]?.hash;
		if (firstHash) {
			prefetchReport(firstHash);
		}
	});

	async function loadFullReport(hash: string, options: { silent?: boolean } = {}): Promise<FullReport | null> {
		if (!hash) return null;

		// 1. Instant Cache Hit (< 1 ms): Already fetched and parsed in memory
		if (fullReports[hash]) {
			if (selectedHash === hash && fullReports[hash].remediation_plan) {
				remediationPlan = fullReports[hash].remediation_plan;
			}
			return fullReports[hash];
		}

		// 2. In-Flight Request Deduplication: Re-use the existing active promise
		if (inFlightReports.has(hash)) {
			if (!options.silent && selectedHash === hash && !fullReports[hash]) {
				loadingReport = true;
			}
			const existing = await inFlightReports.get(hash);
			if (selectedHash === hash) {
				loadingReport = false;
				if (existing?.remediation_plan) {
					remediationPlan = existing.remediation_plan;
				}
			}
			return existing ?? null;
		}

		// 3. Initiate single network fetch
		if (!options.silent && selectedHash === hash) {
			loadingReport = true;
		}

		const fetchPromise = (async () => {
			try {
				const res = await fetch(`/v1/public/get/reports/full?hash=${hash}`);
				if (res.ok) {
					const full: FullReport = await res.json();

					// Ensure all findings have real diff hunks and no synthetic metadata
					if (Array.isArray(full.findings_list)) {
						full.findings_list = full.findings_list.filter((f: FindingItem) => {
							// Filter out any older synthetic parser errors
							return !f.reasoning?.includes('Automated parser error') && !f.title?.includes('Automated parser error');
						});
					}

					// If finding list is absent, derive strictly from structured findings
					if (!full.findings_list || full.findings_list.length === 0) {
						const derivedFindings: FindingItem[] = [];
						const sourceMap = full.criteria || full.domains;
						if (sourceMap) {
							for (const [critKey, critVal] of Object.entries(sourceMap as Record<string, any>)) {
								if (critVal.status !== 'PASS' && critVal.execution_status === 'VALIDATED') {
									const findingsArr = Array.isArray(critVal.findings) ? critVal.findings : [];
									findingsArr.forEach((item: any, idx: number) => {
										const critDef = VIBE_CRITERIA.find((c) => c.key === critKey);
										const prefix = critDef ? critDef.code : critKey.substring(0, 3).toUpperCase();
										if (typeof item === 'object' && item !== null) {
											derivedFindings.push({
												id: item.id || `${prefix}-${idx + 1}`,
												domain: critKey,
												title: item.title || 'Identified finding',
												severity: item.severity || (critVal.status === 'FAIL' ? 'CRITICAL' : 'HIGH'),
												reasoning: item.reasoning || item.title || '',
												file_path: item.file_path,
												diff_hunk: item.diff_hunk && !item.diff_hunk.startsWith('Changed files:') ? item.diff_hunk : undefined,
												recommendation: item.recommendation
											});
										}
									});
								}
							}
						}
						full.findings_list = derivedFindings;
					}

					// Store in reactive memory cache
					fullReports[hash] = full;
					if (selectedHash === hash && full.remediation_plan) {
						remediationPlan = full.remediation_plan;
					}
					return full;
				}
				return null;
			} catch (e) {
				console.error('Error loading report', e);
				return null;
			} finally {
				inFlightReports.delete(hash);
				if (selectedHash === hash) {
					loadingReport = false;
				}
			}
		})();

		inFlightReports.set(hash, fetchPromise);
		return await fetchPromise;
	}

	function prefetchReport(hash?: string | null) {
		if (!hash) return;
		if (fullReports[hash] || inFlightReports.has(hash)) return;
		// Silently prefetch in background without showing loading skeleton
		loadFullReport(hash, { silent: true });
	}

	function cleanChatContent(text: string): string {
		if (!text) return '';
		return text
			.replace(/f:\{"messageId":"[^"]*"\}\s*/g, '')
			.replace(/^f:\{.*?\}\s*/gm, '')
			.replace(/^[0-9]+:"/gm, '')
			.replace(/^d:\{.*?\}\s*/gm, '')
			.replace(/^e:\{.*?\}\s*/gm, '')
			.trimStart();
	}

	function renderMarkdown(content: string): string {
		if (!content) return '';
		try {
			const cleaned = cleanChatContent(content);
			return marked.parse(cleaned, { async: false, breaks: true, gfm: true }) as string;
		} catch {
			return cleanChatContent(content);
		}
	}

	function scrollChatToBottom(smooth = false) {
		if (chatContainerEl) {
			chatContainerEl.scrollTo({
				top: chatContainerEl.scrollHeight,
				behavior: smooth ? 'smooth' : 'auto'
			});
		}
	}

	function selectCommit(hash: string) {
		if (selectedHash === hash) {
			appSelection.clear();
			return;
		}
		const target =
			data.summaries.find((s) => s.hash === hash) ||
			gitGraphData.items.find((i) => i.commit.hash === hash)?.commit ||
			null;
		appSelection.setCommit(target);
		if (hash) {
			const detailEl = document.getElementById('stage-2-detail');
			if (detailEl && window.innerWidth < 640) {
				detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
		}
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (isChatDrawerOpen || isAuditDrawerOpen) return;
		const activeTag = (document.activeElement?.tagName || '').toLowerCase();
		if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
		if ((document.activeElement as HTMLElement)?.isContentEditable) return;

		if (!selectedHash && (e.key === 'Enter' || e.key === 'ArrowDown')) {
			const firstCommit = gitGraphData.items[0]?.commit || data.summaries[0];
			if (firstCommit) {
				e.preventDefault();
				selectCommit(firstCommit.hash);
			}
		}
	}

	function commitHasFlaggedIssues(commit: ReportSummary | null): boolean {
		if (!commit) return false;
		if (commit.resolved_by_commit || commit.remediation_status === 'RESOLVED') return false;
		if (commit.safety_verdict === 'FLAGGED' || commit.validation_status === 'FLAGGED') return true;
		if (commit.flag_count && commit.flag_count > 0) return true;
		const badges = { ...(commit.domain_badges || {}), ...(commit.criteria_badges || {}) };
		return Object.values(badges).some((status) => status === 'FAIL' || status === 'WARN');
	}

	function commitIsResolved(commit: ReportSummary | null): boolean {
		if (!commit) return false;
		return Boolean(commit.resolved_by_commit) || commit.remediation_status === 'RESOLVED';
	}

	function getCommitLoggedIssue(commit: ReportSummary | null): GitHubIssue | null {
		if (!commit) return null;
		if (loggedGithubIssues[commit.hash]) return loggedGithubIssues[commit.hash];
		if (commit.resolved_by_commit && commit.resolved_by_commit.startsWith('gh-issue-')) {
			const numStr = commit.resolved_by_commit.replace('gh-issue-', '');
			const issueNum = parseInt(numStr, 10) || 142;
			return {
				id: 90000 + issueNum,
				number: issueNum,
				title: `fix(${commit.branch || 'main'}): remediate Quality Marker defects for commit ${commit.hash.substring(0, 7)}`,
				html_url: `https://github.com/project/terminus/issues/${issueNum}`,
				body: `### Defect & Remediation Summary\n\nGitHub Issue logged to track remediation of flagged Quality Markers (of AI-Generated Code) for commit \`${commit.hash.substring(0, 7)}\` (*"${commit.message}"*).\n\nCommit has been marked as **RESOLVED** across all governance pipeline records.`,
				labels: ['quality-markers', 'ai-generated-code', 'remediation'],
				state: 'open',
				user: 'nova-orchestrator[bot]',
				created_at: new Date().toISOString()
			};
		}
		return null;
	}

	// Refactored Top-Level Commit Fix Drafter
	function openCommitDraftIssue(commit: ReportSummary | null, specificFinding?: FindingItem) {
		if (!commit) return;
		activeDraftCommit = commit;
		activeScopedFinding = specificFinding
			? {
					hash: commit.hash,
					issue_id: specificFinding.id,
					domain_category: specificFinding.domain,
					diff_hunk: specificFinding.diff_hunk,
					file_path: specificFinding.file_path,
					finding_reasoning: specificFinding.reasoning
			  }
			: null;

		const fullReport = fullReports[commit.hash];
		const findingsList = fullReport?.findings_list || [];

		const flaggedCodes: string[] = [];
		const badges = { ...(commit.domain_badges || {}), ...(commit.criteria_badges || {}) };
		for (const [code, status] of Object.entries(badges)) {
			if (status === 'FAIL' || status === 'WARN') {
				flaggedCodes.push(code);
			}
		}

		const defTitle = specificFinding
			? `fix(${commit.branch || 'main'}): resolve [${specificFinding.id}] ${specificFinding.title} in ${commit.hash.substring(0, 7)}`
			: `fix(${commit.branch || 'main'}): remediate Quality Marker defects for commit ${commit.hash.substring(0, 7)}`;
		draftIssueTitle = defTitle;

		const markersText = flaggedCodes.length > 0
			? flaggedCodes.map((c) => `- **${c}**: Flagged for potential defect or regression`).join('\n')
			: '- Flagged Quality Markers requiring atomic developer remediation';

		const findingsSummary = specificFinding
			? `- **[${specificFinding.id}] ${specificFinding.title}**: ${specificFinding.reasoning}`
			: findingsList.length > 0
			? findingsList.map((f) => `- **[${f.id}] ${f.title}**: ${f.reasoning}`).join('\n')
			: (commit.high_level_intent || commit.material_changes_summary || 'Autonomous review identified defects requiring atomic remediation.');

		const defBody = `### Problem Statement\nCommit \`${commit.hash.substring(0, 7)}\` (*"${commit.message}"*) has flagged Quality Markers:\n\n${markersText}\n\n### Defect Critique\n${findingsSummary}\n\n### Proposed Remediation Plan\n1. Decompose changes into isolated, dependency-ordered atomic commits.\n2. Enforce strict type validation and null safety across modified modules.\n3. Verify test harness passes with zero regressions.`;
		draftIssueBody = defBody;

		chatMessages = [
			{
				role: 'assistant',
				content: `### 🛠️ Proposed GitHub Issue Draft\n\n**Issue Title**: \`${defTitle}\`\n\n**Target Commit**: \`${commit.hash}\` (*"${commit.message}"*)\n\n#### Defect Summary\n${markersText}\n\n#### Critique & Problem Statement\n${findingsSummary}\n\n#### Proposed Remediation Steps\n1. **Isolate Changes**: Decompose modifications into isolated atomic commits.\n2. **Defensive Validation**: Enforce null checks and strict contract guarantees.\n3. **Harness Verification**: Run regression suites across modified files.\n\n---\n💬 *Review and discuss what this issue should say. You can suggest modifications to the title, problem statement, or remediation strategy. When satisfied, provide verbatim sign-off by saying **"Approve"** (or click the button below) to file the issue on GitHub and resolve this commit.*`
			}
		];

		approvalSuccess = commitIsResolved(commit);
		isChatDrawerOpen = true;
		setTimeout(() => scrollChatToBottom(false), 50);
	}

	function openScopedChat(finding: FindingItem, hash: string) {
		const commit = allCommits.find((c) => c.hash === hash) || selectedCommit;
		if (commit) {
			openCommitDraftIssue(commit, finding);
		}
	}

	async function executeApproveAndFileGithub(commit: ReportSummary) {
		if (isFilingIssue || isApproving) return;
		isFilingIssue = true;
		isApproving = true;

		chatMessages = [
			...chatMessages,
			{
				role: 'assistant',
				content: `⏳ **Verbatim sign-off confirmed.** Logging issue on GitHub for commit \`${commit.hash.substring(0, 7)}\` and marking commit as RESOLVED...`
			}
		];
		setTimeout(() => scrollChatToBottom(true), 30);

		try {
			const res = await fetch('/v1/public/post/approve', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-passcode': 'nova_passcode_2026'
				},
				body: JSON.stringify({
					commit_hash: commit.hash,
					plan_id: remediationPlan?.id,
					issue_title: draftIssueTitle || `fix: remediate Quality Markers for commit ${commit.hash.substring(0, 7)}`,
					issue_body: draftIssueBody || (remediationPlan?.plan_markdown || `Remediation plan approved for commit ${commit.hash}`),
					approver: 'human_reviewer',
					issue_labels: ['quality-markers', 'ai-generated-code', 'remediation']
				})
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			const body = await res.json();

			if (body.github_issue) {
				loggedGithubIssues[commit.hash] = body.github_issue;
			}

			// Update in commit and allCommits
			const issueRef = body.resolved_by_commit || `gh-issue-${body.github_issue?.number || 'resolved'}`;
			commit.resolved_by_commit = issueRef;
			commit.remediation_status = 'RESOLVED';

			if (remediationPlan) {
				remediationPlan.status = 'RESOLVED';
			}

			allCommits = allCommits.map((c) => (c.hash === commit.hash ? { ...c, resolved_by_commit: issueRef, remediation_status: 'RESOLVED' } : c));
			if (selectedCommit && selectedCommit.hash === commit.hash) {
				selectedCommit = { ...selectedCommit, resolved_by_commit: issueRef, remediation_status: 'RESOLVED' };
			}

			approvalSuccess = true;

			chatMessages = [
				...chatMessages,
				{
					role: 'assistant',
					content: `✅ **GitHub Issue #${body.github_issue?.number} Logged Successfully!**\n\nThe issue has been logged in GitHub and commit \`${commit.hash.substring(0, 7)}\` has been marked as **RESOLVED** across all governance pipeline records.`
				}
			];
		} catch (err: any) {
			console.error('Failed to log GitHub issue:', err);
			chatMessages = [
				...chatMessages,
				{
					role: 'assistant',
					content: `⚠️ Failed to log GitHub issue: ${err.message}`
				}
			];
		} finally {
			isFilingIssue = false;
			isApproving = false;
			setTimeout(() => scrollChatToBottom(true), 60);
		}
	}

	// Stage 3: Send chat message
	async function sendChatMessage() {
		if (!chatInput.trim() || isChatSending || isFilingIssue) return;

		const userMsg = chatInput.trim();
		chatMessages = [...chatMessages, { role: 'user', content: userMsg }];
		chatInput = '';

		// Check for verbatim sign-off saying "Approve"
		const isVerbatimApproval =
			/^(approve|approved|i approve|approve this|lgtm|please approve)\b/i.test(userMsg) ||
			userMsg.toLowerCase().trim() === 'approve';

		const targetCommit = activeDraftCommit || selectedCommit;
		if (isVerbatimApproval && targetCommit && !commitIsResolved(targetCommit)) {
			await executeApproveAndFileGithub(targetCommit);
			return;
		}

		isChatSending = true;
		setTimeout(() => scrollChatToBottom(true), 40);

		try {
			const res = await fetch('/v1/public/post/chat', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-passcode': 'nova_passcode_2026'
				},
				body: JSON.stringify({
					messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
					current_commit: targetCommit,
					scoped_finding: activeScopedFinding
				})
			});

			if (!res.ok) throw new Error(res.statusText);

			const reader = res.body?.getReader();
			const decoder = new TextDecoder();
			let reply = '';
			chatMessages = [...chatMessages, { role: 'assistant', content: '' }];

			if (reader) {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const chunk = decoder.decode(value, { stream: true });
					reply += chunk;
					chatMessages[chatMessages.length - 1].content = cleanChatContent(reply);
					scrollChatToBottom(false);
				}
			}

			// If assistant proposed an updated issue title / body, update state
			if (reply) {
				const titleMatch = reply.match(/\*\*Issue Title\*\*:\s*`([^`]+)`/i);
				if (titleMatch && titleMatch[1]) {
					draftIssueTitle = titleMatch[1].trim();
				}
				draftIssueBody = reply;
			}
		} catch (err: any) {
			chatMessages = [...chatMessages, { role: 'assistant', content: `Error: ${err.message}` }];
		} finally {
			isChatSending = false;
			setTimeout(() => scrollChatToBottom(true), 50);
		}
	}

	// Stage 4: Thirty-Second Remediation Specification (Lock and Plan)
	async function lockAndPlanFix() {
		const targetCommit = activeDraftCommit || selectedCommit;
		if (isGeneratingPlan || !targetCommit) return;
		isGeneratingPlan = true;

		try {
			chatMessages = [
				...chatMessages,
				{
					role: 'user',
					content: 'Lock discussion and formulate formal remediation specification with code patch.'
				}
			];
			setTimeout(() => scrollChatToBottom(true), 40);

			const res = await fetch('/v1/public/post/plan', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-passcode': 'nova_passcode_2026'
				},
				body: JSON.stringify({
					messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
					current_commit: targetCommit,
					scoped_finding: activeScopedFinding
				})
			});

			const planId = res.headers.get('x-nova-plan-id') || `plan_${Date.now()}`;
			const reader = res.body?.getReader();
			const decoder = new TextDecoder();
			let patchMarkdown = '';

			if (reader) {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const chunk = decoder.decode(value, { stream: true });
					patchMarkdown += chunk;
					scrollChatToBottom(false);
				}
				patchMarkdown = cleanChatContent(patchMarkdown);
			}

			remediationPlan = {
				id: planId,
				commit_hash: targetCommit.hash,
				issue_id: activeScopedFinding?.issue_id,
				title: `Remediation Plan for ${activeScopedFinding?.issue_id || targetCommit.hash.substring(0, 7)}`,
				plan_markdown: patchMarkdown,
				status: 'PENDING_APPROVAL'
			};
			draftIssueBody = patchMarkdown;

			chatMessages = [
				...chatMessages,
				{
					role: 'assistant',
					content: '🔒 **Remediation patch formulated.** You can approve below or type **"Approve"** to log this issue on GitHub and resolve the commit.'
				}
			];
		} catch (e) {
			console.error('Plan formulation error', e);
		} finally {
			isGeneratingPlan = false;
		}
	}

	async function approvePlan() {
		const targetCommit = activeDraftCommit || selectedCommit;
		if (targetCommit) {
			await executeApproveAndFileGithub(targetCommit);
		}
	}

	function badgeClass(status?: DomainBadgeStatus | 'RUNNING' | string) {
		switch (status) {
			case 'PASS':
				return 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60';
			case 'WARN':
				return 'bg-yellow-950/80 text-yellow-300 border-yellow-500/70 font-semibold';
			case 'PENDING':
			case 'INCOMPLETE':
			case 'RUNNING':
				return 'bg-yellow-950/90 text-yellow-300 border-yellow-500/80 animate-pulse font-mono font-semibold';
			case 'FAIL':
				return 'bg-rose-950/80 text-rose-400 border-rose-800/60';
			case 'ERROR':
				return 'bg-red-950 text-red-300 border-red-700 font-bold';
			case 'NA':
				return 'bg-slate-800/90 text-slate-400 border-slate-700/80 font-mono';
			default:
				return 'bg-yellow-950/80 text-yellow-300 border-yellow-500/60 animate-pulse';
		}
	}

	function circleColor(status?: DomainBadgeStatus | string) {
		switch (status) {
			case 'PASS':
				return 'bg-emerald-500 border-emerald-400/80 shadow-[0_0_4px_rgba(16,185,129,0.4)]';
			case 'WARN':
				return 'bg-yellow-400 border-yellow-300 shadow-[0_0_4px_rgba(250,204,21,0.5)]';
			case 'PENDING':
			case 'INCOMPLETE':
			case 'RUNNING':
				return 'bg-yellow-400 border-yellow-300 shadow-[0_0_4px_rgba(250,204,21,0.5)] animate-pulse';
			case 'FAIL':
				return 'bg-rose-500 border-rose-400/80 shadow-[0_0_4px_rgba(244,63,94,0.45)]';
			case 'ERROR':
				return 'bg-red-600 border-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]';
			case 'NA':
				return 'bg-slate-700 border-slate-600';
			default:
				return 'bg-yellow-400/90 border-yellow-300 animate-pulse';
		}
	}

	function formatEvalTimestamp(dateStr?: string): string {
		if (!dateStr) return '';
		try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return dateStr;
			return d.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});
		} catch {
			return dateStr;
		}
	}

	function getCommitEvalTimestamp(commit: ReportSummary, report?: FullReport): string {
		if (report?.timestamp) return report.timestamp;
		if (report?.steps && report.steps.length > 0) {
			const lastStep = report.steps[report.steps.length - 1];
			if (lastStep?.timestamp) return lastStep.timestamp;
		}
		return commit.timestamp || commit.created_at || '';
	}

	interface StepDetailItem {
		index: number;
		stepNumber: number;
		crit: (typeof VIBE_CRITERIA)[0];
		status: DomainBadgeStatus;
		score: number | null;
		isPassing: boolean;
		isFlagged: boolean;
		isWarning: boolean;
		isNA: boolean;
		isPending: boolean;
		issueTag?: string;
		findingTitle?: string;
		timestamp?: string;
		comment?: string;
	}

	function getStepDetails(commit: ReportSummary, report?: FullReport): StepDetailItem[] {
		const badges = { ...(commit.domain_badges || {}), ...(commit.criteria_badges || {}) };
		return VIBE_CRITERIA.map((crit, index) => {
			const stepNumber = index + 1;
			const critScore = report?.criteria?.[crit.key];
			const step = report?.steps?.find(
				(s) => s.key === crit.key || s.criterion_code === crit.code
			);

			let status: DomainBadgeStatus;
			if (critScore) {
				status =
					critScore.execution_status === 'NA' || (critScore.status as string) === 'NA'
						? 'NA'
						: critScore.execution_status === 'INCOMPLETE' || (critScore.status as string) === 'PENDING'
						? 'PENDING'
						: critScore.status;
			} else if (step) {
				status =
					step.status === 'RUNNING' || step.execution_status === 'INCOMPLETE'
						? 'PENDING'
						: step.status;
			} else if (badges[crit.code] || badges[crit.badge]) {
				const b = (badges[crit.code] || badges[crit.badge]) as string;
				status = (b === 'INCOMPLETE' || b === 'RUNNING' ? 'PENDING' : b) as DomainBadgeStatus;
			} else if (commit.validation_status === 'INCOMPLETE' || commit.safety_verdict === 'INCOMPLETE') {
				status = 'PENDING';
			} else {
				status = 'PASS';
			}

			const score = typeof critScore?.score === 'number' ? critScore.score : (step?.score ?? null);
			const isPassing = status === 'PASS';
			const isWarning = status === 'WARN';
			const isPending =
				status === 'PENDING' ||
				(status as string) === 'INCOMPLETE' ||
				(status as string) === 'RUNNING' ||
				((commit.validation_status === 'INCOMPLETE' || commit.safety_verdict === 'INCOMPLETE') &&
					status !== 'PASS' &&
					status !== 'NA');
			const isFlagged = !isPending && (status === 'FAIL' || status === 'ERROR');
			const isNA = status === 'NA';

			let issueTag: string | undefined = undefined;
			let findingTitle: string | undefined = undefined;

			if (isFlagged) {
				const finding =
					report?.findings_list?.find(
						(f) => f.criterion_code === crit.code || f.domain === crit.key
					) || critScore?.findings?.[0];

				if (finding?.id) {
					issueTag = finding.id;
					findingTitle = finding.title;
				} else {
					const hashSeed = (commit.hash || '263000').substring(0, 3).toUpperCase();
					const codeSuffix = crit.code.replace('VBC-', '');
					issueTag = `ISSUE-${hashSeed}L${codeSuffix}`;
				}
			}

			const timestamp =
				step?.timestamp ||
				report?.timestamp ||
				commit.timestamp ||
				commit.created_at;

			const comment =
				critScore?.comment ||
				step?.comment ||
				critScore?.summary ||
				step?.summary ||
				crit.description;

			return {
				index,
				stepNumber,
				crit,
				status,
				score,
				isPassing,
				isFlagged,
				isWarning,
				isNA,
				isPending,
				issueTag,
				findingTitle,
				timestamp,
				comment
			};
		});
	}

	function getStageIssueLabel(step: StepDetailItem, commit: ReportSummary): string {
		if (commit.resolved_by_commit && commit.resolved_by_commit.startsWith('gh-issue-')) {
			return `#${commit.resolved_by_commit.replace('gh-issue-', '')}`;
		}
		if (step.isPending) {
			return '#PEND';
		}
		if (step.issueTag) {
			if (step.issueTag.startsWith('ISSUE-')) {
				return `#${step.issueTag.replace('ISSUE-', '')}`;
			}
			return step.issueTag.startsWith('#') ? step.issueTag : `#${step.issueTag}`;
		}
		return `#${step.stepNumber}`;
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="flex-1 flex flex-col max-w-[1600px] w-full mx-auto px-2 sm:px-3 md:px-4 py-3 space-y-3">
	<!-- Workspace: Two-Pane Master-Detail (Keeps 2-column layout active on all screens down to sm: 640px, collapsing only on true mobile) -->
	<div class="grid grid-cols-1 sm:grid-cols-12 gap-3 md:gap-4 flex-1 min-h-[calc(100vh-125px)]">
		<!-- Left: Stage 1 — Five-Second Branch Triage (Summary Feed) (5 cols on sm+) -->
		<div class="sm:col-span-5 flex flex-col space-y-2 min-w-0">
			<!-- Triage & Pipeline Controls -->
			<div class="space-y-2">
				<!-- Shrunk Triage Distribution replacing filter buttons -->
				<TriageDonutChart
					total={totalCommitsCount}
					categories={donutCategories}
					selectedId={filterStatus}
					onSelectCategory={(id) => {
						filterStatus = id;
					}}
				/>

				<!-- Quality Markers Pipeline Failure & Pass Rates Summary -->
				<CriteriaFailureSummary
					summaries={allCommits}
					fullReports={fullReports}
				/>

				<!-- Active Branches Display -->
				<div class="flex items-center justify-between gap-1.5 px-1 py-0.5 text-xs select-none">
					<div class="flex items-center space-x-1.5 text-[11px] font-mono text-[#DDEBFB]/60 font-semibold shrink-0">
						<span class="text-[#3300FF] font-bold">⎇</span>
						<span class="uppercase tracking-wider">Branches</span>
					</div>
					<div class="flex items-center space-x-2 overflow-x-auto py-0.5 no-scrollbar">
						{#each availableBranches as b}
							{@const count = branchCounts[b] || 0}
							{#if count > 0}
								<span
									class="text-[11px] font-mono text-[#DDEBFB]/75 flex items-center space-x-1"
								>
									<span class="font-medium text-[#DDEBFB]">{b}</span>
									<span class="text-[9px] text-[#DDEBFB]/50 font-normal">({count})</span>
								</span>
							{/if}
						{/each}
					</div>
				</div>
			</div>

			<!-- Commit Lineage Timeline -->
			<div
				class="flex-1 overflow-y-auto space-y-1 pr-1 max-h-[calc(100vh-190px)]"
				onscroll={handleTimelineScroll}
			>
				{#if gitGraphData.items.length === 0}
					<div class="text-center py-12 text-[#DDEBFB]/50 text-xs">
						No commits matching filter.
					</div>
				{:else}
					<div class="flex flex-col">
						{#each gitGraphData.items as node (node.commit.hash)}
							<div
								onclick={(e) => {
									const target = e.target as HTMLElement;
									if (target.closest('button, a, input, [data-prevent-toggle]')) return;
									selectCommit(node.commit.hash);
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										const target = e.target as HTMLElement;
										if (target.closest('button, a, input, [data-prevent-toggle]')) return;
										selectCommit(node.commit.hash);
									}
								}}
								onmouseenter={() => prefetchReport(node.commit.hash)}
								role="button"
								tabindex="0"
								class="flex items-stretch group cursor-pointer select-none transition-colors rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3300FF]/50"
							>
								<!-- Authentic Git Graph Timeline Track -->
								<div class="shrink-0 relative select-none" style="width: {gitGraphData.trackWidth}px;">
									<svg class="w-full h-full overflow-visible pointer-events-none" xmlns="http://www.w3.org/2000/svg">
										<!-- Other Active Lanes Passing Through (parallel branch tracks) -->
										{#each node.activeLanes as otherLane}
											{@const otherX = LANE_OFFSET + otherLane * LANE_WIDTH}
											{@const otherColor = LANE_PALETTE[otherLane % LANE_PALETTE.length]}
											<line
												x1={otherX}
												y1="0"
												x2={otherX}
												y2="100%"
												stroke={otherColor.stroke}
												stroke-width="2"
												stroke-opacity="0.8"
											/>
										{/each}

										<!-- Incoming Branch Fork Curves: Connecting parallel branch lines into this parent commit -->
										{#if node.forksIn && node.forksIn.length > 0}
											{#each node.forksIn as fork}
												{@const childX = LANE_OFFSET + fork.fromLane * LANE_WIDTH}
												<path
													d="M {childX} 0 C {childX} 11, {node.x} 11, {node.x} 22"
													fill="none"
													stroke={fork.color.stroke}
													stroke-width="2.5"
													stroke-linecap="round"
												/>
											{/each}
										{/if}

										<!-- Upper Line in current lane (from top of row to node) -->
										{#if node.hasUpperLine}
											<line
												x1={node.x}
												y1="0"
												x2={node.x}
												y2="22"
												stroke={node.color.stroke}
												stroke-width="2"
											/>
										{/if}

										<!-- Lower Line in current lane (from node to bottom of row) -->
										{#if node.hasLowerLine}
											<line
												x1={node.x}
												y1="22"
												x2={node.x}
												y2="100%"
												stroke={node.color.stroke}
												stroke-width="2"
											/>
										{/if}

										<!-- Node Aura / Active Halo when Selected -->
										{#if selectedHash === node.commit.hash}
											<circle
												cx={node.x}
												cy="22"
												r="11"
												fill="#3300FF"
												fill-opacity="0.25"
											/>
											<circle
												cx={node.x}
												cy="22"
												r="8.5"
												fill="none"
												stroke="#3300FF"
												stroke-width="2"
											/>
										{/if}

										<!-- Node Outer Ring (styled by branch color) -->
										<circle
											cx={node.x}
											cy="22"
											r="6"
											fill="#08060B"
											stroke={node.color.stroke}
											stroke-width="2"
										/>

										<!-- Node Inner Core Dot (colored by safety verdict & resolution) -->
										{#if commitIsResolved(node.commit)}
											<circle
												cx={node.x}
												cy="22"
												r="3.5"
												fill="#38bdf8"
											/>
										{:else if node.commit.validation_status === 'INCOMPLETE' || node.commit.safety_verdict === 'INCOMPLETE'}
											<circle
												cx={node.x}
												cy="22"
												r="3.5"
												fill="#eab308"
											/>
										{:else if node.commit.safety_verdict === 'SAFE'}
											<circle
												cx={node.x}
												cy="22"
												r="3.5"
												fill="#10b981"
											/>
										{:else}
											<circle
												cx={node.x}
												cy="22"
												r="3.5"
												fill="#f43f5e"
											/>
										{/if}
									</svg>
								</div>

								<!-- Commit Card alongside graph node -->
								<div
									class="flex-1 my-1 p-2.5 rounded-lg border transition-all space-y-1.5 min-w-0
									{selectedHash === node.commit.hash
										? 'bg-[#181322] border-[#3300FF] shadow-[0_0_15px_rgba(51,0,255,0.25)] ring-1 ring-[#3300FF]/50'
										: 'bg-[#110D17]/80 hover:bg-[#181322] border-[#DDEBFB]/10 hover:border-[#3300FF]/40'}"
								>
									<!-- Row 1: SHA, Branch Badge, Safety Verdict & Confidence Pill -->
									<div class="flex items-center justify-between gap-1.5">
										<div class="flex items-center space-x-2 min-w-0">
											<span class="font-mono text-xs font-semibold shrink-0 {selectedHash === node.commit.hash ? 'text-[#DDEBFB]' : 'text-[#DDEBFB]/80'}">
												{node.commit.hash.substring(0, 7)}
											</span>
											<!-- Branch Badge -->
											<span
												class="text-[10px] font-mono px-1.5 py-0.2 rounded border flex items-center space-x-1 shrink-0 {node.color.badgeClass}"
												title="{node.commit.branch || 'main'}"
											>
												<span class="w-1.5 h-1.5 rounded-full" style="background-color: {node.color.stroke}"></span>
												<span class="truncate max-w-[90px]">{node.commit.branch || 'main'}</span>
											</span>


											<!-- Branch Merge Indicator -->
											{#if node.mergedBranchName}
												<span
													class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 font-semibold flex items-center space-x-1 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
													title="Merge commit incorporating changes from '{node.mergedBranchName}'"
												>
													<span>🔀 Merged {node.mergedBranchName}</span>
												</span>
											{/if}
										</div>

										<!-- Safety Verdict & Confidence Pill -->
										<div class="shrink-0">
											{#if commitIsResolved(node.commit)}
												<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/80 font-semibold flex items-center space-x-1">
													<span>✓ RESOLVED</span>
													{#if node.commit.composite_score !== null}
														<span class="font-normal opacity-75">({node.commit.composite_score}%)</span>
													{/if}
												</span>
											{:else if node.commit.validation_status === 'INCOMPLETE' || node.commit.safety_verdict === 'INCOMPLETE'}
												<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-yellow-950/80 text-yellow-300 border border-yellow-500/60 animate-pulse font-semibold">
													INCOMPLETE
												</span>
											{:else if node.commit.safety_verdict === 'SAFE'}
												<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-semibold">
													SAFE &bull; {node.commit.composite_score !== null ? `${node.commit.composite_score}%` : '--%'}
												</span>
											{:else}
												<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800/60 font-semibold">
													FLAGGED &bull; {node.commit.composite_score !== null ? `${node.commit.composite_score}%` : '--%'}
												</span>
											{/if}
										</div>
									</div>

									<!-- Row 2: Commit Message (preview when collapsed) -->
									{#if selectedHash !== node.commit.hash}
										<div class="text-xs text-[#DDEBFB] line-clamp-1 font-medium" title={node.commit.message}>
											{node.commit.message || 'No commit message'}
										</div>
									{/if}

									<!-- Row 3: Author and Relative/Formatted Timestamp -->
									<div class="flex items-center justify-between text-[11px] text-[#DDEBFB]/50 pt-0.5">
										<div class="flex items-center space-x-1 truncate max-w-[150px]" title="Author: {node.commit.author || 'Unknown'}">
											<span class="text-[#DDEBFB]/40">by</span>
											<span class="text-[#DDEBFB]/70 truncate">{node.commit.author || 'Unknown'}</span>
										</div>
										{#if node.commit.timestamp || node.commit.created_at}
											<span
												class="text-[10px] text-[#DDEBFB]/50 font-mono shrink-0"
												title={node.commit.timestamp || node.commit.created_at}
											>
												{formatCommitDate(node.commit.timestamp || node.commit.created_at)}
											</span>
										{/if}
									</div>

									<!-- Row 4: The 17 Quality Markers (of AI-Generated Code) color-coded status circles with hover tooltips -->
									<div class="flex items-center gap-1.5 pt-1 flex-wrap">
										{#each VIBE_CRITERIA as crit}
											{@const badgeStatus = node.commit.criteria_badges?.[crit.code] || node.commit.domain_badges?.[crit.code] || (node.commit.validation_status === 'INCOMPLETE' ? 'PENDING' : 'PASS')}
											<span
												title="Quality Marker {crit.code}: {crit.name} ({badgeStatus})"
												aria-label="Quality Marker {crit.code}: {crit.name} ({badgeStatus})"
												class="w-2.5 h-2.5 rounded-full border shrink-0 transition-all hover:brightness-125 hover:ring-1 hover:ring-white/40 cursor-help {circleColor(badgeStatus)}"
											></span>
										{/each}
									</div>

									<!-- Row 5: Cross-Commit or Issue Resolution Button/Tag if resolved_by_commit exists -->
									{#if node.commit.resolved_by_commit}
										{@const resRef = node.commit.resolved_by_commit}
										{@const isIssue = resRef.startsWith('gh-issue-')}
										{@const label = isIssue ? `issue #${resRef.replace('gh-issue-', '')}` : `commit ${resRef.substring(0, 7)}`}
										<div class="pt-0.5">
											<button
												onclick={(e) => {
													e.stopPropagation();
													if (!isIssue) selectCommit(resRef);
												}}
												onmouseenter={() => !isIssue && prefetchReport(resRef)}
												class="text-[10px] text-sky-200 hover:text-white flex items-center space-x-1.5 bg-sky-950/80 hover:bg-sky-900/90 px-2 py-0.5 rounded border border-sky-700/70 transition-colors shadow-xs"
												title={isIssue ? `Resolved in GitHub issue #${resRef.replace('gh-issue-', '')}` : `Jump to resolving commit ${resRef}`}
											>
												<span class="text-sky-400 font-bold">✓</span>
												<span>Resolved in {label}</span>
												{#if !isIssue}
													<span>↗</span>
												{/if}
											</button>
										</div>
									{/if}

									<!-- Smoothly Animated Expanded Quality Markers View -->
									{#if selectedHash === node.commit.hash}
										{@const stepDetails = getStepDetails(node.commit, fullReports[node.commit.hash])}
										{@const evalTimestamp = getCommitEvalTimestamp(node.commit, fullReports[node.commit.hash])}
										{@const flaggedSteps = stepDetails.filter((s) => s.isFlagged)}
										<div
											data-prevent-toggle
											transition:slide={{ duration: 250 }}
											class="pt-3 border-t border-[#DDEBFB]/10 space-y-3 mt-2 cursor-default select-text"
										>
											<!-- Status & Result Summary Banner -->
											{#if node.commit.validation_status === 'INCOMPLETE' || node.commit.safety_verdict === 'INCOMPLETE'}
												<div class="p-2.5 rounded-lg bg-amber-950/35 border border-amber-700/60 text-xs text-amber-300 flex items-start space-x-2.5 animate-pulse">
													<span class="text-base shrink-0 leading-none">⏳</span>
													<div class="min-w-0 flex-1 leading-relaxed">
														<div class="flex items-center justify-between gap-2 flex-wrap">
															<span class="font-semibold text-amber-300">Quality Markers evaluation in progress...</span>
															<span class="text-[10px] font-mono text-amber-400/80">Running serial pipeline</span>
														</div>
														<div class="text-[11px] text-amber-300/80 mt-0.5">
															Evaluating 17 serial Quality Markers against code changes and git unified diffs.
														</div>
													</div>
												</div>
											{:else if node.commit.resolved_by_commit || node.commit.remediation_status === 'RESOLVED'}
												<div class="p-2.5 rounded-lg bg-[#3300FF]/20 border border-[#3300FF]/60 text-xs text-[#DDEBFB] flex items-start space-x-2.5">
													<span class="text-[#DDEBFB] font-bold text-sm shrink-0 leading-none mt-0.5">✓</span>
													<div class="min-w-0 flex-1 leading-relaxed">
														<div class="flex items-center justify-between gap-2 flex-wrap">
															<span class="font-semibold text-[#DDEBFB]">
																Evaluation Completed &bull; Result: RESOLVED
															</span>
															{#if evalTimestamp}
																<span class="text-[10px] font-mono text-[#DDEBFB]/70" title={evalTimestamp}>
																	Completed: {formatEvalTimestamp(evalTimestamp)}
																</span>
															{/if}
														</div>
														<div class="text-[11px] text-[#DDEBFB]/80 mt-0.5">
															{#if node.commit.resolved_by_commit}
																{@const resRef = node.commit.resolved_by_commit}
																{@const isIssue = resRef.startsWith('gh-issue-')}
																{#if isIssue}
																	All flagged defects were resolved in GitHub issue #{resRef.replace('gh-issue-', '')}.
																{:else}
																	All flagged defects were resolved in commit {resRef.substring(0, 7)}.
																{/if}
															{:else}
																Remediation plan signed off and verified.
															{/if}
														</div>
													</div>
												</div>
											{:else if node.commit.safety_verdict === 'FLAGGED' || node.commit.validation_status === 'FLAGGED'}
												<div class="p-2.5 rounded-lg bg-rose-950/40 border border-rose-600/70 text-xs text-rose-200 flex items-start space-x-2.5">
													<span class="text-rose-400 text-sm shrink-0 leading-none mt-0.5">⚠️</span>
													<div class="min-w-0 flex-1 leading-relaxed">
														<div class="flex items-center justify-between gap-2 flex-wrap">
															<span class="font-semibold text-rose-300">
																Evaluation Completed &bull; Result: FLAGGED ({node.commit.composite_score !== null ? `${node.commit.composite_score}%` : 'Below Threshold'})
															</span>
															{#if evalTimestamp}
																<span class="text-[10px] font-mono text-rose-300/80" title={evalTimestamp}>
																	Completed: {formatEvalTimestamp(evalTimestamp)}
																</span>
															{/if}
														</div>
														<div class="text-[11px] text-rose-200/90 mt-0.5">
															{#if flaggedSteps.length > 0}
																{flaggedSteps.length} Quality Marker{flaggedSteps.length === 1 ? '' : 's'} flagged ({flaggedSteps.map((s) => s.crit.code).join(', ')}). Review findings and remediation options below.
															{:else}
																Defects flagged during autonomous evaluation requiring developer review.
															{/if}
														</div>
														<div class="pt-2 flex items-center gap-2">
															<button
																type="button"
																onclick={() => openCommitDraftIssue(node.commit)}
																class="px-3 py-1 rounded bg-[#3300FF] hover:bg-[#2800cc] text-white border border-[#3300FF] text-[11px] font-semibold font-mono flex items-center space-x-1.5 shadow-[0_0_12px_rgba(51,0,255,0.35)] cursor-pointer transition-all"
															>
																<span class="text-amber-300">⚡</span>
																<span>Draft Issue to fix issue(s)</span>
															</button>
														</div>
													</div>
												</div>
											{:else}
												<!-- SAFE -->
												<div class="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-600/60 text-xs text-emerald-300 flex items-start space-x-2.5">
													<span class="text-emerald-400 font-bold text-sm shrink-0 leading-none mt-0.5">✓</span>
													<div class="min-w-0 flex-1 leading-relaxed">
														<div class="flex items-center justify-between gap-2 flex-wrap">
															<span class="font-semibold text-emerald-300">
																Evaluation Completed &bull; Result: SAFE ({node.commit.composite_score !== null ? `${node.commit.composite_score}%` : '100%'})
															</span>
															{#if evalTimestamp}
																<span class="text-[10px] font-mono text-emerald-300/80" title={evalTimestamp}>
																	Completed: {formatEvalTimestamp(evalTimestamp)}
																</span>
															{/if}
														</div>
														<div class="text-[11px] text-emerald-200/85 mt-0.5">
															All 17 Quality Markers passed validation with zero defects detected.
														</div>
														<div class="pt-2 flex items-center gap-2">
															<button
																type="button"
																disabled
																class="px-2.5 py-1 rounded bg-[#110D17] text-[#DDEBFB]/40 border border-[#DDEBFB]/10 text-[11px] font-mono flex items-center space-x-1.5 cursor-not-allowed opacity-60"
															>
																<span>✓</span>
																<span>No action required</span>
															</button>
														</div>
													</div>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{/each}

						<!-- Sentinel & Infinite Scroll Loader -->
						{#if isLoadingMore}
							<div class="py-3 text-center text-xs font-mono text-[#DDEBFB]/70 flex items-center justify-center space-x-2">
								<span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-[#3300FF] border-t-transparent rounded-full"></span>
								<span>Loading next 25 commits...</span>
							</div>
						{:else if !hasMore && gitGraphData.items.length >= 25}
							<div class="py-3 text-center text-[11px] font-mono text-[#DDEBFB]/40">
								All commits loaded
							</div>
						{/if}
						<div bind:this={sentinelEl} class="h-4 w-full"></div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Right: Stage 2 — Twenty-Second Exception Drill-Down (7 cols on sm+) -->
		<div id="stage-2-detail" class="sm:col-span-7 flex flex-col h-full min-h-[calc(100vh-80px)] sm:sticky sm:top-2 overflow-hidden min-w-0">
			{#if selectedCommit}
				{@const currCommit = selectedCommit}
				{@const loggedIssue = getCommitLoggedIssue(currCommit)}
				<div class="flex-1 flex flex-col bg-[#110D17]/90 border border-[#DDEBFB]/10 rounded-xl overflow-hidden h-full">
					<!-- Header -->
				<div class="p-3.5 border-b border-[#DDEBFB]/10 bg-[#08060B]/90 space-y-1">
					<div class="flex items-center justify-between">
						<div class="flex items-center space-x-2">
							<span class="font-mono text-xs font-bold text-[#DDEBFB] bg-[#3300FF]/25 px-2 py-0.5 rounded border border-[#3300FF]/60 shadow-[0_0_10px_rgba(51,0,255,0.2)]">
								{currCommit.hash.substring(0, 7)}
							</span>
							<span class="text-xs text-[#DDEBFB]/60 font-mono">
								{currCommit.branch || 'main'}
							</span>
						</div>

						<div class="flex items-center space-x-2">
							<button
								onclick={() => openAuditTrail(currCommit.hash)}
								class="text-xs px-2.5 py-1 rounded bg-[#181322] hover:bg-[#221b30] text-[#DDEBFB] border border-[#3300FF]/60 hover:border-[#3300FF] transition-all flex items-center space-x-1.5 shadow-[0_0_12px_rgba(51,0,255,0.2)] cursor-pointer"
								title="Fetch and view complete audit trail, governance events, and step execution log for this commit's report"
							>
								<span class="text-[#DDEBFB]">📜</span>
								<span class="font-medium">Audit Trail & Steps</span>
								{#if auditTrailCache[currCommit.hash]?.total_events}
									<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#3300FF]/25 text-[#DDEBFB] border border-[#3300FF]/60 font-semibold">
										{auditTrailCache[currCommit.hash].total_events}
									</span>
								{:else if fullReports[currCommit.hash]?.steps}
									<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#3300FF]/25 text-[#DDEBFB] border border-[#3300FF]/60 font-semibold">
										{fullReports[currCommit.hash]?.steps?.length || 0}
									</span>
								{/if}
							</button>

							<!-- Deselect / Close '✕' Button -->
							<button
								type="button"
								onclick={() => appSelection.clear()}
								class="w-7 h-7 flex items-center justify-center rounded-lg bg-[#181322] hover:bg-[#251e35] text-[#DDEBFB]/60 hover:text-[#DDEBFB] border border-[#DDEBFB]/15 hover:border-[#3300FF]/60 transition-all cursor-pointer text-xs font-bold leading-none ml-1 shadow-[0_0_8px_rgba(0,0,0,0.4)]"
								title="Deselect commit"
								aria-label="Close commit details"
							>
								✕
							</button>
						</div>
					</div>

					<h2 class="text-sm font-semibold text-white pt-1">
						{currCommit.message}
					</h2>
					<div class="flex items-center justify-between text-xs text-slate-400 pt-0.5">
						<div>Author: <span class="text-slate-300">{currCommit.author || 'Unknown'}</span></div>
						{#if currCommit.resolved_by_commit}
							{@const resRef = currCommit.resolved_by_commit}
							{@const isIssue = resRef.startsWith('gh-issue-')}
							{@const label = isIssue ? `issue #${resRef.replace('gh-issue-', '')}` : `commit ${resRef.substring(0, 7)}`}
							<div class="text-[11px] font-mono text-sky-300 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-700/60 flex items-center space-x-1 shadow-xs">
								<span class="text-sky-400 font-bold">✓</span>
								<span>Resolved in {label}</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Body Container -->
				<div class="flex-1 overflow-y-auto p-3.5 space-y-3">
					<!-- Constraint 3: Lock Skeleton Heights for Live Stage Streaming -->
					{#if selectedCommit.validation_status === 'INCOMPLETE'}
						{@const intermediateReport = fullReports[selectedCommit.hash]}
						{@const criteriaMap = intermediateReport?.criteria || intermediateReport?.domains || {}}
						<div class="space-y-2">
							<div class="text-xs text-amber-400 font-mono flex items-center justify-between">
								<div class="flex items-center space-x-2">
									<span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
									<span>Streaming Serial Quality Markers (of AI-Generated Code) Pipeline into Neon Postgres...</span>
								</div>
								<span class="text-[11px] text-slate-400">
									{Object.values(criteriaMap).filter((c: any) => c.execution_status === 'VALIDATED').length}/17 Quality Markers
								</span>
							</div>

							<!-- 18 Flexible-Height Skeleton Slots (17 Quality Markers + 1 Issue Resolution Pass) -->
							<div class="space-y-1.5 max-h-[440px] overflow-y-auto pr-1">
								{#each VIBE_CRITERIA as crit}
									{@const existingStage = criteriaMap[crit.key]}
									<div class="min-h-[3rem] h-auto rounded-lg bg-slate-950/70 border border-slate-800/80 px-3 py-2 flex items-center justify-between gap-3">
										<div class="space-y-0.5 min-w-0 flex-1">
											<div class="flex items-center space-x-2">
												<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-900 text-cyan-400 border border-slate-800 font-semibold shrink-0">{crit.code}</span>
												<span class="text-xs font-medium text-slate-300 truncate">{crit.name}</span>
											</div>
											<div class="text-[10px] text-slate-500 font-mono leading-relaxed whitespace-pre-wrap break-words">
												{#if existingStage?.execution_status === 'VALIDATED'}
													Validated &bull; Confidence: {existingStage.score}% &bull; {existingStage.summary || 'Checked'}
												{:else if existingStage?.status === 'NA' || existingStage?.execution_status === 'NA'}
													<span class="text-slate-400">Bypassed / Unavailable (NA) &bull; {existingStage.summary || 'Proceeding'}</span>
												{:else if existingStage?.execution_status === 'ERROR'}
													<span class="text-rose-400">Execution Error &bull; Quota / Validation exception</span>
												{:else}
													Awaiting sequential step...
												{/if}
											</div>
										</div>
										<span class="text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 {badgeClass(existingStage?.status || (existingStage?.execution_status === 'ERROR' ? 'ERROR' : 'PENDING'))}">
											{existingStage?.execution_status === 'VALIDATED' ? existingStage.status : (existingStage?.status === 'NA' || existingStage?.execution_status === 'NA' ? 'NA' : existingStage?.execution_status === 'ERROR' ? 'ERROR' : 'PENDING')}
										</span>
									</div>
								{/each}

								<!-- Present Issue Resolution Skeleton Pass -->
								<div class="h-12 rounded-lg bg-slate-950/70 border border-slate-800/80 px-3 py-2 flex items-center justify-between">
									<div class="space-y-0.5">
										<div class="flex items-center space-x-2">
											<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800 font-semibold">PIR-01</span>
											<span class="text-xs font-medium text-slate-400">Present Issue Resolution Pass</span>
										</div>
										<div class="text-[10px] text-slate-500 font-mono">Walks forward commits to stamp resolution lineage</div>
									</div>
									<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-500 border border-slate-800">
										QUEUED
									</span>
								</div>
							</div>
						</div>

					{:else}
						{@const report = fullReports[selectedCommit.hash] || {}}
						{@const criteriaMap = report.criteria || report.domains || {}}
						{@const getCrit = (crit: any) => criteriaMap[crit.key] || criteriaMap[crit.code] || criteriaMap[crit.badge] || {}}
						{@const getStatus = (crit: any) => {
							const cd = getCrit(crit);
							if (typeof cd.score === 'number' && cd.score < 85 && cd.status === 'PASS') {
								return 'WARN';
							}
							if (cd.status) return cd.status;
							const badge = report.summary?.criteria_badges?.[crit.code] || report.summary?.domain_badges?.[crit.code] || report.summary?.criteria_badges?.[crit.badge] || report.summary?.domain_badges?.[crit.badge] || selectedCommit?.criteria_badges?.[crit.code] || selectedCommit?.domain_badges?.[crit.code];
							if (badge) return badge;
							if (report.validation_status === 'SAFE' || selectedCommit?.safety_verdict === 'SAFE') return 'PASS';
							return 'PENDING';
						}}
						{@const naCriteria = VIBE_CRITERIA.filter((c) => getStatus(c) === 'NA' || getCrit(c).execution_status === 'NA')}
						{@const errorCriteria = VIBE_CRITERIA.filter((c) => getCrit(c).execution_status === 'ERROR' || getStatus(c) === 'ERROR')}
						{@const failingCriteria = VIBE_CRITERIA.filter((c) => {
							const s = getStatus(c);
							return s !== 'PASS' && s !== 'NA' && s !== 'PENDING' && s !== 'ERROR' && getCrit(c).execution_status !== 'ERROR';
						})}
						{@const passingCriteria = VIBE_CRITERIA.filter((c) => {
							const s = getStatus(c);
							return s === 'PASS';
						})}
						{@const isResolved = commitIsResolved(currCommit)}
						{@const isFlagged = !isResolved && (currCommit.validation_status === 'FLAGGED' || currCommit.safety_verdict === 'FLAGGED' || failingCriteria.length > 0 || commitHasFlaggedIssues(currCommit))}
						{@const isPassed = !isResolved && !isFlagged}
						{@const stageSteps = getStepDetails(currCommit, report)}
						{@const hasFailingOrIncomplete = stageSteps.some((s) => !s.isPassing && !s.isNA)}

						<div class="space-y-3">
							<!-- Contiguous Stacked Horizontal Bar for 17 Pipeline Stages -->
							<div class="space-y-1.5 pt-0.5">
								<div class="flex items-center justify-between text-xs font-mono text-[#DDEBFB]/60">
									<span class="font-semibold text-[#DDEBFB]/80 flex items-center gap-1.5">
										<span>Quality Markers Pipeline</span>
										<span class="text-[10px] text-[#DDEBFB]/50">(17 Stages)</span>
									</span>
									<span class="text-[11px] text-[#DDEBFB]/50">
										{stageSteps.filter((s) => s.isPassing).length}/17 Passed
									</span>
								</div>
								<div class="w-full flex flex-row overflow-hidden rounded-md border border-[#DDEBFB]/20 bg-transparent select-none h-8 shadow-inner">
									{#each stageSteps as step}
										{@const stageNum = String(step.stepNumber).padStart(2, '0')}
										{@const isPass = step.isPassing}
										<div
											class="h-full flex items-center justify-center font-mono font-bold text-xs transition-all cursor-pointer border-r border-black/30 last:border-r-0 hover:brightness-125
												{isPass
													? (hasFailingOrIncomplete ? 'flex-none w-2.5 sm:w-3.5 bg-emerald-600 hover:bg-emerald-500' : 'flex-1 bg-emerald-600 hover:bg-emerald-500')
													: step.isPending
													? 'flex-1 min-w-[70px] bg-yellow-400 hover:bg-yellow-300 text-slate-950 px-2 gap-1.5 font-bold animate-pulse shadow-[0_0_10px_rgba(250,204,21,0.25)]'
													: step.isWarning
													? 'flex-1 min-w-[70px] bg-yellow-400 hover:bg-yellow-300 text-slate-950 px-2 gap-1.5 font-bold shadow-[0_0_10px_rgba(250,204,21,0.25)]'
													: step.isFlagged
													? 'flex-1 min-w-[70px] bg-rose-600 hover:bg-rose-500 text-white px-2 gap-1.5'
													: (hasFailingOrIncomplete ? 'flex-none w-2.5 sm:w-3.5 bg-slate-800 hover:bg-slate-700' : 'flex-1 bg-slate-800 hover:bg-slate-700')}"
											title="Stage {stageNum}: {step.crit.name} ({step.crit.code})&#10;Status: {step.status} {step.score !== null ? `(${step.score}%)` : ''}&#10;{step.comment || ''}&#10;⏱ {formatEvalTimestamp(step.timestamp)}"
										>
											{#if !isPass && !step.isNA}
												<span class="font-bold text-xs shrink-0">{stageNum}</span>
												<span class="text-[10px] opacity-90 truncate max-w-[85px] tracking-tight">{getStageIssueLabel(step, currCommit)}</span>
											{/if}
										</div>
									{/each}
								</div>
							</div>
							<!-- CASE 1: RESOLVED (Streamlined Focus: "Issue Resolved" + preview of issue/commit below) -->
							{#if isResolved}
								<div class="space-y-3">
									<div class="p-3.5 rounded-lg bg-sky-950/40 border border-sky-800/80 space-y-1.5 shadow-sm">
										<div class="flex items-center justify-between">
											<div class="flex items-center space-x-2.5">
												<span class="w-6 h-6 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/50 flex items-center justify-center font-bold text-xs shadow-[0_0_8px_rgba(56,189,248,0.3)]">✓</span>
												<span class="text-sm font-semibold text-sky-200">Issue Resolved</span>
											</div>
											<span class="text-xs font-mono font-semibold text-sky-300 bg-sky-950/90 px-2.5 py-0.5 rounded border border-sky-700/80">
												RESOLVED
											</span>
										</div>
										<p class="text-xs text-[#DDEBFB]/80 font-sans leading-relaxed">
											This commit's Quality Marker defects have been formally addressed and marked as resolved across all audit records.
										</p>
									</div>

									<!-- Preview of the Issue or Resolving Commit below -->
									{#if loggedIssue}
										<GitHubIssueCard issue={loggedIssue} commitHash={currCommit.hash} />
									{:else if currCommit.resolved_by_commit && !currCommit.resolved_by_commit.startsWith('gh-issue-')}
										{@const resolvingCommit = allCommits.find((c) => c.hash === currCommit.resolved_by_commit || c.hash.startsWith(currCommit.resolved_by_commit || ''))}
										<div class="p-3.5 rounded-lg bg-[#08060B]/90 border border-sky-900/60 space-y-2.5 shadow-sm">
											<div class="flex items-center justify-between">
												<div class="flex items-center space-x-2">
													<span class="text-xs font-mono text-[#DDEBFB]/70 font-semibold">Resolving Commit Preview:</span>
													<span class="font-mono text-xs font-bold text-sky-300 bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
														{currCommit.resolved_by_commit.substring(0, 7)}
													</span>
												</div>
												{#if resolvingCommit}
													<button
														type="button"
														onclick={() => selectCommit(resolvingCommit.hash)}
														class="text-xs px-2.5 py-1 rounded bg-[#181322] hover:bg-[#231b32] text-[#DDEBFB] border border-[#3300FF]/50 hover:border-[#3300FF] transition-all flex items-center space-x-1.5 cursor-pointer font-mono shadow-xs"
													>
														<span>Inspect Commit</span>
														<span class="text-[#3300FF]">→</span>
													</button>
												{/if}
											</div>
											{#if resolvingCommit}
												<div class="text-xs text-white font-medium pl-1 border-l-2 border-sky-500/50">
													"{resolvingCommit.message}"
												</div>
												<div class="flex items-center space-x-4 text-[11px] text-slate-400 font-mono pt-0.5">
													<span>Branch: <strong class="text-slate-300">{resolvingCommit.branch || 'main'}</strong></span>
													<span>Author: <strong class="text-slate-300">{resolvingCommit.author || 'Unknown'}</strong></span>
													<span>Safety: <strong class="text-emerald-400">{resolvingCommit.safety_verdict || 'SAFE'}</strong></span>
												</div>
											{:else}
												<div class="text-xs text-slate-400 font-mono">
													Resolved by subsequent commit hash: <span class="text-sky-300">{currCommit.resolved_by_commit}</span>
												</div>
											{/if}
										</div>
									{:else}
										<div class="p-4 rounded-lg bg-sky-950/20 border border-sky-900/40 text-xs text-sky-300/80 font-mono">
											✓ Remediation signed off via Lead Reviewer approval gate.
										</div>
									{/if}
								</div>

							<!-- CASE 2: FLAGGED (Streamlined Focus: Highlight pipeline issues) -->
							{:else if isFlagged}
								<div class="space-y-3">
									<div class="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/80 flex items-center justify-between gap-3 shadow-sm">
										<div class="space-y-0.5">
											<div class="flex items-center space-x-2">
												<span class="w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/50 flex items-center justify-center font-bold text-xs">⚠️</span>
												<span class="text-sm font-semibold text-rose-200">Pipeline Issues Encountered</span>
											</div>
											<p class="text-[11px] text-rose-200/80 font-mono">
												{failingCriteria.length} Quality Marker{failingCriteria.length === 1 ? '' : 's'} flagged ({report.findings_list?.length || failingCriteria.length} finding{report.findings_list?.length === 1 ? '' : 's'} detected)
											</p>
										</div>
										<button
											type="button"
											onclick={() => openCommitDraftIssue(currCommit)}
											class="text-xs px-3 py-1.5 rounded bg-[#3300FF] hover:bg-[#2900CC] text-[#DDEBFB] border border-[#3300FF] transition-all flex items-center space-x-1.5 shadow-[0_0_12px_rgba(51,0,255,0.4)] cursor-pointer shrink-0 font-medium"
										>
											<span class="text-amber-300 font-bold">⚡</span>
											<span>Draft Fix Issue</span>
										</button>
									</div>

									{#if errorCriteria.length > 0}
										<div class="p-3 rounded-lg bg-red-950/70 border border-red-800 space-y-1">
											<div class="flex items-center space-x-2 text-xs font-semibold text-red-300">
												<span>⚠️ Stage Execution Errors ({errorCriteria.length})</span>
											</div>
											<p class="text-[11px] text-red-200/90 font-mono">
												Criteria with execution errors: {errorCriteria.map((c) => `${c.code} (${c.name})`).join(', ')}.
											</p>
										</div>
									{/if}

									<!-- Flagged Findings List -->
									{#if report.findings_list && report.findings_list.length > 0}
										<div class="space-y-3">
											{#each report.findings_list as finding (finding.id)}
												{@const failedCrit = getFindingCriterion(finding)}
												{@const theme = getFindingTheme(finding, failedCrit)}
												<div class="p-3.5 rounded-lg border space-y-2.5 shadow-xs transition-all {theme.bg}">
													<!-- Header: Criterion & Severity -->
													<div class="flex items-center justify-between gap-2 pb-2 border-b border-[#DDEBFB]/10">
														<div class="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
															<span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded border shrink-0 flex items-center space-x-1.5 shadow-xs {theme.badge}">
																<span>{theme.icon}</span>
																<span>{failedCrit ? failedCrit.code : (finding.criterion_code || 'QM')}</span>
															</span>
															<span class="text-xs font-semibold text-[#DDEBFB] truncate" title="{failedCrit ? `${failedCrit.code}: ${failedCrit.name}` : (finding.domain || 'Quality Defect')}">
																{failedCrit ? failedCrit.name : (finding.domain ? finding.domain.replace(/_/g, ' ') : 'Quality Defect')}
															</span>
														</div>
														<div class="flex items-center space-x-1.5 shrink-0">
															<span class="text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold
																{finding.severity === 'CRITICAL' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
																 finding.severity === 'HIGH' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
																 'bg-slate-900 text-slate-300 border border-slate-700'}">
																{finding.severity}
															</span>
														</div>
													</div>

													<!-- Critical Aspects: Defect Summary & File Location -->
													<div class="space-y-1.5">
														<div class="flex items-start justify-between gap-2 flex-wrap">
															<h4 class="text-xs font-semibold text-white leading-snug flex-1">
																{finding.title}
															</h4>
															{#if finding.file_path}
																<span class="text-[10px] font-mono text-[#DDEBFB]/70 bg-[#08060B]/70 px-2 py-0.5 rounded border border-[#DDEBFB]/15 flex items-center space-x-1 shrink-0" title={finding.file_path}>
																	<span>📄</span>
																	<span class="text-slate-300 max-w-[220px] truncate">{finding.file_path}</span>
																</span>
															{/if}
														</div>

														<p class="text-xs text-slate-300/90 leading-relaxed font-sans">
															{finding.reasoning}
														</p>
													</div>

													<!-- Code Diff Hunk (if available) -->
													{#if finding.diff_hunk}
														{@const isExpanded = !!expandedDiffs[finding.id]}
														{@const diffLines = parseDiffLines(finding.diff_hunk)}
														<div class="pt-0.5">
															<button
																type="button"
																onclick={() => toggleDiff(finding.id)}
																class="text-xs font-mono px-2.5 py-1 rounded bg-[#181322] hover:bg-[#231b32] text-[#DDEBFB]/80 hover:text-[#DDEBFB] border border-[#DDEBFB]/15 hover:border-[#3300FF]/50 transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
																title="{isExpanded ? 'Collapse' : 'Expand'} code diff hunk"
															>
																<span class="text-[10px] text-[#3300FF] font-bold">{isExpanded ? '▼' : '▶'}</span>
																<span class="font-medium">{isExpanded ? 'Hide Code Diff Hunk' : 'View Code Diff Hunk'}</span>
																<span class="text-[10px] text-[#DDEBFB]/40 font-mono">({diffLines.length} lines)</span>
															</button>

															{#if isExpanded}
																<div class="rounded border border-slate-800 bg-slate-950 overflow-x-auto divide-y divide-slate-900/60 max-h-56 mt-1.5 shadow-inner">
																	{#each diffLines as line}
																		<div
																			class="px-2.5 py-0.5 font-mono text-[11px] leading-relaxed
																			{line.type === 'add'
																				? 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500'
																				: line.type === 'del'
																				? 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500'
																				: line.type === 'hunk'
																				? 'bg-cyan-950/30 text-cyan-300 font-semibold'
																				: line.type === 'header'
																				? 'bg-slate-900 text-slate-400 font-semibold'
																				: 'text-slate-300'}"
																		>
																			{line.text}
																		</div>
																	{/each}
																</div>
															{/if}
														</div>
													{/if}
												</div>
											{/each}
										</div>
									{:else if failingCriteria.length > 0}
										<div class="space-y-2">
											{#each failingCriteria as crit}
												{@const critData = getCrit(crit)}
												{@const theme = getFindingTheme({ id: crit.code, domain: crit.key, title: crit.name, severity: 'HIGH', reasoning: critData?.comment || critData?.summary || '' }, crit)}
												<div class="p-3 rounded-lg border space-y-1.5 text-xs {theme.bg}">
													<div class="flex items-center justify-between">
														<div class="flex items-center space-x-1.5">
															<span>{theme.icon}</span>
															<span class="font-mono font-bold {theme.accent}">{crit.code}: {crit.name}</span>
														</div>
														<span class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded {theme.badge}">
															{critData?.score !== null && critData?.score !== undefined ? `${critData.score}%` : 'WARN'}
														</span>
													</div>
													<p class="text-slate-300 font-mono text-[11px] leading-relaxed">
														{critData?.comment || critData?.summary || 'Defect or non-critical warning flagged during review.'}
													</p>
												</div>
											{/each}
										</div>
									{:else if loadingReport}
										<div class="p-6 rounded-lg bg-slate-950/60 border border-slate-800/80 text-center space-y-2 animate-pulse">
											<div class="text-cyan-400 font-mono text-xs">Loading diff hunks & agent critiques...</div>
											<p class="text-[11px] text-slate-500">Retrieving full findings from Neon Postgres</p>
										</div>
									{/if}
								</div>

							<!-- CASE 3: PASSED (Streamlined Focus: Highlight all passing stages) -->
							{:else}
								<div class="space-y-3">
									<div class="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/80 space-y-1 shadow-sm">
										<div class="flex items-center justify-between">
											<div class="flex items-center space-x-2">
												<span class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/50 flex items-center justify-center font-bold text-xs">✓</span>
												<span class="text-sm font-semibold text-emerald-200">All Pipeline Stages Passed</span>
											</div>
											<span class="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/90 px-2.5 py-0.5 rounded border border-emerald-700/80">
												SAFE ({currCommit.composite_score !== null ? `${currCommit.composite_score}%` : '100%'})
											</span>
										</div>
										<p class="text-[11px] text-emerald-200/80 font-mono">
											All {passingCriteria.length} Quality Markers (of AI-Generated Code) validated clean with zero defects detected.
										</p>
									</div>

									<!-- All Passing Stages in the Pipeline Grid -->
									<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
										{#each passingCriteria as crit}
											{@const critData = getCrit(crit)}
											<div class="p-2.5 rounded-lg bg-slate-950/90 border border-emerald-900/30 text-xs flex flex-col justify-between space-y-2 h-auto shadow-xs">
												<div class="flex items-center justify-between">
													<span class="text-slate-200 font-semibold font-mono text-[11px]">{crit.code}: {crit.name}</span>
													<span class="text-emerald-400 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/60">{critData?.score ?? 100}%</span>
												</div>
												<div class="text-[11px] text-slate-300 bg-slate-900/80 p-2 rounded border border-slate-800 leading-relaxed whitespace-pre-wrap break-words h-auto flex-1">
													<span class="text-emerald-400 font-semibold">Why it passed: </span>
													<span class="text-slate-300">{critData?.comment || critData?.summary || 'All invariants satisfied without defect.'}</span>
												</div>
											</div>
										{/each}
										{#each naCriteria as crit}
											{@const critData = getCrit(crit)}
											<div class="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800/60 text-xs opacity-85 flex flex-col justify-between space-y-2 h-auto">
												<div class="flex items-center justify-between">
													<span class="text-slate-400 font-medium font-mono text-[11px]">{crit.code}: {crit.name}</span>
													<span class="text-slate-400 font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700">NA</span>
												</div>
												<div class="text-[11px] text-slate-400 bg-slate-900/80 p-2 rounded border border-slate-800 leading-relaxed whitespace-pre-wrap break-words h-auto flex-1">
													<span class="text-slate-300 font-semibold">Bypassed (NA): </span>
													<span class="text-slate-400">{critData?.comment || critData?.summary || 'Evaluation was bypassed or unavailable.'}</span>
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<!-- "Show full details" Button on the bottom in grey -->
							<div class="pt-3 pb-1 border-t border-[#DDEBFB]/10">
								<button
									type="button"
									onclick={() => (showFullDetails = !showFullDetails)}
									class="w-full py-2.5 px-4 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-mono font-medium transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-xs"
								>
									<span>{showFullDetails ? '▲ Hide full details' : '▼ Show full details'}</span>
								</button>
							</div>

							<!-- Collapsed Full Details Section -->
							{#if showFullDetails}
								<div transition:slide class="space-y-3 pt-2">
									{#if isResolved}
										{#if failingCriteria.length > 0}
											<div class="space-y-2">
												<h4 class="text-xs font-mono font-bold uppercase tracking-wider text-rose-400/90">
													Historical Flagged Exceptions ({failingCriteria.length})
												</h4>
												<div class="space-y-2">
													{#each (report.findings_list || []) as finding (finding.id)}
														{@const failedCrit = getFindingCriterion(finding)}
														<div class="p-2.5 rounded-lg bg-slate-950/80 border border-rose-900/30 text-xs space-y-1.5">
															<div class="flex items-center justify-between">
																<span class="font-mono text-rose-300 font-semibold">{failedCrit ? failedCrit.code : (finding.criterion_code || 'QM')}: {finding.title}</span>
																<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800">{finding.severity}</span>
															</div>
															<p class="text-[11px] text-slate-300 font-mono leading-relaxed">{finding.reasoning}</p>
														</div>
													{/each}
												</div>
											</div>
										{/if}

										<div class="space-y-2">
											<h4 class="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400/90">
												Passing Quality Markers ({passingCriteria.length}/17)
											</h4>
											<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
												{#each passingCriteria as crit}
													{@const critData = getCrit(crit)}
													<div class="p-2 rounded bg-slate-950/80 border border-slate-800 text-xs space-y-1">
														<div class="flex items-center justify-between">
															<span class="font-mono text-slate-300 font-medium text-[11px]">{crit.code}: {crit.name}</span>
															<span class="text-emerald-400 font-mono text-[10px]">{critData?.score ?? 100}%</span>
														</div>
														<p class="text-[10px] text-slate-400">{critData?.comment || critData?.summary || 'Validated clean'}</p>
													</div>
												{/each}
											</div>
										</div>
									{/if}

									{#if isFlagged}
										<div class="space-y-2">
											<h4 class="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400/90">
												Passing Quality Markers ({passingCriteria.length}/17)
											</h4>
											<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
												{#each passingCriteria as crit}
													{@const critData = getCrit(crit)}
													<div class="p-2 rounded bg-slate-950/80 border border-slate-800 text-xs space-y-1">
														<div class="flex items-center justify-between">
															<span class="font-mono text-slate-300 font-medium text-[11px]">{crit.code}: {crit.name}</span>
															<span class="text-emerald-400 font-mono text-[10px]">{critData?.score ?? 100}%</span>
														</div>
														<p class="text-[10px] text-slate-400">{critData?.comment || critData?.summary || 'Validated clean'}</p>
													</div>
												{/each}
												{#each naCriteria as crit}
													{@const critData = getCrit(crit)}
													<div class="p-2 rounded bg-slate-950/80 border border-slate-800 text-xs space-y-1 opacity-80">
														<div class="flex items-center justify-between">
															<span class="font-mono text-slate-400 font-medium text-[11px]">{crit.code}: {crit.name}</span>
															<span class="text-slate-400 font-mono text-[10px]">NA</span>
														</div>
														<p class="text-[10px] text-slate-500">{critData?.comment || critData?.summary || 'Bypassed'}</p>
													</div>
												{/each}
											</div>
										</div>
									{/if}

									<!-- Files Changed & Material Diff Summary -->
									<div class="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
										<div class="flex items-center justify-between">
											<span class="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
												Files Changed & Diff Scope
											</span>
											{#if report.files_changed}
												<span class="text-[11px] font-mono text-slate-500">
													{report.files_changed.length} file{report.files_changed.length === 1 ? '' : 's'}
												</span>
											{/if}
										</div>
										{#if report.diff_summary}
											<p class="text-xs font-mono text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800/80">
												{report.diff_summary}
											</p>
										{/if}
										{#if report.files_changed && report.files_changed.length > 0}
											<div class="space-y-1 pt-1">
												{#each report.files_changed as f}
													<div class="text-[11px] font-mono text-slate-300 flex items-center space-x-1.5">
														<span class="text-[#3300FF]">📄</span>
														<span class="truncate">{f}</span>
													</div>
												{/each}
											</div>
										{/if}
									</div>

									<!-- Agent Fingerprinting Record -->
									{#if report.fingerprint}
										<div class="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
											<div class="flex items-center justify-between">
												<span class="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
													Agent Intent & Fingerprint
												</span>
												<span class="text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold
													{report.fingerprint.perceived_risk === 'LOW' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'}">
													Risk: {report.fingerprint.perceived_risk}
												</span>
											</div>
											<div class="text-xs text-slate-300 bg-slate-900/60 p-2.5 rounded border border-slate-800/80 space-y-1">
												<div><span class="text-slate-500 font-mono text-[10px] uppercase block">Intent Summary</span> {report.fingerprint.intent_summary}</div>
												{#if report.fingerprint.reasoning_record}
													<div class="pt-1"><span class="text-slate-500 font-mono text-[10px] uppercase block">Reasoning Record</span> {report.fingerprint.reasoning_record}</div>
												{/if}
											</div>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<!-- VS Code-style Editor Watermark empty state -->
			<div
				class="w-full h-full min-h-[calc(100vh-140px)] flex flex-col items-center justify-center text-center select-none pt-0 pb-12 px-4 -translate-y-12"
				style="background-color: #08060B; gap: 1.35rem;"
			>
				<!-- Brand Icon / Logo (Larger size) -->
				<img
					src="/logo.svg"
					alt="Nova"
					style="width: 320px; max-width: 90%; height: auto; display: block;"
					class="drop-shadow-[0_0_40px_rgba(51,0,255,0.2)]"
				/>

				<!-- Centered Two-Line Watermark Lockup (Enlarged) -->
				<div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
					<div
						style="font-family: 'Space Grotesk', sans-serif; font-size: 56px; font-weight: 800; letter-spacing: -0.02em; color: rgba(221, 235, 251, 0.45); text-shadow: 0 -2px 4px rgba(0, 0, 0, 0.9), 0 2px 0 rgba(221, 235, 251, 0.08); line-height: 1;"
					>
						Nova
					</div>
					<div
						style="font-size: 18px; font-weight: 500; letter-spacing: 0.04em; color: rgba(221, 235, 251, 0.65); margin-top: 0.5rem;"
					>
						Submodule: Agentic Code Review
					</div>
				</div>

				<!-- Product Overview: What It Is, Why It Exists, How It Works -->
				<div
					class="max-w-xl w-full mx-auto px-4 py-1 text-center"
					style="margin-top: -0.15rem;"
				>
					<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div class="space-y-1 text-center">
							<span class="text-[10px] font-mono uppercase tracking-wider text-[#DDEBFB]/40 font-semibold block">
								What It Is
							</span>
							<p class="text-[11px] text-[#DDEBFB]/65 leading-relaxed font-sans">
								An automated governance control plane tailored specifically for inspecting AI-generated code.
							</p>
						</div>
						<div class="space-y-1 text-center">
							<span class="text-[10px] font-mono uppercase tracking-wider text-[#DDEBFB]/40 font-semibold block">
								Why It Exists
							</span>
							<p class="text-[11px] text-[#DDEBFB]/65 leading-relaxed font-sans">
								To eliminate context blindness, hallucinated dependencies, and architectural drift before merge.
							</p>
						</div>
						<div class="space-y-1 text-center">
							<span class="text-[10px] font-mono uppercase tracking-wider text-[#DDEBFB]/40 font-semibold block">
								How It Works
							</span>
							<p class="text-[11px] text-[#DDEBFB]/65 leading-relaxed font-sans">
								Evaluates Git diffs across 17 Quality Markers using an agentic pipeline with tamper-proof audit trails.
							</p>
						</div>
					</div>
				</div>

				<!-- Single "Get Started" Shortcut Row -->
				<div
					style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.85rem; font-size: 14px; color: rgba(221, 235, 251, 0.6); margin-top: 0.25rem; text-align: center;"
				>
					<span>Select a commit to review code quality</span>
					<button
						type="button"
						onclick={() => {
							const first = gitGraphData.items[0]?.commit || data.summaries[0];
							if (first) selectCommit(first.hash);
						}}
						class="group transition-all duration-200 cursor-pointer flex items-center space-x-1.5 focus:outline-none focus:ring-1 focus:ring-[#3300FF]"
						style="background-color: rgba(221, 235, 251, 0.06); color: rgba(221, 235, 251, 0.9); border: 1px solid rgba(51, 0, 255, 0.45); border-bottom: 2px solid rgba(51, 0, 255, 0.85); border-radius: 4px; padding: 4px 12px; font-size: 12px; font-weight: 600; line-height: 1.2; font-family: inherit; box-shadow: inset 0 1px 0 rgba(221, 235, 251, 0.1), 0 2px 4px rgba(0, 0, 0, 0.6), 0 0 12px rgba(51, 0, 255, 0.2);"
						onmouseenter={(e) => {
							prefetchReport(gitGraphData.items[0]?.commit?.hash || data.summaries[0]?.hash);
							const el = e.currentTarget;
							el.style.backgroundColor = 'rgba(51, 0, 255, 0.25)';
							el.style.borderColor = 'rgba(51, 0, 255, 0.9)';
							el.style.boxShadow = 'inset 0 1px 0 rgba(221, 235, 251, 0.15), 0 4px 12px rgba(51, 0, 255, 0.45)';
							el.style.transform = 'translateY(-1px)';
						}}
						onmouseleave={(e) => {
							const el = e.currentTarget;
							el.style.backgroundColor = 'rgba(221, 235, 251, 0.06)';
							el.style.borderColor = 'rgba(51, 0, 255, 0.45)';
							el.style.borderBottomColor = 'rgba(51, 0, 255, 0.85)';
							el.style.boxShadow = 'inset 0 1px 0 rgba(221, 235, 251, 0.1), 0 2px 4px rgba(0, 0, 0, 0.6), 0 0 12px rgba(51, 0, 255, 0.2)';
							el.style.transform = 'translateY(0)';
						}}
						title="Select first commit to review code quality"
					>
						<span>Get Started</span>
						<span class="text-[11px] text-[#DDEBFB]/60 group-hover:text-[#DDEBFB] group-hover:translate-x-0.5 transition-all">→</span>
					</button>
				</div>

				<!-- Criteria Reference Line -->
				<div
					style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.5rem; font-size: 14px; color: rgba(221, 235, 251, 0.6); margin-top: 0.35rem; text-align: center; max-width: 90%;"
				>
					<span>Alternatively, read more about the proprietary AI-generated code review</span>
					<a
						href="https://docs.google.com/document/d/1lhNPTFIqndBlfIkLn_XfgtFfNGb9jjrJ0F1LQF0RBnc/edit?usp=sharing"
						target="_blank"
						rel="noopener noreferrer"
						class="group transition-all duration-200 cursor-pointer inline-flex items-center space-x-1.5 focus:outline-none focus:ring-1 focus:ring-slate-500/50"
						style="background-color: rgba(221, 235, 251, 0.05); color: rgba(221, 235, 251, 0.85); border: 1px solid rgba(221, 235, 251, 0.18); border-bottom: 2px solid rgba(221, 235, 251, 0.35); border-radius: 4px; padding: 3px 10px; font-size: 12px; font-weight: 600; line-height: 1.2; font-family: inherit; box-shadow: inset 0 1px 0 rgba(221, 235, 251, 0.08), 0 2px 4px rgba(0, 0, 0, 0.5); text-decoration: none;"
						onmouseenter={(e) => {
							const el = e.currentTarget;
							el.style.backgroundColor = 'rgba(221, 235, 251, 0.12)';
							el.style.borderColor = 'rgba(221, 235, 251, 0.4)';
							el.style.boxShadow = 'inset 0 1px 0 rgba(221, 235, 251, 0.15), 0 3px 8px rgba(0, 0, 0, 0.7)';
							el.style.transform = 'translateY(-1px)';
						}}
						onmouseleave={(e) => {
							const el = e.currentTarget;
							el.style.backgroundColor = 'rgba(221, 235, 251, 0.05)';
							el.style.borderColor = 'rgba(221, 235, 251, 0.18)';
							el.style.borderBottomColor = 'rgba(221, 235, 251, 0.35)';
							el.style.boxShadow = 'inset 0 1px 0 rgba(221, 235, 251, 0.08), 0 2px 4px rgba(0, 0, 0, 0.5)';
							el.style.transform = 'translateY(0)';
						}}
						title="Read whitepaper on proprietary AI-generated code review criteria (opens in new tab)"
					>
						<span>Criteria</span>
						<span class="text-[11px] text-[#DDEBFB]/50 group-hover:text-[#DDEBFB] group-hover:translate-x-0.5 transition-all">→</span>
					</a>
				</div>

				<!-- Product Specification Reference Line -->
				<div
					style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.5rem; font-size: 14px; color: rgba(221, 235, 251, 0.6); margin-top: 0.35rem; text-align: center; max-width: 90%;"
				>
					<span>Full product specification found in</span>
					<a
						href="https://docs.google.com/document/d/1XUr_guvzSpFuQ6Gk5elpdEB3mjj_AR1Fl6QVe7yOO7w/edit?usp=sharing"
						target="_blank"
						rel="noopener noreferrer"
						class="group transition-all duration-200 cursor-pointer inline-flex items-center space-x-1.5 focus:outline-none focus:ring-1 focus:ring-slate-500/50"
						style="background-color: rgba(221, 235, 251, 0.05); color: rgba(221, 235, 251, 0.85); border: 1px solid rgba(221, 235, 251, 0.18); border-bottom: 2px solid rgba(221, 235, 251, 0.35); border-radius: 4px; padding: 3px 10px; font-size: 12px; font-weight: 600; line-height: 1.2; font-family: inherit; box-shadow: inset 0 1px 0 rgba(221, 235, 251, 0.08), 0 2px 4px rgba(0, 0, 0, 0.5); text-decoration: none;"
						onmouseenter={(e) => {
							const el = e.currentTarget;
							el.style.backgroundColor = 'rgba(221, 235, 251, 0.12)';
							el.style.borderColor = 'rgba(221, 235, 251, 0.4)';
							el.style.boxShadow = 'inset 0 1px 0 rgba(221, 235, 251, 0.15), 0 3px 8px rgba(0, 0, 0, 0.7)';
							el.style.transform = 'translateY(-1px)';
						}}
						onmouseleave={(e) => {
							const el = e.currentTarget;
							el.style.backgroundColor = 'rgba(221, 235, 251, 0.05)';
							el.style.borderColor = 'rgba(221, 235, 251, 0.18)';
							el.style.borderBottomColor = 'rgba(221, 235, 251, 0.35)';
							el.style.boxShadow = 'inset 0 1px 0 rgba(221, 235, 251, 0.08), 0 2px 4px rgba(0, 0, 0, 0.5)';
							el.style.transform = 'translateY(0)';
						}}
						title="Read full product specification (opens in new tab)"
					>
						<span>Docs</span>
						<span class="text-[11px] text-[#DDEBFB]/50 group-hover:text-[#DDEBFB] group-hover:translate-x-0.5 transition-all">→</span>
					</a>
				</div>
			</div>
		{/if}
		</div>
	</div>
</div>

<!-- Stage 3 & 4: Scoped Interrogation & Remediation Drawer -->
{#if isChatDrawerOpen && (activeDraftCommit || activeScopedFinding || selectedCommit)}
	{@const currentTargetCommit = activeDraftCommit || selectedCommit}
	{@const currentLoggedIssue = currentTargetCommit ? getCommitLoggedIssue(currentTargetCommit) : null}
	<div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex justify-end">
		<div class="w-full max-w-xl bg-[#08060B] border-l border-[#DDEBFB]/10 h-full flex flex-col shadow-2xl">
			<!-- Drawer Header -->
			<div class="p-3.5 border-b border-[#DDEBFB]/10 bg-[#110D17]/95 flex items-center justify-between">
				<div class="space-y-0.5">
					<div class="flex items-center space-x-2">
						{#if activeScopedFinding}
							<span class="font-mono text-xs font-bold text-rose-400 bg-rose-950 px-2 py-0.5 rounded border border-rose-800">
								{activeScopedFinding.issue_id}
							</span>
							<h3 class="text-sm font-semibold text-[#DDEBFB]">Draft Issue & Defect Interrogation</h3>
						{:else}
							<span class="font-mono text-xs font-bold text-[#3300FF] bg-[#3300FF]/25 px-2 py-0.5 rounded border border-[#3300FF]/60">
								{currentTargetCommit?.hash.substring(0, 7)}
							</span>
							<h3 class="text-sm font-semibold text-[#DDEBFB]">Draft Issue to Fix Issue(s)</h3>
						{/if}
					</div>
					<p class="text-[11px] text-[#DDEBFB]/50 font-mono">
						{#if activeScopedFinding}
							Domain: {activeScopedFinding.domain_category.replace(/_/g, ' ')} &bull; Commit {activeScopedFinding.hash.substring(0, 7)}
						{:else if currentTargetCommit}
							Branch: {currentTargetCommit.branch || 'main'} &bull; Commit {currentTargetCommit.hash.substring(0, 7)}
						{/if}
					</p>
				</div>

				<button
					onclick={() => {
						isChatDrawerOpen = false;
						activeDraftCommit = null;
					}}
					class="p-1 text-[#DDEBFB]/50 hover:text-[#DDEBFB] rounded hover:bg-[#181322] cursor-pointer"
					title="Close drawer"
				>
					✕
				</button>
			</div>

			<!-- Scoped Context Pill -->
			<div class="px-4 py-2.5 bg-[#08060B] border-b border-[#DDEBFB]/10 text-xs space-y-1.5">
				{#if activeScopedFinding}
					<div class="flex items-start gap-2">
						<span class="text-[#3300FF] font-bold text-xs mt-0.5">⚡</span>
						<div class="flex-1 min-w-0">
							<span class="text-[10px] uppercase font-mono tracking-wider text-[#DDEBFB]/50 font-semibold block">Critique Rationale</span>
							<p class="text-xs text-[#DDEBFB]/90 leading-snug line-clamp-2 hover:line-clamp-none transition-all">
								{activeScopedFinding.finding_reasoning}
							</p>
						</div>
					</div>
					{#if activeScopedFinding.diff_hunk}
						<div class="bg-[#050308] border border-[#DDEBFB]/10 rounded px-2.5 py-1 font-mono text-[10px] text-[#DDEBFB]/50 truncate">
							<span class="text-cyan-400 font-semibold">Diff Excerpt:</span> {activeScopedFinding.diff_hunk.split('\n')[0]}
						</div>
					{/if}
				{:else if currentTargetCommit}
					<div class="flex items-start gap-2">
						<span class="text-amber-400 font-bold text-xs mt-0.5">⚡</span>
						<div class="flex-1 min-w-0">
							<span class="text-[10px] uppercase font-mono tracking-wider text-[#DDEBFB]/50 font-semibold block">Target Commit Issue</span>
							<p class="text-xs text-[#DDEBFB] font-medium leading-snug truncate">
								"{currentTargetCommit.message}"
							</p>
							<div class="text-[10px] text-[#DDEBFB]/50 font-mono mt-0.5">
								Author: {currentTargetCommit.author || 'Unknown'} &bull; Status: {currentTargetCommit.safety_verdict || currentTargetCommit.validation_status}
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Conversation Transcript -->
			<div bind:this={chatContainerEl} class="flex-1 overflow-y-auto p-4 space-y-4">
				{#if currentLoggedIssue && currentTargetCommit}
					<div class="pb-2">
						<GitHubIssueCard issue={currentLoggedIssue} commitHash={currentTargetCommit.hash} />
					</div>
				{/if}

				{#each chatMessages as msg}
					<div class="flex flex-col {msg.role === 'user' ? 'items-end' : 'items-start'}">
						{#if msg.role === 'user'}
							<div class="flex items-center space-x-1.5 text-[10px] font-mono text-[#DDEBFB]/50 mb-1 pr-1">
								<span>You</span>
							</div>
							<div
								class="max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed bg-[#3300FF] text-white border border-[#3300FF]/80 shadow-[0_0_15px_rgba(51,0,255,0.25)]"
							>
								<div class="prose prose-invert prose-xs max-w-none prose-p:my-1 prose-strong:text-white prose-code:text-white prose-code:bg-[#2000a3] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded font-normal">
									{@html renderMarkdown(msg.content)}
								</div>
							</div>
						{:else}
							<div class="flex items-center space-x-2 text-[10px] font-mono text-[#DDEBFB]/70 mb-1 pl-1">
								<span class="w-1.5 h-1.5 rounded-full bg-[#3300FF] shadow-[0_0_6px_#3300FF]"></span>
								<span class="font-bold text-[#DDEBFB]">Nova Review Assistant</span>
								<span class="text-[9px] text-[#DDEBFB]/40 uppercase tracking-wider">AI Critic</span>
							</div>
							<div
								class="max-w-[92%] rounded-2xl px-4 py-3 text-xs leading-relaxed bg-[#110D17]/95 border border-[#DDEBFB]/12 text-[#DDEBFB] shadow-xl"
							>
								<div
									class="prose prose-invert prose-xs max-w-none prose-headings:text-[#DDEBFB] prose-headings:font-bold prose-headings:my-2 prose-h1:text-sm prose-h2:text-xs prose-h3:text-xs prose-p:my-1.5 prose-p:leading-relaxed prose-strong:text-white prose-strong:font-semibold prose-code:text-cyan-300 prose-code:bg-[#08060B] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[11px] prose-pre:bg-[#08060B] prose-pre:border prose-pre:border-[#DDEBFB]/15 prose-pre:p-3 prose-pre:rounded-lg prose-pre:my-2.5 prose-pre:overflow-x-auto prose-pre:text-[11px] prose-ol:pl-4 prose-ol:my-2 prose-ul:pl-4 prose-ul:my-2 prose-li:my-0.5 prose-li:leading-relaxed prose-blockquote:border-l-2 prose-blockquote:border-[#3300FF] prose-blockquote:bg-[#3300FF]/10 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:rounded-r prose-blockquote:text-[#DDEBFB]/80 prose-blockquote:not-italic"
								>
									{@html renderMarkdown(msg.content)}
								</div>
							</div>
						{/if}
					</div>
				{/each}

				{#if isChatSending}
					<div class="flex items-center space-x-2 text-xs font-mono text-[#3300FF] bg-[#110D17] border border-[#3300FF]/30 px-3.5 py-2 rounded-xl w-fit">
						<span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-[#3300FF] border-t-transparent rounded-full"></span>
						<span class="text-[#DDEBFB]/70">Formulating critique & remediation reasoning...</span>
					</div>
				{/if}

				<!-- Stage 4 & 5: Remediation Spec & Approval Gate -->
				{#if remediationPlan}
					<div class="p-3.5 rounded-lg border border-[#3300FF]/50 bg-[#3300FF]/15 space-y-2.5 mt-3 shadow-[0_0_15px_rgba(51,0,255,0.15)]">
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold text-[#DDEBFB]">
								Remediation Specification
							</span>
							<span class="text-[10px] font-mono px-2 py-0.5 rounded uppercase
								{remediationPlan.status === 'RESOLVED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}">
								{remediationPlan.status}
							</span>
						</div>

						<div class="text-xs text-[#DDEBFB] bg-[#08060B]/90 p-3 rounded border border-[#DDEBFB]/10 max-h-52 overflow-y-auto divide-y divide-[#DDEBFB]/5">
							{#each parseDiffLines(remediationPlan.plan_markdown) as line}
								<div
									class="font-mono text-[11px] leading-relaxed
									{line.type === 'add'
										? 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500 pl-1.5'
										: line.type === 'del'
										? 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 pl-1.5'
										: line.type === 'hunk'
										? 'bg-[#3300FF]/20 text-[#DDEBFB] font-semibold pl-1.5'
										: line.type === 'header'
										? 'bg-[#110D17] text-[#DDEBFB]/60 font-semibold pl-1.5'
										: 'text-[#DDEBFB]/80'}"
								>
									{line.text}
								</div>
							{/each}
						</div>

						{#if approvalSuccess}
							<div class="p-2 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs">
								✓ Atomic sign-off recorded. Issue marked as RESOLVED.
							</div>
						{/if}

						<!-- Stage 5: Ten-Second Atomic Sign-Off Actions -->
						<div class="flex items-center justify-between pt-1">
							{#if currentTargetCommit && !commitIsResolved(currentTargetCommit)}
								<button
									onclick={() => currentTargetCommit && executeApproveAndFileGithub(currentTargetCommit)}
									disabled={isApproving || isFilingIssue}
									class="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed flex items-center space-x-1.5"
								>
									<span>✓</span>
									<span>{isApproving || isFilingIssue ? 'Executing Sign-Off...' : 'Approve & File GitHub Issue'}</span>
								</button>
							{:else}
								<span class="text-xs font-mono text-emerald-400 font-semibold">✓ Signed Off & Logged on GitHub</span>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Input & Sign-Off Action Area -->
			<div class="p-3.5 border-t border-[#DDEBFB]/10 bg-[#110D17]/95 space-y-2.5">
				<!-- Verbatim Sign-Off Banner -->
				{#if currentTargetCommit && !commitIsResolved(currentTargetCommit)}
					<div class="p-2.5 rounded-lg bg-[#3300FF]/15 border border-[#3300FF]/40 flex items-center justify-between gap-3 shadow-[0_0_12px_rgba(51,0,255,0.15)]">
						<div class="text-[11px] text-[#DDEBFB]/80 leading-tight">
							<span class="font-semibold text-[#DDEBFB]">Ready to log?</span>
							<span> Type <strong class="text-amber-300 font-mono">"Approve"</strong> below, or click:</span>
						</div>
						<button
							onclick={() => currentTargetCommit && executeApproveAndFileGithub(currentTargetCommit)}
							disabled={isFilingIssue}
							class="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md flex items-center space-x-1.5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
						>
							{#if isFilingIssue}
								<span class="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span>
								<span>Filing Issue...</span>
							{:else}
								<span>✓</span>
								<span>Approve & File GitHub Issue</span>
							{/if}
						</button>
					</div>
				{:else if currentTargetCommit && commitIsResolved(currentTargetCommit)}
					<div class="p-2 rounded-lg bg-emerald-950/50 border border-emerald-800/80 text-emerald-300 text-xs font-mono flex items-center justify-between">
						<span class="flex items-center space-x-1.5">
							<span>✓</span>
							<span>Commit Resolved ({currentTargetCommit.resolved_by_commit || 'Filed on GitHub'})</span>
						</span>
						<span class="text-[10px] text-emerald-400/80">Audit Log Recorded</span>
					</div>
				{/if}

				{#if remediationPlan?.status === 'PENDING_APPROVAL'}
					<div class="text-center text-xs text-amber-400 font-mono py-1.5 px-3 bg-amber-950/30 border border-amber-800/40 rounded-lg">
						🔒 Remediation plan formulated. Provide sign-off above to file issue on GitHub.
					</div>
				{:else}
					<div class="flex items-center space-x-2">
						<input
							type="text"
							bind:value={chatInput}
							onkeydown={(e) => e.key === 'Enter' && sendChatMessage()}
							placeholder='Refine issue draft (or type "Approve" to file on GitHub)...'
							class="flex-1 bg-[#08060B] border border-[#DDEBFB]/15 rounded-lg px-3 py-2 text-xs text-[#DDEBFB] placeholder-[#DDEBFB]/40 focus:outline-none focus:border-[#3300FF] focus:ring-1 focus:ring-[#3300FF]/50 transition-all font-mono"
						/>
						<button
							onclick={sendChatMessage}
							disabled={isChatSending || !chatInput.trim() || isFilingIssue}
							class="px-4 py-2 rounded-lg bg-[#3300FF] hover:bg-[#2900CC] disabled:opacity-40 disabled:hover:bg-[#3300FF] text-[#DDEBFB] text-xs font-semibold font-mono transition-all shadow-[0_0_12px_rgba(51,0,255,0.3)] flex items-center space-x-1.5 cursor-pointer disabled:cursor-not-allowed"
						>
							<span>Send</span>
							<span>↵</span>
						</button>
					</div>

					<div class="flex items-center justify-between text-[11px] text-[#DDEBFB]/40 font-mono px-0.5">
						<span>Type <span class="text-amber-300 font-semibold">"Approve"</span> to sign off and file issue</span>

						<!-- Stage 4 Action -->
						<button
							onclick={lockAndPlanFix}
							disabled={isGeneratingPlan || chatMessages.length < 2}
							class="text-xs font-semibold text-[#DDEBFB] hover:text-[#3300FF] disabled:opacity-30 disabled:hover:text-[#DDEBFB] transition-colors flex items-center space-x-1 cursor-pointer disabled:cursor-not-allowed"
						>
							<span>{isGeneratingPlan ? 'Formulating Patch...' : '🔒 Lock and Plan Fix'}</span>
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Combined Report Audit Trail & Pipeline Step Execution Log Drawer -->
{#if isAuditDrawerOpen && selectedCommit}
	{@const rawEvents = auditTrailData?.events || []}
	{@const filteredEvents = rawEvents.filter((ev) => {
		if (auditTrailFilter === 'STEPS' && ev.type !== 'PIPELINE_STEP') return false;
		if (auditTrailFilter === 'AUDIT' && ev.type === 'PIPELINE_STEP') return false;
		if (!auditTrailSearch.trim()) return true;
		const q = auditTrailSearch.toLowerCase();
		return (
			(ev.action && ev.action.toLowerCase().includes(q)) ||
			(ev.actor && ev.actor.toLowerCase().includes(q)) ||
			(ev.comment && ev.comment.toLowerCase().includes(q)) ||
			(ev.criterion_code && ev.criterion_code.toLowerCase().includes(q)) ||
			(ev.status && ev.status.toLowerCase().includes(q))
		);
	})}
	{@const displayEvents = auditTrailSort === 'DESC' ? [...filteredEvents].reverse() : [...filteredEvents]}
	{@const auditCommit = selectedCommit!}
	<div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex justify-end">
		<div class="w-full max-w-2xl bg-[#08060B] border-l border-[#DDEBFB]/10 h-full flex flex-col p-4 shadow-2xl">
			<!-- Drawer Header -->
			<div class="flex items-center justify-between border-b border-[#DDEBFB]/10 pb-3">
				<div>
					<div class="flex items-center space-x-2">
						<span class="text-sm">📜</span>
						<h3 class="text-sm font-semibold text-[#DDEBFB]">Report Audit Trail & Step Execution Log</h3>
					</div>
					<p class="text-[11px] text-[#DDEBFB]/50 font-mono mt-0.5">
						Commit <span class="text-[#DDEBFB] font-bold">{auditCommit.hash.substring(0, 7)}</span> &bull; {auditTrailData?.total_events || 0} total events &bull; Neon Postgres & State Graph
					</p>
				</div>
				<div class="flex items-center space-x-2">
					<button
						onclick={() => auditCommit && openAuditTrail(auditCommit.hash)}
						class="text-xs px-2.5 py-1 rounded bg-[#110D17] hover:bg-[#181322] text-[#DDEBFB] border border-[#DDEBFB]/10 transition-colors flex items-center space-x-1 cursor-pointer"
						title="Refresh audit events from server"
					>
						<span>↻</span>
						<span>Refresh</span>
					</button>
					<button
						onclick={() => (isAuditDrawerOpen = false)}
						class="text-[#DDEBFB]/50 hover:text-[#DDEBFB] p-1 rounded hover:bg-[#181322] transition-colors text-sm cursor-pointer"
					>
						✕
					</button>
				</div>
			</div>

			<!-- Filter & Search Toolbar -->
			<div class="py-3 border-b border-[#DDEBFB]/10 space-y-2">
				<div class="flex items-center space-x-2">
					<input
						type="text"
						bind:value={auditTrailSearch}
						placeholder="Search events by action, actor, criterion, or rationale..."
						class="flex-1 bg-[#110D17] border border-[#DDEBFB]/15 rounded px-2.5 py-1 text-xs text-[#DDEBFB] placeholder-[#DDEBFB]/40 focus:outline-none focus:border-[#3300FF]"
					/>
					<button
						onclick={() => (auditTrailSort = auditTrailSort === 'DESC' ? 'ASC' : 'DESC')}
						class="text-[11px] font-mono px-2.5 py-1 rounded bg-[#110D17] border border-[#DDEBFB]/10 text-[#DDEBFB]/80 hover:text-[#DDEBFB] transition-colors cursor-pointer"
						title="Toggle chronological vs execution order"
					>
						{auditTrailSort === 'DESC' ? '↓ Newest First' : '↑ Execution Order'}
					</button>
				</div>

				<div class="flex items-center space-x-1.5 text-xs">
					<button
						onclick={() => (auditTrailFilter = 'ALL')}
						class="px-2.5 py-1 rounded transition-colors cursor-pointer {auditTrailFilter === 'ALL' ? 'bg-[#3300FF] text-[#DDEBFB] border border-[#3300FF] font-semibold shadow-[0_0_10px_rgba(51,0,255,0.25)]' : 'bg-[#110D17] text-[#DDEBFB]/60 hover:text-[#DDEBFB] border border-[#DDEBFB]/10'}"
					>
						All Events ({auditTrailData?.total_events || 0})
					</button>
					<button
						onclick={() => (auditTrailFilter = 'STEPS')}
						class="px-2.5 py-1 rounded transition-colors cursor-pointer {auditTrailFilter === 'STEPS' ? 'bg-[#3300FF] text-[#DDEBFB] border border-[#3300FF] font-semibold shadow-[0_0_10px_rgba(51,0,255,0.25)]' : 'bg-[#110D17] text-[#DDEBFB]/60 hover:text-[#DDEBFB] border border-[#DDEBFB]/10'}"
					>
						Pipeline Steps ({auditTrailData?.steps_count || 0})
					</button>
					<button
						onclick={() => (auditTrailFilter = 'AUDIT')}
						class="px-2.5 py-1 rounded transition-colors cursor-pointer {auditTrailFilter === 'AUDIT' ? 'bg-[#3300FF] text-[#DDEBFB] border border-[#3300FF] font-semibold shadow-[0_0_10px_rgba(51,0,255,0.25)]' : 'bg-[#110D17] text-[#DDEBFB]/60 hover:text-[#DDEBFB] border border-[#DDEBFB]/10'}"
					>
						Audit Logs ({auditTrailData?.audit_logs_count || 0})
					</button>
				</div>
			</div>

			<!-- Events Feed Body -->
			<div class="flex-1 overflow-y-auto py-3 space-y-2.5 pr-1 font-sans">
				{#if auditTrailLoading}
					<div class="p-8 text-center space-y-2 text-[#DDEBFB]/50">
						<div class="inline-block animate-spin text-[#3300FF] text-xl font-bold">↻</div>
						<div class="text-xs font-mono">Fetching unified audit trail and step execution logs...</div>
					</div>
				{:else if displayEvents.length === 0}
					<div class="p-8 text-center text-xs text-[#DDEBFB]/40 font-mono">
						No audit events or pipeline steps matched the current filter.
					</div>
				{:else}
					{#each displayEvents as event}
						<div class="p-3 rounded-lg bg-[#110D17] border border-[#DDEBFB]/10 space-y-2 text-xs transition-all hover:border-[#3300FF]/40">
							<!-- Event Header -->
							<div class="flex items-center justify-between">
								<div class="flex items-center space-x-2">
									{#if event.type === 'PIPELINE_STEP'}
										<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#3300FF]/25 text-[#DDEBFB] border border-[#3300FF]/60 font-semibold">
											STEP {event.details?.step_index ?? ''}
										</span>
									{:else if event.type === 'GOVERNANCE'}
										<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-950 text-purple-400 border border-purple-800/60 font-semibold">
											GOVERNANCE
										</span>
									{:else}
										<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#3300FF]/20 text-[#DDEBFB] border border-[#3300FF]/50 font-semibold">
											AUDIT LOG
										</span>
									{/if}

									<span class="text-[#DDEBFB] font-mono font-medium">{event.action}</span>

									{#if event.criterion_code}
										<span class="text-[10px] px-1.5 py-0.2 rounded bg-[#08060B] text-[#DDEBFB]/60 border border-[#DDEBFB]/10">
											{event.criterion_code}
										</span>
									{/if}
								</div>

								{#if event.status}
									<span class="text-[10px] px-1.5 py-0.5 rounded border {badgeClass(event.status)}">
										{event.status}
										{#if event.score !== null && event.score !== undefined}
											&bull; {event.score}%
										{/if}
									</span>
								{/if}
							</div>

							<!-- Rationale / Comment / Description -->
							<div class="text-[11px] p-2.5 rounded bg-[#08060B]/90 border border-[#DDEBFB]/10 leading-relaxed {event.status === 'PASS' ? 'text-emerald-300' : event.status === 'FAIL' ? 'text-rose-300' : event.status === 'WARN' ? 'text-amber-300' : 'text-[#DDEBFB]/80'}">
								<span class="font-bold uppercase tracking-wider text-[9px] block text-[#DDEBFB]/50 mb-0.5">
									{event.status === 'PASS' ? '✓ Passed Rationale' : event.status === 'FAIL' ? '✗ Failed Rationale' : event.status === 'WARN' ? '⚠ Warning Rationale' : 'Event Rationale / Details'}:
								</span>
								{event.comment || 'Event recorded.'}
							</div>

							<!-- Event Footer -->
							<div class="flex items-center justify-between text-[10px] text-[#DDEBFB]/40 font-mono pt-0.5 border-t border-[#DDEBFB]/5">
								<span>Actor: <span class="text-[#DDEBFB]/70">{event.actor}</span></span>
								<span>{new Date(event.timestamp).toLocaleString()}</span>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
