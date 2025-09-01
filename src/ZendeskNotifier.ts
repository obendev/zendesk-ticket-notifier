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
import type {
	INetworkStatus,
	INotifier,
	IStorage,
	ZendeskTicketSearchResult,
} from "./types.ts";

/**
 * A class to handle polling for and notifying about new Zendesk tickets.
 */
export class ZendeskNotifier {
	/**
	 * The current search query string used for Zendesk API requests.
	 */
	private searchQuery = "";
	/**
	 * Stores the ID of the polling interval timer, allowing it to be cleared.
	 */
	private pollingIntervalId: ReturnType<typeof setTimeout> | undefined;
	/**
	 * A map of ticket IDs that have already been notified, along with the notification timestamp.
	 */
	private readonly notifiedTickets: Map<number, Date>;
	/**
	 * The Zendesk API client for making requests.
	 */
	private readonly api: ZendeskApiClient;
	/**
	 * The service responsible for displaying notifications.
	 */
	private readonly notifier: INotifier;
	/**
	 * The storage service for persisting notified ticket IDs.
	 */
	private readonly storage: IStorage<number, Date>;
	/**
	 * Flag indicating if a polling operation is currently in progress.
	 */
	private isPolling = false;
	/**
	 * Flag indicating if a stop request has been made, used to gracefully exit polling loops.
	 */
	private stopRequested = false;

	/**
	 * Creates an instance of ZendeskNotifier.
	 * @param api The Zendesk API client instance.
	 * @param notifier The notification service instance.
	 * @param storage The storage service instance.
	 * @param networkStatus The network status monitoring instance.
	 */
	public constructor(
		api: ZendeskApiClient,
		notifier: INotifier,
		storage: IStorage<number, Date>,
		networkStatus: INetworkStatus,
	) {
		this.api = api;
		this.notifier = notifier;
		this.storage = storage;
		this.notifiedTickets = this.storage.load();

		if (this.notifiedTickets.size > 0) {
			console.info(
				`[Notifier] Restored ${this.notifiedTickets.size} notified tickets from session.`,
			);
		}

		networkStatus.on("online", () => this.start());
		networkStatus.on("offline", () => this.stop());
	}

	/**
	 * Initializes the notifier and starts the polling loop.
	 */
	public async start(): Promise<void> {
		try {
			this.validateConfiguration();
			console.info("[Notifier] Initializing...");
			this.stopRequested = false;
			const isInitialized = await this.initializeWithRetries();

			if (isInitialized) {
				console.log("[Notifier] Initialization successful. Starting polling.");
				this.pollingLoop();
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
	 * Executes the main polling loop, fetching and processing tickets with backoff logic.
	 * It respects the `stopRequested` flag for graceful termination.
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
				const ra = (error.body as { retryAfter?: string })?.retryAfter;
				let backoffMs = 60_000;
				if (ra) {
					const asNum = Number(ra);
					if (!Number.isNaN(asNum)) {
						backoffMs = asNum * 1000;
					} else {
						const dateMs = Date.parse(ra);
						if (!Number.isNaN(dateMs)) {
							backoffMs = Math.max(0, dateMs - Date.now());
						}
					}
				}
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
	 * Performs a pre-flight check to ensure search criteria are defined.
	 * Throws a non-retriable error if the configuration is invalid.
	 */
	private validateConfiguration(): void {
		const hasSearchCriteria =
			BASE_SEARCH_QUERY ||
			TARGET_TAGS.length > 0 ||
			TARGET_GROUP ||
			TARGET_STATUS_LABELS.length > 0;

		if (!hasSearchCriteria) {
			// Configuration error: prevents retry mechanism from engaging.
			throw new Error(
				"No search criteria found. Please define at least one of TARGET_STATUS_LABELS, TARGET_TAGS, or TARGET_GROUP in the src/config.ts file.",
			);
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
		await this.requestNotificationPermission();

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
		const wanted = new Set(TARGET_STATUS_LABELS.map((l) => l.toLowerCase()));
		const targets = statuses.filter((s) =>
			wanted.has(s.agent_label.toLowerCase()),
		);
		if (targets.length === 0) {
			console.warn(
				"[Notifier] No matching custom status IDs for the given labels.",
			);
			return [];
		}
		console.table(
			targets.map(({ id, agent_label }) => ({ ID: id, Status: agent_label })),
		);
		return targets.map((s) => s.id);
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
		const needle = TARGET_GROUP.toLowerCase();

		// exact match
		const g =
			groups.find((x) => x.name.toLowerCase() === needle) ??
			groups.find((x) => x.name.toLowerCase().startsWith(needle)) ??
			groups.find((x) => x.name.toLowerCase().includes(needle));
		if (!g) {
			console.warn(
				`[Notifier] Could not find a matching group for "${TARGET_GROUP}".`,
			);
			return null;
		}
		console.table([{ "Group Name": g.name, ID: g.id }]);
		return g.id;
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
			const notification = this.notifier.create(`New Ticket: #${ticket.id}`, {
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

			const notification = this.notifier.create(title, {
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
		this.storage.save(this.notifiedTickets);
	}

	/**
	 * Builds the final search query by combining base query, tags, statuses, and group.
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

		this.searchQuery = queryParts.join(" ");
	}

	/**
	 * Requests permission to send notifications gracefully.
	 * It no longer throws an error if permission is denied.
	 */
	private async requestNotificationPermission(): Promise<void> {
		try {
			const permission = await this.notifier.requestPermission();
			if (permission === "denied") {
				console.warn(
					"[Notifier] Notification permission has been explicitly denied. The notifier will work without system notifications.",
				);
			} else if (permission !== "granted") {
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
