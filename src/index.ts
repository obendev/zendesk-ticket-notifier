import { ZendeskApiClient } from "./api.ts";
import { BrowserNetworkStatus, BrowserNotifier } from "./services.ts";
import { SessionStorage } from "./storage.ts";
import { ZendeskNotifier } from "./ZendeskNotifier.ts";

/**
 * Application entry point.
 * Creates an instance of the notifier and starts it.
 */
const apiClient = new ZendeskApiClient(window.fetch.bind(window));
const notifier = new BrowserNotifier();
const storage = new SessionStorage();
const networkStatus = new BrowserNetworkStatus();

new ZendeskNotifier(apiClient, notifier, storage, networkStatus).start();
