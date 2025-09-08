/**
 * Constants for the Zendesk Ticket Notifier.
 */

// --- Storage Settings ---
// sessionStorage key for notified ticket IDs.
export const SESSION_STORAGE_KEY = "zendeskNotifiedTicketIds";

// --- Initialization Settings ---
// Max retries for initial data fetch.
export const MAX_INIT_RETRIES: number = 3;

// Delay between retries (ms).
export const RETRY_DELAY_MS: number = 2000;

// --- Zendesk API and URL Settings ---
// Zendesk API endpoints.
export const API_ENDPOINTS = {
	CUSTOM_STATUSES: "/api/v2/custom_statuses.json",
	GROUPS: "/api/v2/groups.json",
	SEARCH: "/api/v2/search.json",
} as const;
