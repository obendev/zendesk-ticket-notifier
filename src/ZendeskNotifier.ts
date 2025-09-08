import { ApiError, type ZendeskApiClient } from "./api.ts";
import {
	BASE_SEARCH_QUERY,
	POLLING_INTERVAL_MS,
	TARGET_GROUP,
	TARGET_STATUS_LABELS,
	TARGET_TAGS,
	ZENDESK_TICKET_URL_BASE,
} from "./config.ts";
import { MAX_INIT_RETRIES, RETRY_DELAY_MS } from "./constants.ts";
import type {
	INetworkStatus,
	INotifier,
	IStorage,
	ZendeskTicketSearchResult,
} from "./types.ts";

const NEEDS_QUOTES_REGEX = /[\s:"\\]/;
const ESCAPE_CHARS_REGEX = /(["\\])/g;

/**
 * Polls Zendesk for new tickets and sends notifications.
 */
export class ZendeskNotifier {
	/**
	 * Zendesk search query.
	 */
	private searchQuery = "";
	/**
	 * Interval timer ID for polling.
	 */
	private pollingIntervalId: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Map of notified ticket IDs to their notification timestamp.
	 */
	private readonly notifiedTickets: Map<number, Date>;
	/**
	 * Zendesk API client.
	 */
	private readonly api: ZendeskApiClient;
	/**
	 * Notification service.
	 */
	private readonly notifier: INotifier;
	/**
	 * Storage for notified tickets.
	 */
	private readonly storage: IStorage<number, Date>;
	/**
	 * Prevents concurrent polling.
	 */
	private isPolling = false;
	/**
	 * Flag to gracefully stop polling.
	 */
	private stopRequested = false;

	/**
	 * Creates an instance of ZendeskNotifier.
	 * @param api Zendesk API client.
	 * @param notifier Notification service.
	 * @param storage Storage for notified tickets.
	 * @param networkStatus Network status monitor.
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
	 * Starts the polling loop.
	 */
	public async start(): Promise<void> {
		if (this.pollingIntervalId) {
			console.info(
				"[Notifier] Start called but polling is already active; ignoring.",
			);
			return;
		}
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
	 * Stops the polling loop.
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
	 * Main polling loop with API rate-limiting backoff.
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
					if (Number.isNaN(asNum)) {
						const dateMs = Date.parse(ra);
						if (!Number.isNaN(dateMs)) {
							backoffMs = Math.max(0, dateMs - Date.now());
						}
					} else {
						backoffMs = asNum * 1000;
					}
				}
				nextDelay = Math.max(POLLING_INTERVAL_MS, backoffMs);
				console.warn(
					`[Notifier] Backing off for ${nextDelay / 1000}s due to API rate limiting.`,
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
	 * Validates that search criteria are configured.
	 * Throws if not.
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
	 * Initializes with retries on failure.
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
	 * Core initialization steps.
	 */
	private async performInitializationSteps(): Promise<void> {
		await this.requestNotificationPermission();

		const [targetStatusIds, targetGroupId] = await Promise.all([
			this.fetchAndFilterStatusIds(),
			this.fetchAndFindGroupId(),
		]);

		this.buildSearchQuery(targetStatusIds, targetGroupId);
		if (!this.searchQuery.trim()) {
			throw new Error(
				"[Notifier] Search query is empty after resolving statuses/groups. " +
					"Please adjust TARGET_* config values.",
			);
		}
		console.info("[Notifier] Using dynamic search query:", this.searchQuery);
	}

	/**
	 * Fetches and filters custom status IDs based on `TARGET_STATUS_LABELS`.
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
			targets.map(({ id, agent_label }) => ({
				ID: id,
				Status: agent_label,
			})),
		);
		return targets.map((s) => s.id);
	}

	/**
	 * Finds the target group ID by name, using partial matching.
	 */
	private async fetchAndFindGroupId(): Promise<number | null> {
		if (!TARGET_GROUP) {
			return null;
		}
		const groups = await this.api.fetchAllGroups();
		const needle = TARGET_GROUP.toLowerCase();

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
	 * Fetches and processes tickets from the Zendesk API.
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
	 * Dispatches notifications for new tickets.
	 * Batches multiple tickets into a single summary notification.
	 */
	private notifyBatch(tickets: ZendeskTicketSearchResult[]): void {
		if (tickets.length === 0) {
			return;
		}

		// Add all IDs first, then persist once
		for (const t of tickets) {
			this.notifiedTickets.set(t.id, new Date());
		}
		this.storage.save(this.notifiedTickets);

		if (tickets.length === 1) {
			const ticket = tickets[0];
			if (!ticket) {
				return;
			}

			const n = this.notifier.create(`New Ticket: #${ticket.id}`, {
				body: ticket.subject,
				requireInteraction: false,
				tag: `zendesk-ticket-${ticket.id}`,
			});
			n.onclick = () => {
				window.open(
					`${ZENDESK_TICKET_URL_BASE}${ticket.id}`,
					"_blank",
					"noopener",
				);
				n.close();
			};
			console.log(
				`[Notifier] Notification sent for ticket #${ticket.id}: "${ticket.subject}"`,
			);
		} else {
			const title = `${tickets.length} new tickets`;
			const bodyLines = tickets
				.slice(0, 5)
				.map((t) => `#${t.id} — ${t.subject}`);
			const body =
				bodyLines.join("\n") +
				(tickets.length > 5 ? `\n…and ${tickets.length - 5} more` : "");
			const n = this.notifier.create(title, {
				body,
				tag: "zendesk-ticket-batch",
			});
			n.onclick = () => {
				window.open("/agent/filters/recent", "_blank", "noopener");
				n.close();
			};
			console.log(
				`[Notifier] Sent summary notification for ${tickets.length} new tickets.`,
			);
		}
	}

	/**
	 * Builds the Zendesk search query from configured parts.
	 */
	private buildSearchQuery(statusIds: number[], groupId: number | null): void {
		const qp: string[] = [];

		if (BASE_SEARCH_QUERY) {
			qp.push(BASE_SEARCH_QUERY);
		}

		const safe = (s: string) =>
			NEEDS_QUOTES_REGEX.test(s)
				? `"${s.replace(ESCAPE_CHARS_REGEX, "\\$1")}"`
				: s;

		if (TARGET_TAGS.length > 0) {
			qp.push(`tags:${TARGET_TAGS.map(safe).join(",")}`);
		}

		if (groupId !== null) {
			qp.push(`group:${groupId}`);
		}

		if (statusIds.length > 0) {
			qp.push(statusIds.map((id) => `custom_status_id:${id}`).join(" "));
		}

		this.searchQuery = qp.join(" ");
	}

	/**
	 * Requests notification permission without throwing on denial.
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
