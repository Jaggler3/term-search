module.exports = ({ search, results }) => `
@termtype:m100

cont
	-padding: 3
	text:You searched for ${search}
	end

	cont
		-height: 2
	end

	text:Results:
	end

	cont
		-padding: 1
		${results}
	end
end
`
