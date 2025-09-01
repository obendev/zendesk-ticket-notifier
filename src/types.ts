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
 * Represents a group object from the Zendesk API.
 */
export interface ZendeskGroup {
	readonly id: number;
	readonly name: string;
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

// --- Service Interfaces for Dependency Injection ---

/**
 * Interface for a service that can create notifications.
 */
export interface INotifier {
	requestPermission(): Promise<NotificationPermission>;
	create(title: string, options: NotificationOptions): INotification;
}

/**
 * Interface for a notification instance, abstracting the global Notification class.
 */
export interface INotification {
	onclick: ((this: Notification, ev: Event) => unknown) | null;
	close(): void;
}

/**
 * Interface for a key-value storage mechanism.
 */
export interface IStorage<K, V> {
	save(data: Map<K, V>): void;
	load(): Map<K, V>;
}
