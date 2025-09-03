import { API_ENDPOINTS, API_REQUEST_TIMEOUT_MS } from "./config.ts";
import type {
	ZendeskCustomStatus,
	ZendeskGroup,
	ZendeskTicketSearchResult,
} from "./types.ts";

/**
 * Error for Zendesk API failures.
 */
export class ApiError extends Error {
	public override readonly name = "ApiError";
	/**
	 * HTTP status code.
	 */
	public readonly status: number | undefined;
	/**
	 * Raw API response body.
	 */
	public readonly body: unknown;
	/**
	 * Underlying error cause.
	 */
	public override cause?: unknown;

	/**
	 * Creates an instance of ApiError.
	 * @param message Error message.
	 * @param status HTTP status code.
	 * @param body Raw API response body.
	 * @param cause Underlying error.
	 */
	public constructor(
		message: string,
		status?: number,
		body?: unknown,
		cause?: unknown,
	) {
		super(message, cause !== undefined ? { cause } : undefined);
		this.status = status;
		this.body = body;
		this.cause = cause;
	}
}

/**
 * A client for the Zendesk API.
 */
export class ZendeskApiClient {
	/**
	 * Fetch implementation.
	 */
	private readonly fetchFn: typeof fetch;

	/**
	 * Creates an instance of ZendeskApiClient.
	 * @param fetchFn Fetch implementation.
	 */
	public constructor(fetchFn: typeof fetch) {
		this.fetchFn = fetchFn;
	}
	/**
	 * Generic fetch wrapper for the Zendesk API. Handles timeouts and non-ok responses.
	 * @param endpoint API endpoint path.
	 * @param options Standard fetch options.
	 * @returns The JSON response.
	 */
	private async fetch<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			API_REQUEST_TIMEOUT_MS,
		);

		try {
			const response = await this.fetchFn(endpoint, {
				...options,
				cache: "no-cache",
				headers: {
					...options.headers,
					Accept: "application/json",
					"X-Requested-With": "XMLHttpRequest",
				},
				signal: controller.signal,
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

			if (response.status === 204) {
				return {} as T;
			}

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
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Fetches all custom statuses.
	 * @returns Custom status objects.
	 */
	public async fetchAllCustomStatuses(): Promise<ZendeskCustomStatus[]> {
		const data = await this.fetch<{
			custom_statuses: ZendeskCustomStatus[];
		}>(API_ENDPOINTS.CUSTOM_STATUSES);
		return data.custom_statuses;
	}

	/**
	 * Fetches all groups.
	 * @returns Group objects.
	 */
	public async fetchAllGroups(): Promise<ZendeskGroup[]> {
		const data = await this.fetch<{ groups: ZendeskGroup[] }>(
			API_ENDPOINTS.GROUPS,
		);
		return data.groups;
	}

	/**
	 * Searches for tickets.
	 * @param searchQuery Zendesk search query.
	 * @returns Ticket search results.
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
