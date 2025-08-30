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
	private pollingIntervalId: number | undefined;
	private readonly notifiedTickets = new Map<number, Date>();
	private readonly api: ZendeskApiClient;

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
	 * Initializes the notifier by requesting permissions, fetching necessary data,
	 * and starting the polling interval.
	 */
	public async start(): Promise<void> {
		try {
			console.info("[Notifier] Initializing...");
			const isInitialized = await this.initializeWithRetries();

			if (isInitialized) {
				console.log("[Notifier] Initialization successful. Starting polling.");
				await this.poll(); // Run once immediately.
				this.pollingIntervalId = window.setInterval(
					() => this.poll(),
					POLLING_INTERVAL_MS,
				);
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
		if (this.pollingIntervalId) {
			clearInterval(this.pollingIntervalId);
			this.pollingIntervalId = undefined;
			console.info("[Notifier] Polling stopped.");
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
			if (error instanceof ApiError && attempt < MAX_INIT_RETRIES) {
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
		console.info("[Notifier] Checking for new tickets...");
		try {
			const foundTickets = await this.api.searchForTickets(this.searchQuery);
			const newTickets = foundTickets.filter(
				(ticket) => !this.notifiedTickets.has(ticket.id),
			);

			if (newTickets.length > 0) {
				console.log(`[Notifier] Found ${newTickets.length} new tickets.`);
				for (const ticket of newTickets) {
					this.notify(ticket);
				}
			} else {
				console.log("[Notifier] Check complete. No new tickets found.");
			}
		} catch (error) {
			console.error("[Notifier] Failed to poll for new tickets:", error);
		}
	}

	/**
	 * Creates and dispatches a browser notification for a ticket.
	 */
	private notify(ticket: ZendeskTicketSearchResult): void {
		this.saveNotifiedTicket(ticket.id);

		const notification = new Notification(`New Ticket: #${ticket.id}`, {
			body: ticket.subject,
			tag: `zendesk-ticket-${ticket.id}`,
		});

		notification.onclick = () => {
			window.open(`${ZENDESK_TICKET_URL_BASE}${ticket.id}`, "_blank");
			notification.close();
		};

		console.log(
			`[Notifier] Notification sent for ticket #${ticket.id}: "${ticket.subject}"`,
		);
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

		if (groupId) {
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
	 * Requests permission to send notifications.
	 */
	private static async requestNotificationPermission(): Promise<void> {
		if (Notification.permission === "granted") {
			return;
		}
		if (Notification.permission === "denied") {
			throw new Error("Notification permission has been explicitly denied.");
		}
		const permission = await Notification.requestPermission();
		if (permission !== "granted") {
			throw new Error(
				`Notification permission was not granted (${permission}).`,
			);
		}
	}
}
