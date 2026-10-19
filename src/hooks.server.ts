import type { Handle } from '@sveltejs/kit';

const INTERNAL_BEARER_SECRET = process.env.INTERNAL_BEARER_SECRET || 'nova_bearer_secret_2026';
const PUBLIC_PASSCODE = process.env.PUBLIC_PASSCODE || 'nova_passcode_2026';

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;

	// Rule 1: All v1/public/get/* routes are public and require no authentication
	if (pathname.startsWith('/v1/public/get/')) {
		return resolve(event);
	}

	// Rule 2: All v1/private/* routes require an internal bearer secret header
	if (pathname.startsWith('/v1/private/')) {
		const authHeader = event.request.headers.get('authorization') || '';
		const token = authHeader.replace(/^Bearer\s+/i, '').trim();

		if (!token || token !== INTERNAL_BEARER_SECRET) {
			return new Response(
				JSON.stringify({
					error: 'Unauthorized: Missing or invalid internal bearer secret header'
				}),
				{
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
	}

	// Rule 3: All v1/public/post/* routes require a passcode header
	if (pathname.startsWith('/v1/public/post/')) {
		const passcode =
			event.request.headers.get('x-passcode') ||
			event.request.headers.get('passcode') ||
			'';

		if (!passcode || passcode !== PUBLIC_PASSCODE) {
			return new Response(
				JSON.stringify({
					error: 'Forbidden: Missing or invalid passcode header (x-passcode)'
				}),
				{
					status: 403,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
	}

	return resolve(event);
};
