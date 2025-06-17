export type ElementTag = "fragment" | "import" | "list" | "term" | "action" | "container" | "input" | "text" | "link" | "br" | "list" | "if"

export interface ParsedTermFile {
	term?: {
		$: any;
		[key: string]: (XMLElement | string)[];
	} | XMLElement[]
}

export interface XMLElement {
	$?: any;
	[key: string]: (XMLElement | string)[];
}

export interface TermElement {
	tag: ElementTag;
	attributes: {
		[key: string]: string;
	};
	__props?: {
		[key: string]: string;
	};
	__listItem?: any;
	children: TermElement[];
	parent?: TermElement;
	textContent?: string;
	__expanded?: boolean;
	__filled?: boolean;
	__imported?: boolean;
	__fromOrigin?: string;
	__listIndex?: number;
}

export interface TermicCache {
	[key: string]: TermElement[]
} 