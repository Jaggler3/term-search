const express = require("express")
const app = express()

const Termic = require("./termic")

const AppPage = require("./src/pages/App")
const SearchPage = require("./src/pages/Search")
const SearchResultComponent = require("./src/components/SearchResult")

app.get("/", (req, res) => {
	const page = AppPage({})
	res.send(page)
})

app.get("/search", (req, res) => {
	console.log(req.header("Content-Type"))
	const searchQueryResults = [
		{ name: "Page 1", url: "http://page.com"},
		{ name: "Page 2", url: "http://page.com"},
		{ name: "Page 3", url: "http://page.com"}
	]
	const page = SearchPage({
		search: req.query["q"],
		results: Termic.map(SearchResultComponent, searchQueryResults)
	})
	res.send(page)
})


const PORT = process.env.PORT || 300;
app.listen(PORT, () => {
	console.log(`Listening at ${PORT}`)
})