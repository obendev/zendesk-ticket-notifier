import type { INetworkStatus, INotification, INotifier } from "./types.ts";

/**
 * A concrete implementation of INotifier that uses the browser's Notification API.
 */
export class BrowserNotifier implements INotifier {
	public requestPermission(): Promise<NotificationPermission> {
		// Return current permission if it's already denied, to avoid prompting.
		if (Notification.permission === "denied") {
			return Promise.resolve("denied");
		}
		return Notification.requestPermission();
	}

	public create(title: string, options: NotificationOptions): INotification {
		return new Notification(title, options);
	}
}

/**
 * A concrete implementation of INetworkStatus that uses the browser's online/offline events.
 */
export class BrowserNetworkStatus implements INetworkStatus {
	public on(event: "online" | "offline", callback: () => void): void {
		window.addEventListener(event, callback);
	}
}
