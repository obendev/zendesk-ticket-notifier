import { ZendeskApiClient } from "./api.ts";
import { ZendeskNotifier } from "./ZendeskNotifier.ts";

/**
 * Application entry point.
 * Creates an instance of the notifier and starts it.
 */
const apiClient = new ZendeskApiClient();
new ZendeskNotifier(apiClient).start();
