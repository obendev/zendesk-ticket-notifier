import type { INetworkStatus, INotification, INotifier } from "./types.ts";

/**
 * A concrete implementation of INotifier that uses the browser's Notification API.
 */
export class BrowserNotifier implements INotifier {
	/**
	 * Requests permission from the user to display notifications.
	 * If permission is already denied, it avoids re-prompting.
	 * @returns A promise that resolves to the NotificationPermission state.
	 */
	public requestPermission(): Promise<NotificationPermission> {
		// Return current permission if it's already denied, to avoid prompting.
		if (Notification.permission === "denied") {
			return Promise.resolve("denied");
		}
		return Notification.requestPermission();
	}

	/**
	 * Creates and returns a new browser Notification instance.
	 * @param title The title of the notification.
	 * @param options Optional settings for the notification.
	 * @returns An INotification instance.
	 */
	public create(title: string, options: NotificationOptions): INotification {
		return new Notification(title, options);
	}
}

/**
 * A concrete implementation of INetworkStatus that uses the browser's online/offline events.
 */
export class BrowserNetworkStatus implements INetworkStatus {
	/**
	 * Registers a callback function for network status changes (online/offline).
	 * @param event The network event to listen for ('online' or 'offline').
	 * @param callback The function to execute when the event occurs.
	 */
	public on(event: "online" | "offline", callback: () => void): void {
		window.addEventListener(event, callback);
	}
}
