/**
 * Type definitions for Zendesk API objects.
 */

/**
 * Represents a custom status object from the Zendesk API.
 */
export interface ZendeskCustomStatus {
	readonly id: number;
	readonly agent_label: string;
}

/**
 * Represents a simplified ticket search result object from the Zendesk API.
 */
export interface ZendeskTicketSearchResult {
	readonly id: number;
	readonly subject: string;
	readonly custom_status_id: number;
	readonly status: string;
}
