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

	/**
	 * Creates an instance of ApiError.
	 * @param message The error message.
	 * @param status The HTTP status code, if applicable.
	 * @param body The raw response body, if applicable.
	 */
	public constructor(message: string, status?: number, body?: unknown) {
		super(message);
		this.status = status;
		this.body = body;
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
	private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
		const response = await fetch(endpoint, options);

		if (!response.ok) {
			const errorBody = await response.text();
			throw new ApiError(
				`API request to ${endpoint} failed with status ${response.status}.`,
				response.status,
				errorBody,
			);
		}

		// Handle cases where the response might be empty
		if (response.status === 204 /* No Content */) {
			return {} as T;
		}

		try {
			return await response.json();
		} catch {
			// Throw a custom error if JSON parsing fails
			throw new ApiError(
				`Failed to parse JSON from ${endpoint}.`,
				response.status,
			);
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
