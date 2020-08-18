const fs = require("fs")

const Termic = {
	local: (path) => {
		return fs.readFileSync(path, 'utf-8')
	},
	map: (component, array) => {
		let res = "";
		
		for(let i = 0; i < array.length; i++) {

			const item = array[i]

			if(item["map_index"]) {
				console.warn("Be careful when assigning a map_index manually.")
			}

			res += component({
				...item,
				map_index: i,
			}) + "\n"
		}

		return res.trim()
	},
	term: (componentTag, ...values) => {
		let res = "";

		let keys = Object.keys(values)

		if(keys.length == 0) return componentTag[0];
		
		for(let i = 0; i < keys.length; i++) {
			res += componentTag[i] + values[keys[i]]
		}

		if(componentTag.length > 1) {
			res += componentTag[componentTag.length - 1]
		}

		return res;
	}
}

module.exports = Termic;