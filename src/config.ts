/**
 * Configuration for the Zendesk Ticket Notifier.
 */

// --- Polling Settings ---
// The interval in milliseconds for how often to check for new tickets.
export const POLLING_INTERVAL_MS: number = 15_000; // 15 seconds

// The user-facing labels of the custom statuses to notify for.
// `as const` makes this a readonly tuple for improved type safety.
export const TARGET_STATUS_LABELS = ["New", "Triage"] as const;

// The base part of the search query. Additional filters will be added dynamically.
export const BASE_SEARCH_QUERY: string = "tags:plesk_emea";

// --- Storage Settings ---
// The key used to store notified ticket IDs in sessionStorage.
export const SESSION_STORAGE_KEY = "zendeskNotifiedTicketIds";

// --- Initialization Settings ---
// The maximum number of times to retry fetching initial data (like custom status IDs).
export const MAX_INIT_RETRIES: number = 3;

// The delay in milliseconds between each retry attempt.
export const RETRY_DELAY_MS: number = 2000; // 2 seconds

// --- Zendesk API and URL Settings ---
// Base path for constructing ticket URLs.
export const ZENDESK_TICKET_URL_BASE = "/agent/tickets/";

// API endpoints
export const API_ENDPOINTS = {
	CUSTOM_STATUSES: "/api/v2/custom_statuses.json",
	SEARCH: "/api/v2/search.json",
} as const;
