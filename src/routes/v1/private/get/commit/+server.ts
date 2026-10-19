import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCommitDetails } from '$lib/github/client';

export const GET: RequestHandler = async ({ url }) => {
	const hash = url.searchParams.get('hash');

	if (!hash) {
		return json({ error: 'Missing required query parameter: hash' }, { status: 400 });
	}

	try {
		const commit = await getCommitDetails(hash);
		return json(commit);
	} catch (error: any) {
		console.error(`Failed to get commit ${hash}:`, error);
		return json(
			{ error: `Failed to retrieve commit ${hash} from GitHub`, details: error.message },
			{ status: 500 }
		);
	}
};
