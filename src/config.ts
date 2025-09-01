/**
 * Configuration for the Zendesk Ticket Notifier.
 */

// --- Polling Settings ---
// The interval in milliseconds for how often to check for new tickets.
export const POLLING_INTERVAL_MS: number = 15_000;

// --- Search Query Settings ---
// The user-facing labels of the custom statuses to notify for.
export const TARGET_STATUS_LABELS: readonly string[] = [];

// A list of tags to include in the search query.
export const TARGET_TAGS: readonly string[] = [];

// A string used to identify the target group by name, with the script finding the closest match.
export const TARGET_GROUP: string = "";

// The base part of the search query for any other static filters.
export const BASE_SEARCH_QUERY: string = "";

// --- Storage Settings ---
// The key used to store notified ticket IDs in sessionStorage.
export const SESSION_STORAGE_KEY = "zendeskNotifiedTicketIds";

// --- Initialization Settings ---
// The maximum number of times to retry fetching initial data.
export const MAX_INIT_RETRIES: number = 3;

// The delay in milliseconds between each retry attempt.
export const RETRY_DELAY_MS: number = 2000;

// --- Zendesk API and URL Settings ---
// The timeout in milliseconds for API requests.
export const API_REQUEST_TIMEOUT_MS = 15_000;

// Base path for constructing ticket URLs.
export const ZENDESK_TICKET_URL_BASE = "/agent/tickets/";

// API endpoints
export const API_ENDPOINTS = {
	CUSTOM_STATUSES: "/api/v2/custom_statuses.json",
	GROUPS: "/api/v2/groups.json",
	SEARCH: "/api/v2/search.json",
} as const;
