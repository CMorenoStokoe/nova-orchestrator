/**
 * Chunker and diff splitter to avoid context window overflow during multi-agent evaluations
 */

export interface DiffChunk {
	file: string;
	content: string;
	estimatedTokens: number;
}

const MAX_CHUNK_TOKENS = 3000;

export function estimateTokens(text: string): number {
	// Approximation: 1 token ~= 4 chars for code/english
	return Math.ceil(text.length / 4);
}

export interface RawDiffHunk {
	file: string;
	header: string;
	hunk: string;
}

export function extractUnifiedDiffHunks(diff: string): RawDiffHunk[] {
	if (!diff) return [];
	const hunks: RawDiffHunk[] = [];

	// Split by git diff file headers
	const fileSections = diff.split(/(?=^diff --git|^--- a\/)/m);

	for (const section of fileSections) {
		const trimmed = section.trim();
		if (!trimmed) continue;

		// Extract filename
		const fileMatch = trimmed.match(/(?:--- a\/|\+\+\+ b\/|^diff --git a\/)(.*?)(?:\s|$)/m);
		const fileName = fileMatch ? fileMatch[1].trim() : 'unknown';

		// Extract individual hunks (sections starting with @@)
		const hunkParts = trimmed.split(/(?=^@@\s+-\d+)/m);
		for (const part of hunkParts) {
			const trimmedPart = part.trim();
			if (!trimmedPart.startsWith('@@')) continue;

			const headerMatch = trimmedPart.match(/^(@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@[^\n]*)/m);
			const header = headerMatch ? headerMatch[1] : '@@';

			// Ensure it has diff lines (+ or -)
			const lines = trimmedPart.split('\n');
			const hasDiffLines = lines.some((l) => l.startsWith('+') || l.startsWith('-'));

			if (hasDiffLines) {
				hunks.push({
					file: fileName,
					header,
					hunk: trimmedPart
				});
			}
		}
	}

	return hunks;
}

/**
 * Formats raw unified diff hunks (with @@ ... @@ and +/- lines) into an ingestion string for agents.
 * Never passes summary metadata ("Changed files: ...").
 */
export function formatRawDiffHunksForPrompt(diff: string, maxTokens = 6000): string {
	if (!diff) return 'No diff provided for this commit.';

	const hunks = extractUnifiedDiffHunks(diff);
	if (hunks.length === 0) {
		// If git diff didn't split into clean hunks, verify if diff itself has unified diff lines
		const lines = diff.split('\n');
		const hasDiffLines = lines.some((l) => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));
		if (hasDiffLines) {
			return diff.substring(0, maxTokens * 4);
		}
		return 'No unified diff changes available in this commit.';
	}

	const formattedHunks: string[] = [];
	let currentChars = 0;
	const maxChars = maxTokens * 4;

	for (const h of hunks) {
		const snippet = `File: ${h.file}\n${h.hunk}\n`;
		if (currentChars + snippet.length > maxChars && formattedHunks.length > 0) {
			break;
		}
		formattedHunks.push(snippet);
		currentChars += snippet.length;
	}

	return formattedHunks.join('\n---\n');
}

export function chunkCommitDiff(diff: string, maxChunkTokens = MAX_CHUNK_TOKENS): DiffChunk[] {
	if (!diff) return [];

	// Split by git diff file headers
	const fileSections = diff.split(/(?=^diff --git|^--- a\/)/m);
	const chunks: DiffChunk[] = [];

	for (const section of fileSections) {
		const trimmed = section.trim();
		if (!trimmed) continue;

		// Extract filename
		const fileMatch = trimmed.match(/(?:--- a\/|\+\+\+ b\/|^diff --git a\/)(.*?)(?:\s|$)/m);
		const fileName = fileMatch ? fileMatch[1].trim() : 'unknown';

		const tokens = estimateTokens(trimmed);

		if (tokens <= maxChunkTokens) {
			chunks.push({
				file: fileName,
				content: trimmed,
				estimatedTokens: tokens
			});
		} else {
			// Sub-chunk oversized file changes by line blocks
			const lines = trimmed.split('\n');
			let currentBlock: string[] = [];
			let currentTokens = 0;
			let part = 1;

			for (const line of lines) {
				const lineTokens = estimateTokens(line) + 1;
				if (currentTokens + lineTokens > maxChunkTokens && currentBlock.length > 0) {
					chunks.push({
						file: `${fileName} (part ${part})`,
						content: currentBlock.join('\n'),
						estimatedTokens: currentTokens
					});
					currentBlock = [line];
					currentTokens = lineTokens;
					part++;
				} else {
					currentBlock.push(line);
					currentTokens += lineTokens;
				}
			}

			if (currentBlock.length > 0) {
				chunks.push({
					file: `${fileName} (part ${part})`,
					content: currentBlock.join('\n'),
					estimatedTokens: currentTokens
				});
			}
		}
	}

	return chunks;
}
