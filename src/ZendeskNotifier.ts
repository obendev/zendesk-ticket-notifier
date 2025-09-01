import { ApiError, type ZendeskApiClient } from "./api.ts";
import {
	BASE_SEARCH_QUERY,
	MAX_INIT_RETRIES,
	POLLING_INTERVAL_MS,
	RETRY_DELAY_MS,
	TARGET_GROUP,
	TARGET_STATUS_LABELS,
	TARGET_TAGS,
	ZENDESK_TICKET_URL_BASE,
} from "./config.ts";
import {
	loadNotifiedTicketsFromSession,
	saveNotifiedTicketsToSession,
} from "./storage.ts";
import type { ZendeskTicketSearchResult } from "./types.ts";

/**
 * A class to handle polling for and notifying about new Zendesk tickets.
 */
export class ZendeskNotifier {
	private searchQuery = "";
	private pollingIntervalId: ReturnType<typeof setTimeout> | undefined;
	private readonly notifiedTickets = new Map<number, Date>();
	private readonly api: ZendeskApiClient;
	private isPolling = false;
	private stopRequested = false;

	/**
	 * Creates an instance of ZendeskNotifier.
	 * @param api The Zendesk API client instance.
	 */
	public constructor(api: ZendeskApiClient) {
		this.api = api;
		this.notifiedTickets = loadNotifiedTicketsFromSession();
		if (this.notifiedTickets.size > 0) {
			console.info(
				`[Notifier] Restored ${this.notifiedTickets.size} notified tickets from session.`,
			);
		}
	}

	/**
	 * Initializes the notifier and starts the polling loop.
	 */
	public async start(): Promise<void> {
		try {
			console.info("[Notifier] Initializing...");
			this.stopRequested = false; // Reset stop flag on start
			const isInitialized = await this.initializeWithRetries();

			if (isInitialized) {
				console.log("[Notifier] Initialization successful. Starting polling.");
				this.pollingLoop(); // Start the dedicated polling loop.
			} else {
				console.error(
					"[Notifier] Failed to initialize after multiple attempts. Polling will not start.",
				);
			}
		} catch (error) {
			console.error(
				"[Notifier] A critical error occurred during startup:",
				error,
			);
		}
	}

	/**
	 * Stops the background polling for new tickets.
	 */
	public stop(): void {
		this.stopRequested = true;
		if (this.pollingIntervalId) {
			clearTimeout(this.pollingIntervalId);
			this.pollingIntervalId = undefined;
			console.info("[Notifier] Polling stopped.");
		}
	}

	/**
	 * The main polling loop with backoff logic.
	 */
	private async pollingLoop(): Promise<void> {
		if (this.stopRequested) {
			return;
		}

		let nextDelay = POLLING_INTERVAL_MS;
		try {
			await this.poll();
		} catch (error) {
			if (
				error instanceof ApiError &&
				(error.status === 429 || error.status === 503)
			) {
				const retryAfterSeconds = Number(
					(error.body as { retryAfter?: string })?.retryAfter,
				);
				const backoffMs = Number.isNaN(retryAfterSeconds)
					? 60_000
					: retryAfterSeconds * 1000;
				nextDelay = Math.max(POLLING_INTERVAL_MS, backoffMs);
				console.warn(
					`[Notifier] Backing off for ${
						nextDelay / 1000
					}s due to API rate limiting.`,
				);
			} else {
				console.error("[Notifier] Failed to poll for new tickets:", error);
			}
		} finally {
			if (!this.stopRequested) {
				this.pollingIntervalId = setTimeout(
					() => this.pollingLoop(),
					nextDelay,
				);
			}
		}
	}

	/**
	 * Performs the resilient initialization process with a retry mechanism.
	 */
	private async initializeWithRetries(attempt = 1): Promise<boolean> {
		try {
			await this.performInitializationSteps();
			return true;
		} catch (error) {
			console.warn(
				`[Notifier] Initialization attempt ${attempt} failed.`,
				error,
			);
			if (
				(error instanceof ApiError || error instanceof TypeError) &&
				attempt < MAX_INIT_RETRIES
			) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				return this.initializeWithRetries(attempt + 1);
			}
			return false;
		}
	}

	/**
	 * The core steps of the initialization process.
	 */
	private async performInitializationSteps(): Promise<void> {
		await ZendeskNotifier.requestNotificationPermission();

		const [targetStatusIds, targetGroupId] = await Promise.all([
			this.fetchAndFilterStatusIds(),
			this.fetchAndFindGroupId(),
		]);

		this.buildSearchQuery(targetStatusIds, targetGroupId);
		console.info("[Notifier] Using dynamic search query:", this.searchQuery);
	}

	/**
	 * Fetches custom statuses and filters them to find the IDs of target statuses.
	 * Returns an empty array if no labels are specified.
	 */
	private async fetchAndFilterStatusIds(): Promise<number[]> {
		if (TARGET_STATUS_LABELS.length === 0) {
			return [];
		}

		const statuses = await this.api.fetchAllCustomStatuses();
		const lowerCaseLabels = TARGET_STATUS_LABELS.map((l) => l.toLowerCase());

		const targetStatuses = statuses.filter((s) =>
			lowerCaseLabels.includes(s.agent_label.toLowerCase()),
		);

		if (targetStatuses.length === 0) {
			console.warn(
				"[Notifier] Could not find any of the target custom status IDs for the given labels.",
			);
			return [];
		}

		console.log("[Notifier] Successfully fetched target status IDs:");
		console.table(
			targetStatuses.map(({ agent_label, id }) => ({
				ID: id,
				Status: agent_label,
			})),
		);

		return targetStatuses.map((s) => s.id);
	}

	/**
	 * Fetches groups and finds the ID of the one that best matches the target group name.
	 * Returns null if no group name is specified or no match is found.
	 */
	private async fetchAndFindGroupId(): Promise<number | null> {
		if (!TARGET_GROUP) {
			return null;
		}

		const groups = await this.api.fetchAllGroups();
		const lowerCaseTarget = TARGET_GROUP.toLowerCase();

		const targetGroup = groups.find((g) =>
			g.name.toLowerCase().includes(lowerCaseTarget),
		);

		if (!targetGroup) {
			console.warn(
				`[Notifier] Could not find a matching group for "${TARGET_GROUP}".`,
			);
			return null;
		}

		console.log("[Notifier] Successfully matched target group:");
		console.table([{ "Group Name": targetGroup.name, ID: targetGroup.id }]);

		return targetGroup.id;
	}

	/**
	 * The main polling function that fetches and processes tickets.
	 */
	private async poll(): Promise<void> {
		if (this.isPolling) {
			console.warn(
				"[Notifier] Skipping poll run as a previous one is still active.",
			);
			return;
		}

		this.isPolling = true;
		try {
			console.info("[Notifier] Checking for new tickets...");
			const foundTickets = await this.api.searchForTickets(this.searchQuery);
			const newTickets = foundTickets.filter(
				(ticket) => !this.notifiedTickets.has(ticket.id),
			);

			if (newTickets.length > 0) {
				console.log(`[Notifier] Found ${newTickets.length} new tickets.`);
				this.notifyBatch(newTickets);
			} else {
				console.log("[Notifier] Check complete. No new tickets found.");
			}
		} finally {
			this.isPolling = false;
		}
	}

	/**
	 * Creates and dispatches a browser notification for a batch of tickets.
	 * If only one ticket is new, it shows a specific notification.
	 * If multiple tickets are new, it shows a summary notification.
	 */
	private notifyBatch(tickets: ZendeskTicketSearchResult[]): void {
		if (tickets.length === 0) {
			return;
		}

		for (const ticket of tickets) {
			this.saveNotifiedTicket(ticket.id);
		}

		if (tickets.length === 1) {
			const ticket = tickets[0];
			if (!ticket) {
				return;
			}
			const notification = new Notification(`New Ticket: #${ticket.id}`, {
				body: ticket.subject,
				requireInteraction: false,
				tag: `zendesk-ticket-${ticket.id}`,
			});

			notification.onclick = () => {
				window.open(
					`${ZENDESK_TICKET_URL_BASE}${ticket.id}`,
					"_blank",
					"noopener",
				);
				notification.close();
			};
			console.log(
				`[Notifier] Notification sent for ticket #${ticket.id}: "${ticket.subject}"`,
			);
		} else {
			const title = `${tickets.length} new tickets`;
			const topTickets = tickets.slice(0, 5);
			let body = topTickets.map((t) => `#${t.id} — ${t.subject}`).join("\n");

			if (tickets.length > 5) {
				body += `\n…and ${tickets.length - 5} more`;
			}

			const notification = new Notification(title, {
				body,
				tag: "zendesk-ticket-batch",
			});

			notification.onclick = () => {
				// This URL should point to a view of new/recent tickets.
				window.open("/agent/filters/recent", "_blank", "noopener");
				notification.close();
			};

			console.log(
				`[Notifier] Sent summary notification for ${tickets.length} new tickets.`,
			);
		}
	}

	/**
	 * Adds a ticket ID to the notified list and saves it to sessionStorage.
	 */
	private saveNotifiedTicket(ticketId: number): void {
		this.notifiedTickets.set(ticketId, new Date());
		saveNotifiedTicketsToSession(this.notifiedTickets);
	}

	/**
	 * Builds the final search query by combining base query, tags, statuses, and group.
	 * Throws an error if the resulting query is empty.
	 */
	private buildSearchQuery(statusIds: number[], groupId: number | null): void {
		const queryParts: string[] = [];

		if (BASE_SEARCH_QUERY) {
			queryParts.push(BASE_SEARCH_QUERY);
		}

		if (TARGET_TAGS.length > 0) {
			queryParts.push(`tags:${TARGET_TAGS.join(",")}`);
		}

		if (groupId !== null) {
			queryParts.push(`group:${groupId}`);
		}

		if (statusIds.length > 0) {
			const statusQueryPart = statusIds
				.map((id) => `custom_status_id:${id}`)
				.join(" ");
			queryParts.push(statusQueryPart);
		}

		if (queryParts.length === 0) {
			throw new Error(
				"Search query is empty. Please set at least one search criterion in the config.",
			);
		}

		this.searchQuery = queryParts.join(" ");
	}

	/**
	 * Requests permission to send notifications gracefully.
	 * It no longer throws an error if permission is denied.
	 */
	private static async requestNotificationPermission(): Promise<void> {
		if (Notification.permission === "granted") {
			return;
		}
		if (Notification.permission === "denied") {
			console.warn(
				"[Notifier] Notification permission has been explicitly denied. The notifier will work without system notifications.",
			);
			return;
		}
		try {
			const permission = await Notification.requestPermission();
			if (permission !== "granted") {
				console.warn(
					`[Notifier] Notification permission was not granted (${permission}). The notifier will work without system notifications.`,
				);
			}
		} catch (error) {
			console.error(
				"[Notifier] Error requesting notification permission:",
				error,
			);
		}
	}
}
