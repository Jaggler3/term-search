const { term } = require("../../termic")

const SearchResult = ({ name, url, map_index }) => term`
	link:${name}
		-key: ${map_index + 1}
		-url: ${url}
	end
`

module.exports = SearchResult;