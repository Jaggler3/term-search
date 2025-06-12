import Termic from "./termic"

interface SearchResult {
	name: string;
	url: string;
	description: string;
}

const server = Bun.serve({
	port: process.env.PORT || 3000,
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url)
		
		if (url.pathname === "/") {
			const page = await Termic.local("./pages/index.xml", {})
			return new Response(page)
		}
		
		if (url.pathname === "/search") {
			const searchQuery = url.searchParams.get("q")
			const context = {
				search: searchQuery,
				time: 0.001,
				results: [
					{ name: "Page 1", url: "http://google.com", description: "This is a description of page 1" },
					{ name: "Page 2", url: "http://bing.com", description: "This is a description of page 2" },
					{ name: "Page 3", url: "http://yahoo.com", description: "This is a description of page 3" }
				] as SearchResult[]
			}
			const page = await Termic.local("./pages/search.xml", context)
			return new Response(page)
		}
		
		return new Response("Not Found", { status: 404 })
	}
})

console.log(`Listening at ${server.port}`)