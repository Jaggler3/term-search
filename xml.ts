import type { TermElement } from "./types";

// Directly build XML string while preserving order
export function buildXMLString(element: TermElement, indent: string = ""): string {
	const { tag, attributes, textContent, children } = element
	
	// Skip fragments - just process their children
	if (tag === 'fragment') {
		return children.map(child => buildXMLString(child, indent)).join('')
	}
	
	// Skip imports in output
	if (tag === 'import') {
		return ''
	}
	
	let result = `${indent}<${tag}`
	
	// Add attributes
	for (const [key, value] of Object.entries(attributes)) {
		result += ` ${key}="${value.replace(/"/g, '&quot;')}"`
	}
	
	// Self-closing tag if no children and no text content
	if (children.length === 0 && !textContent) {
		result += `/>`
		return result
	}
	
	result += `>`
	
	// Add text content if present (no children case)
	if (textContent && children.length === 0) {
		result += textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	}
	
	// Handle children
	if (children.length > 0) {
		// Determine if we need multiline formatting
		const hasNonTextChildren = children.some(child => child.tag !== 'text' || child.children.length > 0)
		const shouldUseNewlines = hasNonTextChildren && children.length > 1
		
		if (shouldUseNewlines) {
			result += '\n'
		}
		
		// Process each child
		for (let i = 0; i < children.length; i++) {
			const child = children[i]
			if (!child) continue // Skip undefined children
			
			const childIndent = shouldUseNewlines ? indent + '  ' : ''
			
			if (child.tag === 'text' && child.textContent && child.children.length === 0) {
				// Handle text elements specially
				if (shouldUseNewlines) {
					result += `${childIndent}<text`
					for (const [key, value] of Object.entries(child.attributes)) {
						result += ` ${key}="${value.replace(/"/g, '&quot;')}"`
					}
					result += `>${child.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`
					if (i < children.length - 1) result += '\n'
				} else {
					result += buildXMLString(child, childIndent)
				}
			} else {
				// Handle non-text elements
				result += buildXMLString(child, childIndent)
				if (shouldUseNewlines && i < children.length - 1) {
					result += '\n'
				}
			}
		}
		
		if (shouldUseNewlines) {
			result += '\n' + indent
		}
	}
	
	result += `</${tag}>`
	return result
} 