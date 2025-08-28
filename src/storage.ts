import { SESSION_STORAGE_KEY } from "./config.ts";

/**
 * Type guard to check if the parsed data from sessionStorage is valid.
 */
function isValidSessionData(data: unknown): data is [number, string][] {
	return (
		Array.isArray(data) &&
		data.every(
			(item) =>
				Array.isArray(item) &&
				item.length === 2 &&
				typeof item[0] === "number" &&
				typeof item[1] === "string",
		)
	);
}

/**
 * Loads the list of already-notified tickets from sessionStorage.
 */
export function loadNotifiedTicketsFromSession(): Map<number, Date> {
	try {
		const storedData = sessionStorage.getItem(SESSION_STORAGE_KEY);
		if (storedData) {
			const parsedData = JSON.parse(storedData);

			if (!isValidSessionData(parsedData)) {
				throw new Error("Stored session data has an invalid format.");
			}

			return new Map(
				parsedData.map(([id, dateStr]) => [id, new Date(dateStr)]),
			);
		}
	} catch (error) {
		console.error(
			"[Storage] Failed to load notified tickets from session storage. Starting fresh.",
			error,
		);
		sessionStorage.removeItem(SESSION_STORAGE_KEY);
	}
	return new Map();
}

/**
 * Saves the map of notified tickets to sessionStorage.
 */
export function saveNotifiedTicketsToSession(
	notifiedTickets: Map<number, Date>,
): void {
	try {
		const ticketArray = Array.from(notifiedTickets.entries());
		sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(ticketArray));
	} catch (error) {
		console.error(
			"[Storage] Failed to save notified tickets to session storage.",
			error,
		);
	}
}
