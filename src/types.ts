/**
 * Type definitions for Zendesk API objects.
 */

/**
 * Represents a custom status object from the Zendesk API.
 */
export interface ZendeskCustomStatus {
	id: number;
	agent_label: string;
}

/**
 * Represents a simplified ticket search result object from the Zendesk API.
 */
export interface ZendeskTicketSearchResult {
	id: number;
	subject: string;
	custom_status_id: number;
	status: "new" | "open";
}
