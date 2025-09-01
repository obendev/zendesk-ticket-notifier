import { API_ENDPOINTS } from "./config.ts";
import type {
	ZendeskCustomStatus,
	ZendeskGroup,
	ZendeskTicketSearchResult,
} from "./types.ts";

/**
 * Custom error class for API-specific failures.
 */
export class ApiError extends Error {
	public override readonly name = "ApiError";
	public readonly status: number | undefined;
	public readonly body: unknown;
	public override cause: unknown;

	/**
	 * Creates an instance of ApiError.
	 * @param message The error message.
	 * @param status The HTTP status code, if applicable.
	 * @param body The raw response body, if applicable.
	 */
	public constructor(
		message: string,
		status?: number,
		body?: unknown,
		cause?: unknown,
	) {
		super(message);
		this.status = status;
		this.body = body;
		this.cause = cause;
	}
}

/**
 * A client to interact with the Zendesk API.
 */
export class ZendeskApiClient {
	/**
	 * Fetches a resource from the Zendesk API.
	 * @param endpoint The API endpoint to fetch from.
	 * @param options Optional standard fetch options (e.g., method, headers, body).
	 * @returns A promise that resolves to the JSON response.
	 */
	private async fetch<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15_000);

		try {
			const response = await fetch(endpoint, {
				headers: { Accept: "application/json", ...options.headers },
				signal: controller.signal,
				...options,
			});

			if (!response.ok) {
				const errorBody = await response.text().catch(() => "");
				const retryAfter = response.headers.get("Retry-After");
				throw new ApiError(
					`API request to ${endpoint} failed with status ${response.status}.`,
					response.status,
					{ body: errorBody, retryAfter },
				);
			}

			// Handle cases where the response might be empty
			if (response.status === 204 /* No Content */) {
				return {} as T;
			}

			// Defensive check for content type before parsing JSON.
			const contentType = response.headers.get("content-type") || "";
			if (!contentType.includes("application/json")) {
				const textBody = await response.text();
				throw new ApiError(
					`Expected JSON response but got ${contentType} from ${endpoint}.`,
					response.status,
					textBody,
				);
			}
			return await response.json();
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				throw new ApiError(`Request to ${endpoint} timed out.`);
			}
			// Re-throw other errors (e.g., network failures).
			throw error;
		} finally {
			// Clean up the timeout in all cases.
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Fetches all custom statuses from the Zendesk API.
	 * @returns A promise that resolves to an array of custom status objects.
	 */
	public async fetchAllCustomStatuses(): Promise<ZendeskCustomStatus[]> {
		const data = await this.fetch<{
			custom_statuses: ZendeskCustomStatus[];
		}>(API_ENDPOINTS.CUSTOM_STATUSES);
		return data.custom_statuses;
	}

	/**
	 * Fetches all groups from the Zendesk API.
	 * @returns A promise that resolves to an array of group objects.
	 */
	public async fetchAllGroups(): Promise<ZendeskGroup[]> {
		const data = await this.fetch<{ groups: ZendeskGroup[] }>(
			API_ENDPOINTS.GROUPS,
		);
		return data.groups;
	}

	/**
	 * Fetches tickets from the Zendesk Search API based on a query.
	 * @param searchQuery The fully constructed query string.
	 * @returns A promise that resolves to an array of ticket search results.
	 */
	public async searchForTickets(
		searchQuery: string,
	): Promise<ZendeskTicketSearchResult[]> {
		const encodedQuery = encodeURIComponent(searchQuery);
		const url = `${API_ENDPOINTS.SEARCH}?query=${encodedQuery}`;

		const data = await this.fetch<{
			results: ZendeskTicketSearchResult[];
		}>(url);
		return data.results ?? [];
	}
}
