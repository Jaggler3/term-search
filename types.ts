export type ElementTag = "fragment" | "import" | "list" | "piko" | "action" | "container" | "input" | "text" | "link" | "br" | "list" | "if"

export interface ParsedPikoFile {
	piko?: {
		$: any;
		[key: string]: (XMLElement | string)[];
	} | XMLElement[]
}

export interface XMLElement {
	$?: any;
	[key: string]: (XMLElement | string)[];
}

export interface PikoElement {
	tag: ElementTag;
	attributes: {
		[key: string]: string;
	};
	__props?: {
		[key: string]: string;
	};
	__listItem?: any;
	children: PikoElement[];
	parent?: PikoElement;
	textContent?: string;
	__expanded?: boolean;
	__filled?: boolean;
	__imported?: boolean;
	__fromOrigin?: string;
	__listIndex?: number;
}

export interface PikicCache {
	[key: string]: PikoElement[]
} 