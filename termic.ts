import { Parser, Builder } from "xml2js"
import fs from "fs"
import path from "path";


type ElementTag = "fragment" | "import" | "list" | "term" | "action" | "container" | "input" | "text" | "link" | "br" | "list"
const ALL_BASIC_ELEMENTS = ["container", "input", "text", "link"]
const ALL_ELEMENTS = [...ALL_BASIC_ELEMENTS, "import", "list", "term", "action", "br"]

interface ParsedTermFile {
	term?: {
		$: any;
		[key: string]: (XMLElement | string)[];
	} | XMLElement[]
}

interface XMLElement {
	$?: any;
	[key: string]: (XMLElement | string)[];
}

interface TermElement {
	tag: ElementTag;
	attributes: {
		[key: string]: string;
	};
	__props?: {
		[key: string]: string;
	};
	children: TermElement[];
	parent?: TermElement;
	textContent?: string;
	__expanded?: boolean;
	__filled?: boolean;
}

interface TermicCache {
	[key: string]: TermElement
}

const Termic = {
	cache: {} as TermicCache,
	local: async (filePath: string, context: any) => {
		// we need to add support for imports, list, templating with imported components
		const raw = fs.readFileSync(filePath, 'utf-8')

		// parse xml
		const parser = new Parser()
		const file: ParsedTermFile = await parser.parseStringPromise(raw)

		// traverse through the document
		const document = file.term
		if(Array.isArray(document)) return "Error: Cannot have multiple <term> tags in root of file"
		if(!document) return "Error: No <term> found in root of file"

		// Helper function to recursively convert XML elements to TermElement
		function convertXMLToTermElement(xmlData: any, tag: ElementTag, parent?: TermElement): TermElement {
			const element: TermElement = {
				tag,
				attributes: xmlData.$ || {},
				children: [],
				parent
			}

			// Handle text content
			if (xmlData._ && typeof xmlData._ === 'string') {
				element.textContent = xmlData._
			}

			// Process all child elements
			for (const [childTag, childData] of Object.entries(xmlData)) {
				if (childTag === '$' || childTag === '_') continue // Skip attributes and text content

				if (Array.isArray(childData)) {
					// Handle arrays of elements
					for (const childItem of childData) {
						if (typeof childItem === 'string') {
							// Handle direct string content
							const textElement: TermElement = {
								tag: 'text',
								attributes: {},
								children: [],
								parent: element,
								textContent: childItem
							}
							element.children.push(textElement)
						} else {
							// Handle nested XML elements
							const childElement = convertXMLToTermElement(childItem, childTag as ElementTag, element)
							element.children.push(childElement)
						}
					}
				} else if (typeof childData === 'object') {
					// Handle single nested element
					const childElement = convertXMLToTermElement(childData, childTag as ElementTag, element)
					element.children.push(childElement)
				}
			}

			return element
		}

		// Convert the document to TermElement and flatten all elements
		const rootElement = convertXMLToTermElement(document, 'term')

		// find all imports and load them into a local cache
		const getAllImports = (element: TermElement) => {
			const imports = element.children.filter((child) => child.tag === 'import')
			element.children.forEach((item) => {
				imports.push(...getAllImports(item))
			})
			return imports
		}

		let imports = getAllImports(rootElement)
		const loadImports = async () => {
			for(const _import of imports) {
				const { key, from } = _import.attributes
				if (!from || typeof from !== "string") continue
				if (!key || typeof key !== "string") continue
				const importPath = path.resolve(path.dirname(path.resolve(filePath)), from)
				const importRaw = fs.readFileSync(importPath, 'utf-8')
				const importDoc: ParsedTermFile = await parser.parseStringPromise(importRaw)
				Termic.cache[key] = convertXMLToTermElement(importDoc, 'term')
			}
		}

		const getAllComponents = (element: TermElement) => {
			const components = element.children.filter((child) => !ALL_ELEMENTS.includes(child.tag))
			element.children.forEach((item) => {
				components.push(...getAllComponents(item))
			})
			return components
		}

		let components = getAllComponents(rootElement)
		const prerenderComponents = (element: TermElement) => {
			if(!ALL_ELEMENTS.includes(element.tag)) { // not a custom component
				// custom component -- load from import cache
				const importCache = Termic.cache[element.tag]
				if(!importCache) {
					throw new Error(`Import ${element.tag} not found in cache`)
				}
				const parent = element.parent
				if(!parent) return
				const index = parent.children.indexOf(element)
				if(index === -1) return
				const fragment: TermElement = {
					tag: 'fragment',
					attributes: {},
					children: importCache.children.map((child) => {
						return {
							...child,
							parent: fragment
						}
					}),
					parent: parent,
					__props: element.attributes
				}
				parent.children.splice(index, 1, fragment)
				fragment.children.forEach((child) => {
					prerenderComponents(child)
				})
			} else {
				element.children.forEach((child) => {
					prerenderComponents(child)
				})
			}
		}

		// 1. import and prerender until no more imports or components

		// 2. loop expand all list until no more lists

		// 3. fill all basic elements
		

		const evaluateExpression = (expression: string) => {
			// if expression is a reference to a variable, return the value of the variable
			if(expression.startsWith("${")) {
				const variable = expression.slice(2, -1)
				if(variable in context) {
					return context[variable]
				} else {
					throw new Error(`Variable ${variable} not found in context`)
				}
				return expression
			}
			return expression
		}

		// render lists
		const getAllLists = (element: TermElement) => {
			if(element.children.length === 0) return []
			const lists = element.children.filter((child) => child.tag === 'list')
			element.children.forEach((item) => {
				lists.push(...getAllLists(item))
			})
			return lists
		}

		const expandList = (list: TermElement) => {
			const children_clone = list.children.map(c => ({ ...c }))
			// replace list element with the children
			const parent = list.parent
			if(!parent) return
			parent.children = parent.children.filter((child) => child !== list)
			if(!list.attributes.items) return
			const data = evaluateExpression(list.attributes.items)
			if (data && Array.isArray(data)) {
				parent.children.push(...data.flatMap((dataItem) => {
					return children_clone
				}))
			}
		}

		const fillBasicElements = (element: TermElement) => {
			element.children.forEach((child) => {
				if(ALL_BASIC_ELEMENTS.includes(child.tag) && !child.__filled) {
					child.attributes = Object.fromEntries(Object.entries(child.attributes).map(([key, value]) => [key, evaluateExpression(value)]))
					child.__filled = true
				}
			})
		}

		const getBasicElements = (element: TermElement) => {
			const els = element.children.filter((child) => ALL_BASIC_ELEMENTS.includes(child.tag) && !child.__filled)
			element.children.forEach((item) => {
				els.push(...getBasicElements(item))
			})
			return els
		}

		// let basicElements = getBasicElements(rootElement)
		// console.log("basicElements", basicElements)
		// const fillBasicElementsCycle = () => {
		// 	basicElements.forEach(fillBasicElements)
		// 	basicElements = getBasicElements(rootElement)
		// }

		// let lists = getAllLists(rootElement)
		// console.log("lists", lists)
		// const listCycle = () => {
		// 	if (lists.length === 0) return
		// 	lists.forEach(expandList)
		// 	lists = getAllLists(rootElement)
		// }

		// while(basicElements.length > 0 || lists.length > 0) {
		// 	fillBasicElementsCycle()
		// 	listCycle()
		// }


		// replace all components with a fragment block with copied props and loaded children from the import
		// const replaceComponents = (element: TermElement) => {
		// 	element.children.forEach((child) => {
		// 		if(child.tag === 'import') {
		// 			child.tag = 'fragment'
		// 		}
		// 	})
		// }


		function isValidXMLName(name: string): boolean {
			const nameRegex = /^[:A-Z_a-z][\w.\-:]*$/u;
			return nameRegex.test(name);
		}

		// convert all of it back into a ParsedTermFile
		function convertTermElementToXMLObj(element: TermElement): any {
			if (!isValidXMLName(element.tag)) {
				throw new Error(`Invalid XML tag name: ${element.tag}`);
			}
		
			const obj: any = {};
			const elementData: any = {};
		
			// Add attributes
			if (Object.keys(element.attributes).length > 0) {
				for (const [key, val] of Object.entries(element.attributes)) {
					if (!isValidXMLName(key)) {
						throw new Error(`Invalid XML attribute name: ${key}`);
					}
				}
				elementData.$ = element.attributes;
			}
		
			// Add text content
			if (element.textContent) {
				elementData._ = element.textContent;
			}
		
			// Recurse into children
			for (const child of element.children) {
				const childObj = convertTermElementToXMLObj(child);
				if (!elementData[child.tag]) {
					elementData[child.tag] = [];
				}
				elementData[child.tag].push(childObj[child.tag][0]);
			}
		
			obj[element.tag] = [elementData];
			return obj;
		}
		
		const reversedDocumentObj = convertTermElementToXMLObj(rootElement)
		// For the root element, we don't want it wrapped in an array
		const reversedDocument = {
			term: reversedDocumentObj.term[0]
		}

		// render xml
		const serializer = new Builder()
		const rendered = serializer.buildObject(reversedDocument)

		return rendered
	},
	map: (component: any, array: any) => {
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
	term: (componentTag: any, ...values: any[]) => {
		let res = "";

		let keys = Object.keys(values)

		if(keys.length == 0) return componentTag[0];
		
		for(let i = 0; i < keys.length; i++) {
			// @ts-expect-error
			res += componentTag[i] + values[keys[i]]
		}

		if(componentTag.length > 1) {
			res += componentTag[componentTag.length - 1]
		}

		return res;
	}
}

export default Termic;