import { GoogleGenerativeAI } from '@google/generative-ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

export const genAI = new GoogleGenerativeAI(apiKey);

export const googleProvider = createGoogleGenerativeAI({
	apiKey
});

export const DEFAULT_MODEL_NAME = 'gemini-flash-lite-latest';

export class ApiTransportError extends Error {
	public status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = 'ApiTransportError';
		this.status = status;
	}
}

/**
 * Extracts retry delay from Gemini/Google RPC RetryInfo payload or error message string.
 * Defaults to 20 seconds (20000ms) if RetryInfo is absent or cannot be parsed.
 */
const MAX_RETRY_SLEEP_MS = 45000; // Cap retry sleep at 45s to avoid freezing for hours

export function extractRetryDelayMs(error: any): number {
	const defaultDelayMs = 20000;
	if (!error) return defaultDelayMs;

	const message = typeof error.message === 'string' ? error.message : JSON.stringify(error);

	// 1. Check for "Please retry in X.Xs" or "retry in Xs"
	const retryInMatch = message.match(/retry in ([\d\.]+)s/i);
	if (retryInMatch && retryInMatch[1]) {
		const sec = parseFloat(retryInMatch[1]);
		if (!isNaN(sec) && sec > 0) {
			return Math.min(Math.ceil(sec * 1000) + 1000, MAX_RETRY_SLEEP_MS);
		}
	}

	// 2. Check for "retryDelay": "Xs" or "retryDelay": "X.Xs" or retryDelay: "Xs"
	const retryDelayMatch = message.match(/["']?retryDelay["']?\s*:\s*["']?([\d\.]+)s?["']?/i);
	if (retryDelayMatch && retryDelayMatch[1]) {
		const sec = parseFloat(retryDelayMatch[1]);
		if (!isNaN(sec) && sec > 0) {
			return Math.min(Math.ceil(sec * 1000) + 1000, MAX_RETRY_SLEEP_MS);
		}
	}

	// 3. Check error.errorDetails or statusDetails array from Google RPC payload
	if (Array.isArray(error.errorDetails)) {
		for (const detail of error.errorDetails) {
			if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
				const sec = parseFloat(detail.retryDelay);
				if (!isNaN(sec) && sec > 0) {
					return Math.min(Math.ceil(sec * 1000) + 1000, MAX_RETRY_SLEEP_MS);
				}
			}
		}
	}

	return defaultDelayMs;
}

export async function generateGeminiCompletion(
	prompt: string,
	systemInstruction?: string,
	modelName: string = DEFAULT_MODEL_NAME
): Promise<string> {
	if (!apiKey) {
		throw new Error('GEMINI_API_KEY is not configured in environment variables');
	}

	const maxTransportRetries = 5;
	let attempt = 0;
	let lastErr: any = null;

	while (attempt < maxTransportRetries) {
		try {
			const model = genAI.getGenerativeModel({
				model: modelName,
				systemInstruction
			});

			const result = await model.generateContent(prompt);
			const response = await result.response;
			return response.text();
		} catch (err: any) {
			attempt++;
			lastErr = err;

			const isRateLimit =
				err.status === 429 ||
				err.message?.includes('429') ||
				err.message?.includes('RESOURCE_EXHAUSTED') ||
				err.message?.includes('Too Many Requests');

			const isServerError =
				err.status === 503 ||
				err.status === 500 ||
				err.status === 502 ||
				err.status === 504 ||
				err.message?.includes('503') ||
				err.message?.includes('500') ||
				err.message?.includes('high demand') ||
				err.message?.includes('fetch failed') ||
				err.message?.includes('ECONNRESET');

			if (isRateLimit) {
				const waitMs = extractRetryDelayMs(err);
				console.warn(
					`[Gemini Transport] 429 Rate limit / Quota exceeded (attempt ${attempt}/${maxTransportRetries}). Sleeping ${Math.round(waitMs / 1000)}s per Google RPC RetryInfo...`
				);
				await new Promise((res) => setTimeout(res, waitMs));
			} else if (isServerError) {
				const waitMs = Math.min(attempt * 4000, 25000);
				console.warn(
					`[Gemini Transport] 5xx Server Error / Demand spike (attempt ${attempt}/${maxTransportRetries}). Sleeping ${Math.round(waitMs / 1000)}s before retrying...`
				);
				await new Promise((res) => setTimeout(res, waitMs));
			} else {
				// Non-retriable client error (e.g. invalid auth or blocked prompt)
				throw new ApiTransportError(`[Gemini API Client Error] ${err.message}`, err.status);
			}
		}
	}

	throw new ApiTransportError(
		`[Gemini API Transport Error] Exhausted ${maxTransportRetries} transport retries: ${lastErr?.message || 'Unknown network error'}`
	);
}
