/**
 * Zendesk API object types.
 */

/**
 * Zendesk custom status.
 */
export interface ZendeskCustomStatus {
	readonly id: number;
	readonly agent_label: string;
}

/**
 * Zendesk group.
 */
export interface ZendeskGroup {
	readonly id: number;
	readonly name: string;
}

/**
 * Simplified Zendesk ticket search result.
 */
export interface ZendeskTicketSearchResult {
	readonly id: number;
	readonly subject: string;
	readonly custom_status_id: number;
	readonly status: string;
}

// --- Service Interfaces ---

/**
 * Service for creating notifications.
 */
export interface INotifier {
	requestPermission(): Promise<NotificationPermission>;
	create(title: string, options: NotificationOptions): INotification;
}

/**
 * Abstracted notification instance.
 */
export interface INotification {
	onclick: ((this: Notification, ev: Event) => unknown) | null;
	close(): void;
}

/**
 * Key-value storage service.
 */
export interface IStorage<K, V> {
	save(data: Map<K, V>): void;
	load(): Map<K, V>;
}

/**
 * Service for monitoring network status.
 */
export interface INetworkStatus {
	on(event: "online" | "offline", callback: () => void): void;
}
