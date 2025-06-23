import { Parser } from "xml2js"
import fs from "fs"
import path from "path";
import { buildXMLString } from "./xml";
import type { ElementTag, ParsedPikoFile, PikoElement, PikicCache } from "./types";
import Interpreter from "./lib/interpreter"

const ALL_BASIC_ELEMENTS = ["container", "input", "text", "link"]
// excludes processing elements like fragment. includes templating elements like list and if
const ALL_ELEMENTS = [...ALL_BASIC_ELEMENTS, "import", "list", "piko", "action", "br", "if"]

const Pikic = {
	cache: {} as PikicCache,
	local: async (filePath: string, context: any) => {
		// we need to add support for imports, list, templating with imported components
		const raw = fs.readFileSync(filePath, 'utf-8')

		// parse xml
		const parser = new Parser({
			explicitChildren: true,
			preserveChildrenOrder: true,
			childkey: 'children'
		})
		const file: ParsedPikoFile = await parser.parseStringPromise(raw)

		// traverse through the document
		const document = file.piko
		if(Array.isArray(document)) return "Error: Cannot have multiple <piko> tags in root of file"
		if(!document) return "Error: No <piko> found in root of file"

		// Helper function to recursively convert XML elements to PikoElement
		function convertXMLToPikoElement(xmlData: any, tag: ElementTag, parent?: PikoElement): PikoElement {
			const element: PikoElement = {
				tag,
				attributes: xmlData.$ || {},
				children: [],
				parent
			}

			// Handle text content
			if (xmlData._ && typeof xmlData._ === 'string') {
				element.textContent = xmlData._
			}

			// Process children in order (if using explicitChildren)
			if (xmlData.children && Array.isArray(xmlData.children)) {
				for (const child of xmlData.children) {
					if (child['#name'] && child['#name'] !== '$' && child['#name'] !== '_') {
						const childTag = child['#name'] as ElementTag
						const childElement = convertXMLToPikoElement(child, childTag, element)
						element.children.push(childElement)
					}
				}
			} else {
				// Fallback to old processing for backward compatibility
				for (const [childTag, childData] of Object.entries(xmlData)) {
					if (childTag === '$' || childTag === '_') continue // Skip attributes and text content

					if (Array.isArray(childData)) {
						// Handle arrays of elements
						for (const childItem of childData) {
							if (typeof childItem === 'string') {
								// Handle direct string content - but check if it's an empty string for self-closing tags
								if (childItem === '' && (childTag === 'br' || childTag === 'input')) {
									// This is a self-closing tag like <br/> or <input/>
									const selfClosingElement: PikoElement = {
										tag: childTag as ElementTag,
										attributes: {},
										children: [],
										parent: element
									}
									element.children.push(selfClosingElement)
								} else if (childItem.trim() !== '') {
									// Only create text elements for non-empty strings
									const textElement: PikoElement = {
										tag: 'text',
										attributes: {},
										children: [],
										parent: element,
										textContent: childItem
									}
									element.children.push(textElement)
								}
							} else {
								// Handle nested XML elements
								const childElement = convertXMLToPikoElement(childItem, childTag as ElementTag, element)
								element.children.push(childElement)
							}
						}
					} else if (typeof childData === 'object') {
						// Handle single nested element
						const childElement = convertXMLToPikoElement(childData, childTag as ElementTag, element)
						element.children.push(childElement)
					}
				}
			}

			return element
		}

		// Deep clone function for PikoElement
		function deepClonePikoElement(element: PikoElement, newParent?: PikoElement): PikoElement {
			const cloned: PikoElement = {
				tag: element.tag,
				attributes: { ...element.attributes },
				children: [],
				parent: newParent,
				textContent: element.textContent,
				__expanded: element.__expanded,
				__filled: element.__filled,
				__imported: element.__imported,
				__fromOrigin: element.__fromOrigin,
				__props: element.__props ? { ...element.__props } : undefined,
				__listItem: element.__listItem ? { ...element.__listItem } : undefined
			}

			// Deep clone children
			cloned.children = element.children.map(child => deepClonePikoElement(child, cloned))

			return cloned
		}

		// Convert the document to PikoElement and flatten all elements
		const rootElement = convertXMLToPikoElement(document, 'piko')

		// find all imports and load them into a local cache
		const getAllImports = (element: PikoElement) => {
			const imports = element.children.filter((child) => child.tag === 'import' && !child.__imported)
			element.children.forEach((item) => {
				imports.push(...getAllImports(item))
			})
			return imports
		}

		let imports = getAllImports(rootElement)
		const loadImports = async () => {
			for(const _import of imports) {
				const { key, from } = _import.attributes
				const { __fromOrigin } = _import
				if (!from || typeof from !== "string") continue
				if (!key || typeof key !== "string") continue
				const importPath = __fromOrigin ? path.resolve(path.dirname(__fromOrigin), from) : path.resolve(path.dirname(path.resolve(filePath)), from)
				const importRaw = fs.readFileSync(importPath, 'utf-8')
				const importDoc: ParsedPikoFile = await parser.parseStringPromise(importRaw)
				const loadedElement = convertXMLToPikoElement(importDoc, 'piko')
				let content = loadedElement.children?.[0]?.children || []
				const innerImports = getAllImports(loadedElement)
				innerImports.forEach((i) => {
					i.__fromOrigin = importPath
				})
				Pikic.cache[key] = content
				_import.__imported = true
			}
		}

		const getAllComponents = (element: PikoElement) => {
			const components = element.children.filter((child) => !ALL_ELEMENTS.includes(child.tag) && child.tag !== 'fragment')
			element.children.forEach((item) => {
				components.push(...getAllComponents(item))
			})
			return components
		}

		let components = getAllComponents(rootElement)
		const prerenderComponents = (element: PikoElement) => {
			if(!ALL_ELEMENTS.includes(element.tag) && element.tag !== 'fragment' && element.tag !== 'if') { // not a custom component
				// custom component -- load from import cache
				const importCache = Pikic.cache[element.tag]
				if(!importCache) {
					throw new Error(`Import ${element.tag} not found in cache`)
				}
				const parent = element.parent
				if(!parent) return
				const index = parent.children.indexOf(element)
				if(index === -1) return
				const fragment: PikoElement = {
					tag: 'fragment',
					attributes: {},
					children: importCache.map((c) => deepClonePikoElement(c)),
					__props: { ...element.attributes }
				}
				parent.children.splice(index, 1, fragment)
				fragment.children.forEach((child) => {
					child.parent = fragment
					// prerenderComponents(child) // can't prerender yet, could be bringing new imports
				})
			} else {
				element.children.forEach((child) => {
					prerenderComponents(child)
				})
			}
		}

		const evaluateExpression = (expression: string, fragment: PikoElement | null) => {
			// Handle interpolated strings with ${variable} patterns
			let result = expression
			if(result.includes('${')) {
				result = result.replace(/\$\{([^}]+)\}/g, (match, variable) => {

					if(variable.startsWith("@item.") && fragment) {
						const propName = variable.slice(6)
						if(fragment.__listItem && propName in fragment.__listItem) {
							return fragment.__listItem[propName]
						}
					}

					if(variable.startsWith("@props.") && fragment) {
						const propName = variable.slice(7)
						if(fragment.__props && propName in fragment.__props) {
							return fragment.__props[propName]
						}
					}

					if(variable.startsWith("@index") && fragment) {
						return fragment.__listIndex
					}

					if(variable in context) {
						return context[variable]
					} else {
						// console.warn(`Variable ${variable} not found in context`)
						return match // Return the original ${variable} if not found
					}
				})
			}

			if(result.includes('(')) {
				result = result.replace(/\(([^)]+)\)/g, (_match, inner) => {
					const interpreter = new Interpreter(inner)
					interpreter.run()
					return interpreter.value
				})
			}

			return result
		}

		// render lists
		const getAllLists = (element: PikoElement) => {
			if(element.children.length === 0) return []
			const lists = element.children.filter((child) => child.tag === 'list')
			element.children.forEach((item) => {
				lists.push(...getAllLists(item))
			})
			return lists
		}

		let lists = getAllLists(rootElement)
		const expandList = (list: PikoElement) => {
			const parent = list.parent
			if(!parent) return
			
			const listIndex = parent.children.indexOf(list)
			if(listIndex === -1) return
			
			// Get the items to iterate over
			const data = list.attributes.items ? context[list.attributes.items] : []
			
			if (data && Array.isArray(data) && data.length > 0) {
				// Create expanded children for each data item
				const expandedChildren = data.flatMap((listItem, i) => {
					return list.children.map(child => {
						const clonedChild = deepClonePikoElement(child)
						clonedChild.__listItem = { ...listItem }
						clonedChild.__listIndex = i
						return clonedChild
					})
				})
				
				// Replace the list element with expanded children
				parent.children.splice(listIndex, 1, ...expandedChildren)
				
				// Set proper parent references
				expandedChildren.forEach(child => {
					child.parent = parent
				})
			} else {
				// If no data or empty array, just remove the list element
				parent.children.splice(listIndex, 1)
			}
		}

		// 1. import and prerender until no more imports or components
		let safetyBreaker = 0
		while(imports.length > 0 || components.length > 0) {
			if(safetyBreaker > 100) {
				console.error("Safety breaker reached")
				// console.log({ imports, components })
				throw new Error("Safety breaker reached")
			}
			safetyBreaker++
			await loadImports()
			prerenderComponents(rootElement)
			imports = getAllImports(rootElement)
			components = getAllComponents(rootElement)
			// console.log({ imports, components })
		}

		// 2. loop expand all list until no more lists
		safetyBreaker = 0
		while(lists.length > 0) {
			if(safetyBreaker > 100) {
				console.error("Safety breaker reached")
				// console.log({ lists })
				throw new Error("Safety breaker reached")
			}
			safetyBreaker++
			lists = getAllLists(rootElement)
			lists.forEach(expandList)
		}

		// 3. fill all basic elements
		const fillAllElements = (element: PikoElement) => {
			// Fill attributes for basic elements
			if (ALL_BASIC_ELEMENTS.includes(element.tag)) {
				element.attributes = Object.fromEntries(
					Object.entries(element.attributes).map(([key, value]) => [key, evaluateExpression(value, element)])
				)
			}
			
			// Fill text content for all elements (including text elements)
			if (element.textContent && element.textContent.includes('${')) {
				element.textContent = evaluateExpression(element.textContent, element)
			}
			
			// Recursively process children
			element.children.forEach(child => {
				fillAllElements(child)
			})
		}
		fillAllElements(rootElement)

		// 4. fill all props and list items
		const fillProps = (element: PikoElement, currentFragment: PikoElement | null) => {
			if(element.tag === "fragment") {
				if(element.__listItem && element.__props) {
					element.__props = Object.fromEntries(
						Object.entries(element.__props).map(([key, value]) => [key, evaluateExpression(value, element)])
					)
				}
			}

			if(currentFragment) {
				element.attributes = Object.fromEntries(
					Object.entries(element.attributes).map(([key, value]) => [key, evaluateExpression(value, currentFragment)])
				)
				if(element.textContent) {
					element.textContent = evaluateExpression(element.textContent, currentFragment)
				}
				if(element.tag === "fragment" && element.__props) {
					element.__props = Object.fromEntries(
						Object.entries(element.__props).map(([key, value]) => [key, evaluateExpression(value, currentFragment)])
					)
				}
			}

			if(element.tag === "fragment") {
				currentFragment = element
			}

			element.children.forEach((child) => fillProps(child, currentFragment))
		}
		fillProps(rootElement, null)

		// 5. handle conditionals
		const handleConditionals = (element: PikoElement) => {
			if(element.tag === "if" && element.attributes.condition) {
				let condition = evaluateExpression(element.attributes.condition, element)
				const interpreter = new Interpreter(`Boolean(${condition})`)
				interpreter.run()
				condition = interpreter.value

				if(condition) {
					element.tag = "fragment"
					element.attributes = {}
				} else {
					const parent = element.parent
					if(parent) {
						parent.children = parent.children.filter((child) => child !== element)
					}
				}
			}

			element.children.forEach((child) => handleConditionals(child))
		}
		handleConditionals(rootElement)

		// Build the XML declaration and root element
		const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
		const xmlBody = buildXMLString(rootElement)
		const rendered = xmlDeclaration + xmlBody

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
	piko: (componentTag: any, ...values: any[]) => {
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

export default Pikic;