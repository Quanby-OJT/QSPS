/** Adapter contract: a configured gateway accepts a JSON send request. */
export interface SmsSender {
	send(to: string, text: string): Promise<void>
}

export class HttpSmsSender implements SmsSender {
	constructor(
		private readonly endpoint: URL,
		private readonly token: string,
		private readonly sender: string
	) {}

	async send(to: string, text: string): Promise<void> {
		const response = await fetch(this.endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.token}` },
			body: JSON.stringify({ to, from: this.sender, text }),
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
		})
		if (!response.ok) throw new Error("SMS provider declined the message")
	}
}
