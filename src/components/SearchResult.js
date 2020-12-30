const SearchResult = ({ name, url, map_index }) => `
	link:${name}
		-key: ${map_index + 1}
		-url: ${url}
	end
`

module.exports = SearchResult;