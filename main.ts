import Pikic from "./pikic"
import { search } from "./core/search"

const server = Bun.serve({
	port: process.env.PORT || 3000,
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url)

		const time = Date.now()
		
		if (url.pathname === "/") {
			const page = await Pikic.local("./pages/index.xml", {})
			return new Response(page)
		}
		
		if (url.pathname === "/search") {
			const searchQuery = url.searchParams.get("q")

			if (!searchQuery) {
				return new Response(await Pikic.local("./pages/index.xml", {}), { status: 400 })
			}

			const results = await search(searchQuery)

			const totalTime = Date.now() - time

			const context = {
				search: searchQuery,
				time: (totalTime / 1000).toFixed(3),
				resultLength: results.length,
				unitName: results.length === 1 ? "result" : "results",
				results: results.map(result => ({
					...result,
					prettyUrl: result.url.replace(/^https?:\/\//, "").replace(/\/$/, "")
				}))
			}
			const page = await Pikic.local("./pages/search.xml", context)
			return new Response(page)
		}
		
		return new Response("Not Found", { status: 404 })
	}
})

console.log(`Listening at ${server.port}`)