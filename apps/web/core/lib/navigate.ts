/**
 * Full page load to `path`, replacing the current history entry, so the next
 * page reads a fresh session and the back button skips the step just done.
 * Kept in its own module so tests can stub it: jsdom cannot navigate.
 */
export function replaceLocation(path: string) {
	window.location.replace(path)
}
