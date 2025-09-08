/**
 * Configuration for the Zendesk Ticket Notifier.
 */

// --- Polling Settings ---
// Polling interval for new tickets (ms).
export const POLLING_INTERVAL_MS: number =
	Number(process.env.POLLING_INTERVAL_MS) || 15_000;

// --- Search Query Settings ---
// User-facing labels of custom statuses to watch.
export const TARGET_STATUS_LABELS: readonly string[] =
	process.env.TARGET_STATUS_LABELS?.split(",") || [];

// Tags to include in the search query.
export const TARGET_TAGS: readonly string[] =
	process.env.TARGET_TAGS?.split(",") || [];

// Target group name (best-match search).
export const TARGET_GROUP: string = process.env.TARGET_GROUP || "";

// Base search query for static filters.
export const BASE_SEARCH_QUERY: string = process.env.BASE_SEARCH_QUERY || "";

// --- Zendesk API and URL Settings ---
// API request timeout (ms).
export const API_REQUEST_TIMEOUT_MS =
	Number(process.env.API_REQUEST_TIMEOUT_MS) || 15_000;

// Base path for ticket URLs.
export const ZENDESK_TICKET_URL_BASE =
	process.env.ZENDESK_TICKET_URL_BASE || "/agent/tickets/";
