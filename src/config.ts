/**
 * Configuration for the Zendesk Ticket Notifier.
 */

// --- Polling Settings ---
// Polling interval for new tickets (ms).
export const POLLING_INTERVAL_MS: number = 15_000;

// --- Search Query Settings ---
// User-facing labels of custom statuses to watch.
export const TARGET_STATUS_LABELS: readonly string[] = [];

// Tags to include in the search query.
export const TARGET_TAGS: readonly string[] = [];

// Target group name (best-match search).
export const TARGET_GROUP: string = "";

// Base search query for static filters.
export const BASE_SEARCH_QUERY: string = "";

// --- Storage Settings ---
// sessionStorage key for notified ticket IDs.
export const SESSION_STORAGE_KEY = "zendeskNotifiedTicketIds";

// --- Initialization Settings ---
// Max retries for initial data fetch.
export const MAX_INIT_RETRIES: number = 3;

// Delay between retries (ms).
export const RETRY_DELAY_MS: number = 2000;

// --- Zendesk API and URL Settings ---
// API request timeout (ms).
export const API_REQUEST_TIMEOUT_MS = 15_000;

// Base path for ticket URLs.
export const ZENDESK_TICKET_URL_BASE = "/agent/tickets/";

// Zendesk API endpoints.
export const API_ENDPOINTS = {
	CUSTOM_STATUSES: "/api/v2/custom_statuses.json",
	GROUPS: "/api/v2/groups.json",
	SEARCH: "/api/v2/search.json",
} as const;
