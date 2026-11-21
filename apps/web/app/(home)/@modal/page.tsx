/**
 * The home page itself has no panel. Without this file, Next.js keeps the
 * last panel (sign in, register) in the @modal slot after an in-app
 * navigation back to "/", so it stayed open after signing in.
 */
export default function NoModal() {
	return null
}
