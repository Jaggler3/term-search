const { term } = require("../../termic");

module.exports = ({ ...props }) => term`
@termtype:m100

cont
	-padding-top: 10
	-width: 100pc
	text:Enter your search
		-align: center
	end
end
cont
	-direction:row
	cont
		-width: 25pc
	end
	cont
		input
			-width: 50pc
			-submit: search
		end
	end
end
action:search(
	visit("https://term-search.herokuapp.com/search?q=" + encode(value))
)

`