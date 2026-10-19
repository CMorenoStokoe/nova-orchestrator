import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepoCommits } from '$lib/github/client';

export const GET: RequestHandler = async ({ url }) => {
	const page = parseInt(url.searchParams.get('page') || '1', 10);
	const branch = url.searchParams.get('branch') || 'main';

	try {
		const commits = await getRepoCommits({
			branch,
			page,
			per_page: 15
		});

		const commitShas = commits.map((c) => c.hash);
		return json(commitShas);
	} catch (error: any) {
		console.error('Failed to get commit list:', error);
		return json(
			{ error: 'Failed to retrieve commit list from GitHub', details: error.message },
			{ status: 500 }
		);
	}
};
