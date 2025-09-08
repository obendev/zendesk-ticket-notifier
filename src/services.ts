import type { INetworkStatus, INotification, INotifier } from "./types.ts";

/**
 * `INotifier` implementation using the browser Notification API.
 */
export class BrowserNotifier implements INotifier {
	/**
	 * Requests notification permission. Does not re-prompt if already denied.
	 * @returns A promise that resolves to the NotificationPermission state.
	 */
	public requestPermission(): Promise<NotificationPermission> {
		if (Notification.permission === "denied") {
			return Promise.resolve("denied");
		}
		return Notification.requestPermission();
	}

	/**
	 * Creates a browser notification.
	 * @param title The title of the notification.
	 * @param options Optional settings for the notification.
	 * @returns A notification instance.
	 */
	public create(title: string, options: NotificationOptions): INotification {
		if (Notification.permission !== "granted") {
			console.warn(
				"[Notifier] Skipping Notification.create; permission:",
				Notification.permission,
			);
			return {
				close: () => {
					/* no-op */
				},
				onclick: null,
			};
		}
		return new Notification(title, options);
	}
}

/**
 * `INetworkStatus` implementation using browser online/offline events.
 */
export class BrowserNetworkStatus implements INetworkStatus {
	/**
	 * Registers a callback for 'online' or 'offline' events.
	 * @param event The network event to listen for ('online' or 'offline').
	 * @param callback The function to execute when the event occurs.
	 */
	public on(event: "online" | "offline", callback: () => void): void {
		window.addEventListener(event, callback);
	}
}
