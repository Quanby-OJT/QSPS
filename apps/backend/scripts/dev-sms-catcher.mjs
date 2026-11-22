// Development-only gateway fixture. Binds to loopback and never forwards messages.
import { timingSafeEqual } from "node:crypto"
import http from "node:http"

if (process.env.NODE_ENV === "production") throw new Error("Local SMS catcher is development only")
const token = process.env.SMS_API_TOKEN
if (!token || token.length < 8) throw new Error("Set a local SMS_API_TOKEN (at least 8 characters)")
const messages = []
const escape = value =>
	String(value).replace(
		/[&<>"']/g,
		ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
	)
const server = http.createServer(async (req, res) => {
	res.setHeader("Cache-Control", "no-store")
	res.setHeader("X-Content-Type-Options", "nosniff")
	res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	while (messages.length && Date.now() - messages[0].time > 15 * 60_000) messages.shift()
	if (req.method === "GET" && req.url === "/") {
		res.setHeader("Content-Type", "text/html; charset=utf-8")
		res.end(
			`<h1>QSPS local SMS inbox</h1><p>Test messages only. Reload after sending. Messages expire after 15 minutes.</p>${messages
				.slice()
				.reverse()
				.map(
					m =>
						`<article style="padding:12px;border:1px solid #aaa;margin:12px"><strong>${escape(m.from)}</strong> to ${escape(m.to)}<p>${escape(m.text)}</p></article>`
				)
				.join("")}`
		)
		return
	}
	if (req.method !== "POST" || req.url !== "/send") {
		res.writeHead(404).end()
		return
	}
	const provided = Buffer.from(req.headers.authorization ?? "")
	const expected = Buffer.from(`Bearer ${token}`)
	if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
		res.writeHead(401).end()
		return
	}
	try {
		let body = ""
		for await (const chunk of req) {
			body += chunk
			if (body.length > 4096) {
				res.writeHead(413).end()
				return
			}
		}
		const item = JSON.parse(body)
		if (
			typeof item.to !== "string" ||
			typeof item.from !== "string" ||
			typeof item.text !== "string" ||
			item.text.length > 1000
		) {
			res.writeHead(400).end()
			return
		}
		messages.push({ to: item.to, from: item.from, text: item.text, time: Date.now() })
		if (messages.length > 100) messages.shift()
		res.writeHead(202).end()
	} catch {
		res.writeHead(400).end()
	}
})
server.listen(8026, "127.0.0.1", () => console.log("Local test SMS inbox: http://127.0.0.1:8026"))
