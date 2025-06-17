import Termic from "./termic"
import { search } from "./core/search"

const server = Bun.serve({
	port: process.env.PORT || 3000,
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url)

		const time = Date.now()
		
		if (url.pathname === "/") {
			const page = await Termic.local("./pages/index.xml", {})
			return new Response(page)
		}
		
		if (url.pathname === "/search") {
			const searchQuery = url.searchParams.get("q")

			if (!searchQuery) {
				return new Response(await Termic.local("./pages/index.xml", {}), { status: 400 })
			}

			const results = await search(searchQuery)

			// strip protocol from url (http or https)
			results.forEach(result => {
				// this regex removes the protocol (http or https) and the trailing slash
				result.url = result.url.replace(/^https?:\/\//, "").replace(/\/$/, "")
			})

			const totalTime = Date.now() - time

			const context = {
				search: searchQuery,
				time: (totalTime / 1000).toFixed(3),
				resultLength: results.length,
				results
			}
			const page = await Termic.local("./pages/search.xml", context)
			return new Response(page)
		}
		
		return new Response("Not Found", { status: 404 })
	}
})

console.log(`Listening at ${server.port}`)