/**
 * @license
 * Copyright 2012 Marijn Haverbeke
 * SPDX-License-Identifier: MIT
 */

// Acorn is a tiny, fast JavaScript parser written in JavaScript.
//
// Acorn was written by Marijn Haverbeke and released under an MIT
// license. The Unicode regexps (for identifiers and whitespace) were
// taken from [Esprima](http://esprima.org) by Ariya Hidayat.
//
// Git repositories for Acorn are available at
//
//     http://marijnhaverbeke.nl/git/acorn
//     https://github.com/marijnh/acorn.git
//
// Please use the [github bug tracker][ghbt] to report issues.
//
// [ghbt]: https://github.com/marijnh/acorn/issues
//
// This file defines the main parser interface. The library also comes
// with a [error-tolerant parser][dammit] and an
// [abstract syntax tree walker][walk], defined in other files.
//
// [dammit]: acorn_loose.js
// [walk]: util/walk.js

(function(root, mod) {
  if (typeof exports === "object" && typeof module === "object") return mod(exports); // CommonJS
  if (typeof define === "function" && define.amd) return define(["exports"], mod); // AMD
  mod(root.acorn || (root.acorn = {})); // Plain browser env
})((typeof globalThis === 'undefined') ? this || window : globalThis, function(exports) {
  "use strict";

  exports.version = "0.5.0";
  // Plus additional edits marked with 'JS-Interpreter change' comments.

  // JS-Interpreter change:
  // For global object, use 'globalThis' if it exists,
  // fall back to 'this' or 'window'.  Same logic as in JS-Interpreter.
  // -- Neil Fraser, March 2024.

  // JS-Interpreter change:
  // Added JSDoc type definitions.
  // -- Neil Fraser, July 2023.

  // JS-Interpreter change:
  // No longer exporting defaultOptions, getLineInfo, tokenize, tokTypes,
  // isIdentifierStart, and isIdentifierChar.  Not used by JS-Interpreter.
  // -- Neil Fraser, February 2023.

  // The main exported interface (under `self.acorn` when in the
  // browser) is a `parse` function that takes a code string and
  // returns an abstract syntax tree as specified by [Mozilla parser
  // API][api], with the caveat that the SpiderMonkey-specific syntax
  // (`let`, `yield`, inline XML, etc) is not recognized.
  //
  // [api]: https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API

  /** @type {!Object|undefined} */
  var options;

  /** @type {string} */
  var input = '';
  /** @type {number|undefined} */
  var inputLen;
  /** @type {*} */
  var sourceFile;

  /**
   * @param {string} inpt
   * @param {Object=} opts
   * @returns
   */
  exports.parse = function(inpt, opts) {
    input = String(inpt);
    inputLen = input.length;
    setOptions(opts);
    initTokenState();
    return parseTopLevel(options.program);
  };

  // A second optional argument can be given to further configure
  // the parser process. These options are recognized:

  var defaultOptions = {
    // JS-Interpreter change:
    // `ecmaVersion` option has been removed along with all cases where
    // it is checked.  In this version of Acorn it was limited to 3 or 5,
    // and there's no use case for 3 with JS-Interpreter.
    // -- Neil Fraser, December 2022.

    // Turn on `strictSemicolons` to prevent the parser from doing
    // automatic semicolon insertion.
    strictSemicolons: false,
    // When `allowTrailingCommas` is false, the parser will not allow
    // trailing commas in array and object literals.
    allowTrailingCommas: true,
    // By default, reserved words are not enforced. Enable
    // `forbidReserved` to enforce them. When this option has the
    // value "everywhere", reserved words and keywords can also not be
    // used as property names.
    forbidReserved: false,
    // When enabled, a return at the top level is not considered an
    // error.
    allowReturnOutsideFunction: false,
    // When `locations` is on, `loc` properties holding objects with
    // `start` and `end` properties in `{line, column}` form (with
    // line being 1-based and column 0-based) will be attached to the
    // nodes.
    locations: false,
    // A function can be passed as `onComment` option, which will
    // cause Acorn to call that function with `(block, text, start,
    // end)` parameters whenever a comment is skipped. `block` is a
    // boolean indicating whether this is a block (`/* */`) comment,
    // `text` is the content of the comment, and `start` and `end` are
    // character offsets that denote the start and end of the comment.
    // When the `locations` option is on, two more parameters are
    // passed, the full `{line, column}` locations of the start and
    // end of the comments. Note that you are not allowed to call the
    // parser from the callback—that will corrupt its internal state.
    onComment: null,
    // Nodes have their start and end characters offsets recorded in
    // `start` and `end` properties (directly on the node, rather than
    // the `loc` object, which holds line/column data. To also add a
    // [semi-standardized][range] `range` property holding a `[start,
    // end]` array with the same numbers, set the `ranges` option to
    // `true`.
    //
    // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
    ranges: false,
    // It is possible to parse multiple files into a single AST by
    // passing the tree produced by parsing the first file as
    // `program` option in subsequent parses. This will add the
    // toplevel forms of the parsed file to the `Program` (top) node
    // of an existing parse tree.
    program: null,
    // When `locations` is on, you can pass this to record the source
    // file in every node's `loc` object.
    sourceFile: null,
    // This value, if given, is stored in every node, whether
    // `locations` is on or off.
    directSourceFile: null,
  };

  /**
   * @param {Object|undefined} opts
   */
  function setOptions(opts) {
    options = opts || {};
    for (var opt in defaultOptions) {
      if (!Object.prototype.hasOwnProperty.call(options, opt)) {
        options[opt] = defaultOptions[opt];
      }
    }
    sourceFile = options.sourceFile;
  }

  /**
   * The `getLineInfo` function is mostly useful when the
   * `locations` option is off (for performance reasons) and you
   * want to find the line/column position for a given character
   * offset. `input` should be the code string that the offset refers
   * into.
   *
   * @param {string} input
   * @param {number} offset
   * @returns {!Object}
   */
  var getLineInfo = function(input, offset) {
    for (var line = 1, cur = 0;;) {
      lineBreak.lastIndex = cur;
      var match = lineBreak.exec(input);
      if (match && match.index < offset) {
        ++line;
        cur = match.index + match[0].length;
      } else {
        break;
      }
    }
    return {line: line, column: offset - cur};
  };

  // JS-Interpreter change:
  // tokenize function never used.  Removed.
  // -- Neil Fraser, February 2023.

  // State is kept in (closure-)global variables. We already saw the
  // `options`, `input`, and `inputLen` variables above.

  /**
   * The current position of the tokenizer in the input.
   * @type {number}
   */
  var tokPos = 0;

  /**
   * The start offset of the current token.
   * @type {number}
   */
  var tokStart = 0;

  /**
   * The end offset of the current token.
   * @type {number}
   */
  var tokEnd = 0;

  /**
   * When `options.locations` is true, holds object
   * containing the token's start line/column pairs.
   * @type {!line_loc_t|undefined}
   */
  var tokStartLoc;

  /**
   * When `options.locations` is true, holds object
   * containing the token's end line/column pairs.
   * @type {!line_loc_t|undefined}
   */
  var tokEndLoc;

  /**
   * The type of the current token. Token types are objects,
   * named by variables against which they can be compared, and
   * holding properties that describe them (indicating, for example,
   * the precedence of an infix operator, and the original name of a
   * keyword token).
   * @type {!Object|undefined}
   */
  var tokType;

  /**
   * The value of the current token. The kind of value that's held in
   * `tokVal` depends on the type of the token. For literals, it is the
   * literal value, for operators, the operator name, and so on.
   * @type {*}
   */
  var tokVal;

  /**
   * Interal state for the tokenizer. To distinguish between division
   * operators and regular expressions, it remembers whether the last
   * token was one that is allowed to be followed by an expression.
   * (If it is, a slash is probably a regexp, if it isn't it's a
   * division operator. See the `parseStatement` function for a caveat.)
   * @type {boolean|undefined}
   */
  var tokRegexpAllowed;

  /**
   * When `options.locations` is true, `tokCurLine` is used to keep
   * track of the current line.
   * @type {number|undefined}
   */
  var tokCurLine;

  /**
   * When `options.locations` is true, `tokLineStart` is used to know
   * when a new line has been entered.
   * @type {number|undefined}
   */
  var tokLineStart;

  /**
   * The start of the position of the previous token, which is useful
   * when finishing a node and assigning its `end` position.
   * @type {number}
   */
  var lastStart = 0;

  /**
   * The end oy the position of the previous token, which is useful
   * when finishing a node and assigning its `end` position.
   * @type {number}
   */
  var lastEnd = 0;

  /**
   * Stores the position of the previous token, which is useful
   * when finishing a node and assigning its `end` position.
   * @type {!line_loc_t|undefined}
   */
  var lastEndLoc;

  /**
   * `inFunction` is used to reject `return` statements outside of functions.
   * @type {boolean|undefined}
   */
  var inFunction;

  /**
   * `labels` is used to verify that `break` and `continue` have somewhere
   * to jump to.
   * @type {!Array<!Object>|undefined}
   */
  var labels;

  /**
   * `strict` indicates whether strict mode is on.
   * @type {boolean|undefined}
   */
  var strict;

  /**
   * This function is used to raise exceptions on parse errors. It
   * takes an offset integer (into the current `input`) to indicate
   * the location of the error, attaches the position to the end
   * of the error message, and then raises a `SyntaxError` with that
   * message.
   *
   * @param {number} pos
   * @param {string} message
   * @throws {SyntaxError}
   */
  function raise(pos, message) {
    var loc = getLineInfo(input, pos);
    message += " (" + loc.line + ":" + loc.column + ")";
    var err = new SyntaxError(message);
    err.pos = pos;
    err.loc = loc;
    err.raisedAt = tokPos;
    throw err;
  }

  // Reused empty array added for node fields that are always empty.

  var empty = [];

  // ## Token types

  // The assignment of fine-grained, information-carrying type objects
  // allows the tokenizer to store the information it has about a
  // token in a way that is very cheap for the parser to look up.

  // All token type variables start with an underscore, to make them
  // easy to recognize.

  // These are the general types. The `type` property is only used to
  // make them recognizeable when debugging.

  var _num = {type: "num"};
  var _regexp = {type: "regexp"};
  var _string = {type: "string"};
  var _name = {type: "name"};
  var _eof = {type: "eof"};

  // Keyword tokens. The `keyword` property (also used in keyword-like
  // operators) indicates that the token originated from an
  // identifier-like word, which is used when parsing property names.
  //
  // The `beforeExpr` property is used to disambiguate between regular
  // expressions and divisions. It is set on all token types that can
  // be followed by an expression (thus, a slash after them would be a
  // regular expression).
  //
  // `isLoop` marks a keyword as starting a loop, which is important
  // to know when parsing a label, in order to allow or disallow
  // continue jumps to that label.

  var _break = {keyword: "break"};
  var _case = {keyword: "case", beforeExpr: true};
  var _catch = {keyword: "catch"};
  var _continue = {keyword: "continue"};
  var _debugger = {keyword: "debugger"};
  var _default = {keyword: "default"};
  var _do = {keyword: "do", isLoop: true};
  var _else = {keyword: "else", beforeExpr: true};
  var _finally = {keyword: "finally"};
  var _for = {keyword: "for", isLoop: true};
  var _function = {keyword: "function"};
  var _if = {keyword: "if"};
  var _return = {keyword: "return", beforeExpr: true};
  var _switch = {keyword: "switch"};
  var _throw = {keyword: "throw", beforeExpr: true};
  var _try = {keyword: "try"};
  var _var = {keyword: "var"};
  var _while = {keyword: "while", isLoop: true};
  var _with = {keyword: "with"};
  var _new = {keyword: "new", beforeExpr: true};
  var _this = {keyword: "this"};

  // The keywords that denote values.

  var _null = {keyword: "null", atomValue: null};
  var _true = {keyword: "true", atomValue: true};
  var _false = {keyword: "false", atomValue: false};

  // Some keywords are treated as regular operators. `in` sometimes
  // (when parsing `for`) needs to be tested against specifically, so
  // we assign a variable name to it for quick comparing.

  var _in = {keyword: "in", binop: 7, beforeExpr: true};

  // Map keyword names to token types.

  var keywordTypes = {
    "break": _break,
    "case": _case,
    "catch": _catch,
    "continue": _continue,
    "debugger": _debugger,
    "default": _default,
    "do": _do,
    "else": _else,
    "finally": _finally,
    "for": _for,
    "function": _function,
    "if": _if,
    "return": _return,
    "switch": _switch,
    "throw": _throw,
    "try": _try,
    "var": _var,
    "while": _while,
    "with": _with,
    "null": _null,
    "true": _true,
    "false": _false,
    "new": _new,
    "in": _in,
    "instanceof": {keyword: "instanceof", binop: 7, beforeExpr: true},
    "this": _this,
    "typeof": {keyword: "typeof", prefix: true, beforeExpr: true},
    "void": {keyword: "void", prefix: true, beforeExpr: true},
    "delete": {keyword: "delete", prefix: true, beforeExpr: true},
  };

  // Punctuation token types. Again, the `type` property is purely for debugging.

  var _bracketL = {type: "[", beforeExpr: true};
  var _bracketR = {type: "]"};
  var _braceL = {type: "{", beforeExpr: true};
  var _braceR = {type: "}"};
  var _parenL = {type: "(", beforeExpr: true};
  var _parenR = {type: ")"};
  var _comma = {type: ",", beforeExpr: true};
  var _semi = {type: ";", beforeExpr: true};
  var _colon = {type: ":", beforeExpr: true};
  var _dot = {type: "."};
  var _question = {type: "?", beforeExpr: true};

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator. `isUpdate` specifies that the node produced by
  // the operator should be of type UpdateExpression rather than
  // simply UnaryExpression (`++` and `--`).
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  var _slash = {binop: 10, beforeExpr: true};
  var _eq = {isAssign: true, beforeExpr: true};
  var _assign = {isAssign: true, beforeExpr: true};
  var _incDec = {postfix: true, prefix: true, isUpdate: true};
  var _prefix = {prefix: true, beforeExpr: true};
  var _logicalOR = {binop: 1, beforeExpr: true};
  var _logicalAND = {binop: 2, beforeExpr: true};
  var _bitwiseOR = {binop: 3, beforeExpr: true};
  var _bitwiseXOR = {binop: 4, beforeExpr: true};
  var _bitwiseAND = {binop: 5, beforeExpr: true};
  var _equality = {binop: 6, beforeExpr: true};
  var _relational = {binop: 7, beforeExpr: true};
  var _bitShift = {binop: 8, beforeExpr: true};
  var _plusMin = {binop: 9, prefix: true, beforeExpr: true};
  var _multiplyModulo = {binop: 10, beforeExpr: true};

  // JS-Interpreter change:
  // tokTypes map never used.  Removed.
  // -- Neil Fraser, February 2023.

  // JS-Interpreter change:
  // Acorn's original code built up functions using strings for maximum efficiency.
  // However, this triggered a CSP unsafe-eval requirement.  Here's a slower, but
  // simpler approach.  -- Neil Fraser, January 2022.
  // https://github.com/NeilFraser/JS-Interpreter/issues/228

  /**
   * @param {string} words
   * @returns {function(*): boolean}
   */
  function makePredicate(words) {
    var wordList = words.split(" ");
    var set = Object.create(null);
    for (var i = 0; i < wordList.length; i++) {
      set[wordList[i]] = true;
    }
    return function(str) {
      return set[str] || false;
    };
  }

  // ECMAScript 5 reserved words.

  var isReservedWord5 = makePredicate("class enum extends super const export import");

  // The additional reserved words in strict mode.

  var isStrictReservedWord = makePredicate("implements interface let package private protected public static yield");

  // The forbidden variable names in strict mode.

  var isStrictBadIdWord = makePredicate("eval arguments");

  // And the keywords.

  var isKeyword = makePredicate("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this");

  // ## Character categories

  // Big ugly regular expressions that match characters in the
  // whitespace, identifier, and identifier-start categories. These
  // are only applied when a character is found to actually have a
  // code point above 128.

  var nonASCIIwhitespace = /[\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\ufeff]/;
  var nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0\u08a2-\u08ac\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097f\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d\u0c58\u0c59\u0c60\u0c61\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d60\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191c\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19c1-\u19c7\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua697\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa80-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
  var nonASCIIidentifierChars = "\u0300-\u036f\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u0620-\u0649\u0672-\u06d3\u06e7-\u06e8\u06fb-\u06fc\u0730-\u074a\u0800-\u0814\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0840-\u0857\u08e4-\u08fe\u0900-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962-\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09d7\u09df-\u09e0\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2-\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b5f-\u0b60\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c01-\u0c03\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62-\u0c63\u0c66-\u0c6f\u0c82\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2-\u0ce3\u0ce6-\u0cef\u0d02\u0d03\u0d46-\u0d48\u0d57\u0d62-\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e34-\u0e3a\u0e40-\u0e45\u0e50-\u0e59\u0eb4-\u0eb9\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f41-\u0f47\u0f71-\u0f84\u0f86-\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u1029\u1040-\u1049\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u170e-\u1710\u1720-\u1730\u1740-\u1750\u1772\u1773\u1780-\u17b2\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u1920-\u192b\u1930-\u193b\u1951-\u196d\u19b0-\u19c0\u19c8-\u19c9\u19d0-\u19d9\u1a00-\u1a15\u1a20-\u1a53\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1b46-\u1b4b\u1b50-\u1b59\u1b6b-\u1b73\u1bb0-\u1bb9\u1be6-\u1bf3\u1c00-\u1c22\u1c40-\u1c49\u1c5b-\u1c7d\u1cd0-\u1cd2\u1d00-\u1dbe\u1e01-\u1f15\u200c\u200d\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2d81-\u2d96\u2de0-\u2dff\u3021-\u3028\u3099\u309a\ua640-\ua66d\ua674-\ua67d\ua69f\ua6f0-\ua6f1\ua7f8-\ua800\ua806\ua80b\ua823-\ua827\ua880-\ua881\ua8b4-\ua8c4\ua8d0-\ua8d9\ua8f3-\ua8f7\ua900-\ua909\ua926-\ua92d\ua930-\ua945\ua980-\ua983\ua9b3-\ua9c0\uaa00-\uaa27\uaa40-\uaa41\uaa4c-\uaa4d\uaa50-\uaa59\uaa7b\uaae0-\uaae9\uaaf2-\uaaf3\uabc0-\uabe1\uabec\uabed\uabf0-\uabf9\ufb20-\ufb28\ufe00-\ufe0f\ufe20-\ufe26\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";
  var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
  var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

  // Whether a single character denotes a newline.

  var newline = /[\n\r\u2028\u2029]/;

  // Matches a whole line break (where CRLF is considered a single
  // line break). Used to count lines.

  var lineBreak = /\r\n|[\n\r\u2028\u2029]/g;

  /**
   * Test whether a given character code starts an identifier.
   *
   * @param {number} code
   * @returns {boolean}
   */
  var isIdentifierStart = function(code) {
    if (code < 65) return code === 36;
    if (code < 91) return true;
    if (code < 97) return code === 95;
    if (code < 123) return true;
    return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
  };

  /**
   * Test whether a given character is part of an identifier.
   *
   * @param {number} code
   * @returns {boolean}
   */
  var isIdentifierChar = function(code) {
    if (code < 48) return code === 36;
    if (code < 58) return true;
    if (code < 65) return false;
    if (code < 91) return true;
    if (code < 97) return code === 95;
    if (code < 123) return true;
    return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
  };

  // ## Tokenizer

  /**
   * These are used when `options.locations` is on, for the
   * `tokStartLoc` and `tokEndLoc` properties.
   * @constructor
   */
  function line_loc_t() {
    this.line = tokCurLine;
    this.column = tokPos - tokLineStart;
  }

  /**
   * Reset the token state. Used at the start of a parse.
   */
  function initTokenState() {
    tokCurLine = 1;
    tokPos = tokLineStart = 0;
    tokRegexpAllowed = true;
    skipSpace();
  }

  /**
   * Called at the end of every token. Sets `tokEnd`, `tokVal`, and
   * `tokRegexpAllowed`, and skips the space after the token, so that
   * the next one's `tokStart` will point at the right position.
   *
   * @param {!Object} type
   * @param {*=} val
   */
  function finishToken(type, val) {
    tokEnd = tokPos;
    if (options.locations) {
      tokEndLoc = new line_loc_t();
    }
    tokType = type;
    skipSpace();
    tokVal = val;
    tokRegexpAllowed = type.beforeExpr;
  }

  function skipBlockComment() {
    var startLoc = options.onComment && options.locations && new line_loc_t();
    var start = tokPos;
    var end = input.indexOf("*/", tokPos += 2);
    if (end === -1) {
      raise(tokPos - 2, "Unterminated comment");
    }
    tokPos = end + 2;
    if (options.locations) {
      lineBreak.lastIndex = start;
      var match;
      while ((match = lineBreak.exec(input)) && match.index < tokPos) {
        ++tokCurLine;
        tokLineStart = match.index + match[0].length;
      }
    }
    if (options.onComment) {
      options.onComment(true, input.slice(start + 2, end), start, tokPos,
                        startLoc, options.locations && new line_loc_t());
    }
  }

  function skipLineComment() {
    var start = tokPos;
    var startLoc = options.onComment && options.locations && new line_loc_t();
    var ch = input.charCodeAt(tokPos += 2);
    while (tokPos < inputLen && ch !== 10 && ch !== 13 && ch !== 8232 && ch !== 8233) {
      ++tokPos;
      ch = input.charCodeAt(tokPos);
    }
    if (options.onComment) {
      options.onComment(false, input.slice(start + 2, tokPos), start, tokPos,
                        startLoc, options.locations && new line_loc_t());
    }
  }

  // Called at the start of the parse and after every token. Skips
  // whitespace and comments, and.

  function skipSpace() {
    while (tokPos < inputLen) {
      var ch = input.charCodeAt(tokPos);
      if (ch === 32) { // ' '
        ++tokPos;
      } else if (ch === 13) {
        ++tokPos;
        var next = input.charCodeAt(tokPos);
        if (next === 10) {
          ++tokPos;
        }
        if (options.locations) {
          ++tokCurLine;
          tokLineStart = tokPos;
        }
      } else if (ch === 10 || ch === 8232 || ch === 8233) {
        ++tokPos;
        if (options.locations) {
          ++tokCurLine;
          tokLineStart = tokPos;
        }
      } else if (ch > 8 && ch < 14) {
        ++tokPos;
      } else if (ch === 47) { // '/'
        var next = input.charCodeAt(tokPos + 1);
        if (next === 42) { // '*'
          skipBlockComment();
        } else if (next === 47) { // '/'
          skipLineComment();
        } else break;
      } else if (ch === 160) { // '\xa0'
        ++tokPos;
      } else if (ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
        ++tokPos;
      } else {
        break;
      }
    }
  }

  // ### Token reading

  // This is the function that is called to fetch the next token. It
  // is somewhat obscure, because it works in character codes rather
  // than characters, and because operator parsing has been inlined
  // into it.
  //
  // All in the name of speed.
  //
  // The `forceRegexp` parameter is used in the one case where the
  // `tokRegexpAllowed` trick does not work. See `parseStatement`.

  function readToken_dot() {
    var next = input.charCodeAt(tokPos + 1);
    if (next >= 48 && next <= 57) {
      readNumber(true);
    } else {
      ++tokPos;
      finishToken(_dot);
    }
  }

  function readToken_slash() {  // '/'
    var next = input.charCodeAt(tokPos + 1);
    if (tokRegexpAllowed) {
      ++tokPos;
      readRegexp();
    } else if (next === 61) {
      finishOp(_assign, 2);
    } else {
      finishOp(_slash, 1);
    }
  }

  function readToken_mult_modulo() {  // '%*'
    var next = input.charCodeAt(tokPos + 1);
    if (next === 61) {
      finishOp(_assign, 2);
    } else {
      finishOp(_multiplyModulo, 1);
    }
  }

  /**
   * @param {number} code
   */
  function readToken_pipe_amp(code) {  // '|&'
    var next = input.charCodeAt(tokPos + 1);
    if (next === code) {
      finishOp(code === 124 ? _logicalOR : _logicalAND, 2);
    } else if (next === 61) {
      finishOp(_assign, 2);
    } else {
      finishOp(code === 124 ? _bitwiseOR : _bitwiseAND, 1);
    }
  }

  function readToken_caret() {  // '^'
    var next = input.charCodeAt(tokPos + 1);
    if (next === 61) {
      finishOp(_assign, 2);
    } else {
      finishOp(_bitwiseXOR, 1);
    }
  }

  /**
   * @param {number} code
   */
  function readToken_plus_min(code) {  // '+-'
    var next = input.charCodeAt(tokPos + 1);
    if (next === code) {
      if (next === 45 && input.charCodeAt(tokPos + 2) === 62 &&
          newline.test(input.slice(lastEnd, tokPos))) {
        // A `-->` line comment
        tokPos += 3;
        skipLineComment();
        skipSpace();
        readToken();
        return;
      }
      finishOp(_incDec, 2);
    } else if (next === 61) {
      finishOp(_assign, 2);
    } else {
      finishOp(_plusMin, 1);
    }
  }

  /**
   * @param {number} code
   */
  function readToken_lt_gt(code) {  // '<>'
    var next = input.charCodeAt(tokPos + 1);
    var size = 1;
    if (next === code) {
      size = (code === 62 && input.charCodeAt(tokPos + 2) === 62) ? 3 : 2;
      if (input.charCodeAt(tokPos + size) === 61) {
        finishOp(_assign, size + 1);
      } else {
        finishOp(_bitShift, size);
      }
      return;
    }
    if (next === 33 && code === 60 && input.charCodeAt(tokPos + 2) === 45 &&
        input.charCodeAt(tokPos + 3) === 45) {
      // `<!--`, an XML-style comment that should be interpreted as a line comment
      tokPos += 4;
      skipLineComment();
      skipSpace();
      readToken();
      return;
    }
    if (next === 61) {
      size = input.charCodeAt(tokPos + 2) === 61 ? 3 : 2;
    }
    finishOp(_relational, size);
  }

  /**
   * @param {number} code
   */
  function readToken_eq_excl(code) {  // '=!'
    var next = input.charCodeAt(tokPos + 1);
    if (next === 61) {
      finishOp(_equality, input.charCodeAt(tokPos + 2) === 61 ? 3 : 2);
    } else {
      finishOp(code === 61 ? _eq : _prefix, 1);
    }
  }

  /**
   * @param {number} code
   * @returns {boolean|undefined}
   */
  function getTokenFromCode(code) {
    switch(code) {
      // The interpretation of a dot depends on whether it is followed
      // by a digit.
      case 46: // '.'
        return readToken_dot();

        // Punctuation tokens.
      case 40:  ++tokPos; return finishToken(_parenL);
      case 41:  ++tokPos; return finishToken(_parenR);
      case 59:  ++tokPos; return finishToken(_semi);
      case 44:  ++tokPos; return finishToken(_comma);
      case 91:  ++tokPos; return finishToken(_bracketL);
      case 93:  ++tokPos; return finishToken(_bracketR);
      case 123: ++tokPos; return finishToken(_braceL);
      case 125: ++tokPos; return finishToken(_braceR);
      case 58:  ++tokPos; return finishToken(_colon);
      case 63:  ++tokPos; return finishToken(_question);

        // '0x' is a hexadecimal number.
      case 48: // '0'
        var next = input.charCodeAt(tokPos + 1);
        if (next === 120 || next === 88) return readHexNumber();
        // Anything else beginning with a digit is an integer, octal
        // number, or float.
      case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
        return readNumber(false);

        // Quotes produce strings.
      case 34: case 39: // '"', "'"
        return readString(code);

      // Operators are parsed inline in tiny state machines. '=' (61) is
      // often referred to. `finishOp` simply skips the amount of
      // characters it is given as second argument, and returns a token
      // of the type given by its first argument.

      case 47: // '/'
        return readToken_slash();

      case 37: case 42: // '%*'
        return readToken_mult_modulo();

      case 124: case 38: // '|&'
        return readToken_pipe_amp(code);

      case 94: // '^'
        return readToken_caret();

      case 43: case 45: // '+-'
        return readToken_plus_min(code);

      case 60: case 62: // '<>'
        return readToken_lt_gt(code);

      case 61: case 33: // '=!'
        return readToken_eq_excl(code);

      case 126: // '~'
        return finishOp(_prefix, 1);
    }

    return false;
  }

  /**
   * @param {boolean=} forceRegexp
   */
  function readToken(forceRegexp) {
    if (!forceRegexp) {
      tokStart = tokPos;
    } else {
      tokPos = tokStart + 1;
    }
    if (options.locations) {
      tokStartLoc = new line_loc_t();
    }
    if (forceRegexp) return readRegexp();
    if (tokPos >= inputLen) return finishToken(_eof);

    var code = input.charCodeAt(tokPos);
    // Identifier or keyword. '\uXXXX' sequences are allowed in
    // identifiers, so '\' also dispatches to that.
    if (isIdentifierStart(code) || code === 92) {  // '\'
      return readWord();
    }

    var tok = getTokenFromCode(code);

    if (tok === false) {
      // If we are here, we either found a non-ASCII identifier
      // character, or something that's entirely disallowed.
      var ch = String.fromCharCode(code);
      if (ch === "\\" || nonASCIIidentifierStart.test(ch)) {
        return readWord();
      }
      raise(tokPos, "Unexpected character '" + ch + "'");
    }
  }

  /**
   * @param {!Object} type
   * @param {number} size
   */
  function finishOp(type, size) {
    var str = input.slice(tokPos, tokPos + size);
    tokPos += size;
    finishToken(type, str);
  }

  /**
   * Parse a regular expression. Some context-awareness is necessary,
   * since a '/' inside a '[]' set does not end the expression.
   */
  function readRegexp() {
    // JS-Interpreter change:
    // Removed redundant declaration of 'content' here.  Caused lint errors.
    // -- Neil Fraser, June 2022.
    var escaped;
    var inClass;
    var start = tokPos;
    for (;;) {
      if (tokPos >= inputLen) raise(start, "Unterminated regexp");
      var ch = input.charAt(tokPos);
      if (newline.test(ch)) raise(start, "Unterminated regexp");
      if (!escaped) {
        if (ch === "[") {
          inClass = true;
        } else if (ch === "]" && inClass) {
          inClass = false;
        } else if (ch === "/" && !inClass) {
          break;
        }
        escaped = ch === "\\";
      } else escaped = false;
      ++tokPos;
    }
    var content = input.slice(start, tokPos);
    ++tokPos;
    // Need to use `readWord1` because '\uXXXX' sequences are allowed
    // here (don't ask).
    var mods = readWord1();
    // JS-Interpreter change:
    // Acorn used to use 'gmsiy' to check for flags.  But 's' and 'y' are ES6.
    // -- Neil Fraser, December 2022.
    // https://github.com/acornjs/acorn/issues/1163
    if (mods && !/^[gmi]*$/.test(mods)) {
      raise(start, "Invalid regexp flag");
    }
    try {
      var value = new RegExp(content, mods);
    } catch (e) {
      if (e instanceof SyntaxError) raise(start, e.message);
      // JS-Interpreter change:
      // Acorn used to use raise(e) here which is incorrect.
      // -- Neil Fraser, July 2023.
      throw(e);
    }
    finishToken(_regexp, value);
  }

  /**
   * Read an integer in the given radix. Return null if zero digits
   * were read, the integer value otherwise. When `len` is given, this
   * will return `null` unless the integer has exactly `len` digits.
   * @param {number} radix
   * @param {number=} len
   * @returns {?number}
   */
  function readInt(radix, len) {
    var start = tokPos;
    var total = 0;
    var e = (len === undefined) ? Infinity : len;
    for (var i = 0; i < e; ++i) {
      var code = input.charCodeAt(tokPos), val;
      if (code >= 97) {
        val = code - 97 + 10; // a
      } else if (code >= 65) {
        val = code - 65 + 10; // A
      } else if (code >= 48 && code <= 57) {
        val = code - 48; // 0-9
      } else {
        val = Infinity;
      }
      if (val >= radix) break;
      ++tokPos;
      total = total * radix + val;
    }
    if (tokPos === start || len !== undefined && tokPos - start !== len) {
      return null;
    }
    return total;
  }

  function readHexNumber() {
    tokPos += 2; // 0x
    var val = readInt(16);
    if (val === null) {
      raise(tokStart + 2, "Expected hexadecimal number");
    }
    if (isIdentifierStart(input.charCodeAt(tokPos))) {
      raise(tokPos, "Identifier directly after number");
    }
    finishToken(_num, val);
  }

  /**
   * Read an integer, octal integer, or floating-point number.
   *
   * @param {boolean} startsWithDot
   */
  function readNumber(startsWithDot) {
    var start = tokPos;
    var isFloat = false;
    var octal = input.charCodeAt(tokPos) === 48;
    if (!startsWithDot && readInt(10) === null) {
      raise(start, "Invalid number");
    }
    if (input.charCodeAt(tokPos) === 46) {
      ++tokPos;
      readInt(10);
      isFloat = true;
    }
    var next = input.charCodeAt(tokPos);
    if (next === 69 || next === 101) { // 'eE'
      next = input.charCodeAt(++tokPos);
      if (next === 43 || next === 45) {
        ++tokPos; // '+-'
      }
      if (readInt(10) === null) {
        raise(start, "Invalid number");
      }
      isFloat = true;
    }
    if (isIdentifierStart(input.charCodeAt(tokPos))) {
      raise(tokPos, "Identifier directly after number");
    }

    var str = input.slice(start, tokPos);
    var val;
    if (isFloat) {
      val = parseFloat(str);
    } else if (!octal || str.length === 1) {
      val = parseInt(str, 10);
    } else if (/[89]/.test(str) || strict) {
      raise(start, "Invalid number");
    } else {
      val = parseInt(str, 8);
    }
    finishToken(_num, val);
  }

  /**
   * Read a string value, interpreting backslash-escapes.
   *
   * @param {number} quote
   */
  function readString(quote) {
    tokPos++;
    var out = "";
    for (;;) {
      if (tokPos >= inputLen) raise(tokStart, "Unterminated string constant");
      var ch = input.charCodeAt(tokPos);
      if (ch === quote) {
        ++tokPos;
        finishToken(_string, out);
        return;
      }
      if (ch === 92) { // '\'
        ch = input.charCodeAt(++tokPos);
        var octal = /^[0-7]+/.exec(input.slice(tokPos, tokPos + 3));
        if (octal) {
          octal = octal[0];
        }
        while (octal && parseInt(octal, 8) > 255) {
          octal = octal.slice(0, -1);
        }
        if (octal === "0") {
          octal = null;
        }
        ++tokPos;
        if (octal) {
          if (strict) raise(tokPos - 2, "Octal literal in strict mode");
          out += String.fromCharCode(parseInt(octal, 8));
          tokPos += octal.length - 1;
        } else {
          switch (ch) {
            case 110: out += "\n"; break; // 'n' -> '\n'
            case 114: out += "\r"; break; // 'r' -> '\r'
            case 120: out += String.fromCharCode(readHexChar(2)); break; // 'x'
            case 117: out += String.fromCharCode(readHexChar(4)); break; // 'u'
            case 85: out += String.fromCharCode(readHexChar(8)); break; // 'U'
            case 116: out += "\t"; break; // 't' -> '\t'
            case 98: out += "\b"; break; // 'b' -> '\b'
            case 118: out += "\u000b"; break; // 'v' -> '\u000b'
            case 102: out += "\f"; break; // 'f' -> '\f'
            case 48: out += "\0"; break; // 0 -> '\0'
            case 13:  // '\r'
              if (input.charCodeAt(tokPos) === 10) {
                ++tokPos; // '\r\n'
              }
            case 10: // ' \n'
              if (options.locations) {
                tokLineStart = tokPos;
                ++tokCurLine;
              }
              break;
            default: out += String.fromCharCode(ch); break;
          }
        }
      } else {
        if (ch === 13 || ch === 10 || ch === 8232 || ch === 8233) {
          raise(tokStart, "Unterminated string constant");
        }
        out += String.fromCharCode(ch); // '\'
        ++tokPos;
      }
    }
  }

  /**
   * Used to read character escape sequences ('\x', '\u', '\U').
   *
   * @param {number} len
   * @returns {number}
   */
  function readHexChar(len) {
    var n = readInt(16, len);
    if (n === null) raise(tokStart, "Bad character escape sequence");
    return /** @type {number} */(n);
  }

  // Used to signal to callers of `readWord1` whether the word
  // contained any escape sequences. This is needed because words with
  // escape sequences must not be interpreted as keywords.

  /** @type {boolean|undefined} */
  var containsEsc;

  /**
   * Read an identifier, and return it as a string. Sets `containsEsc`
   * to whether the word contained a '\u' escape.
   *
   * Only builds up the word character-by-character when it actually
   * containeds an escape, as a micro-optimization.
   *
   * @returns {string|undefined}
   */
  function readWord1() {
    containsEsc = false;
    var word;
    var first = true;
    var start = tokPos;
    for (;;) {
      var ch = input.charCodeAt(tokPos);
      if (isIdentifierChar(ch)) {
        if (containsEsc) {
          word += input.charAt(tokPos);
        }
        ++tokPos;
      } else if (ch === 92) { // "\"
        if (!containsEsc) {
          word = input.slice(start, tokPos);
        }
        containsEsc = true;
        if (input.charCodeAt(++tokPos) !== 117) { // "u"
          raise(tokPos, "Expecting Unicode escape sequence \\uXXXX");
        }
        ++tokPos;
        var esc = readHexChar(4);
        var escStr = String.fromCharCode(esc);
        if (!escStr) raise(tokPos - 1, "Invalid Unicode escape");
        if (!(first ? isIdentifierStart(esc) : isIdentifierChar(esc))) {
          raise(tokPos - 4, "Invalid Unicode escape");
        }
        word += escStr;
      } else {
        break;
      }
      first = false;
    }
    return containsEsc ? word : input.slice(start, tokPos);
  }

  /**
   * Read an identifier or keyword token. Will check for reserved
   * words when necessary.
   */
  function readWord() {
    var word = readWord1();
    var type = _name;
    if (!containsEsc && isKeyword(word)) {
      type = keywordTypes[word];
    }
    finishToken(type, word);
  }

  // ## Parser

  // A recursive descent parser operates by defining functions for all
  // syntactic elements, and recursively calling those, each function
  // advancing the input stream and returning an AST node. Precedence
  // of constructs (for example, the fact that `!x[1]` means `!(x[1])`
  // instead of `(!x)[1]` is handled by the fact that the parser
  // function that parses unary prefix operators is called first, and
  // in turn calls the function that parses `[]` subscripts — that
  // way, it'll receive the node for `x[1]` already parsed, and wraps
  // *that* in the unary operator node.
  //
  // Acorn uses an [operator precedence parser][opp] to handle binary
  // operator precedence, because it is much more compact than using
  // the technique outlined above, which uses different, nesting
  // functions to specify precedence, for all of the ten binary
  // precedence levels that JavaScript defines.
  //
  // [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

  // ### Parser utilities

  /**
   * Continue to the next token.
   */
  function next() {
    lastStart = tokStart;
    lastEnd = tokEnd;
    lastEndLoc = tokEndLoc;
    readToken();
  }

  /**
   * Enter strict mode. Re-reads the next token to please pedantic
   * tests ("use strict"; 010; -- should fail).
   *
   * @param {boolean} strct
   */
  function setStrict(strct) {
    strict = strct;
    tokPos = tokStart;
    if (options.locations) {
      while (tokPos < tokLineStart) {
        tokLineStart = input.lastIndexOf("\n", tokLineStart - 2) + 1;
        --tokCurLine;
      }
    }
    skipSpace();
    readToken();
  }

  // Start an AST node, attaching a start offset.

  /**
   * @constructor
   */
  function node_t() {
    this.type = null;
    this.start = tokStart;
    this.end = null;
  }

  /**
   * @constructor
   */
  function node_loc_t() {
    this.start = tokStartLoc;
    this.end = null;
    if (sourceFile) {
      this.source = sourceFile;
    }
  }

  /**
   * @returns {!node_t}
   */
  function startNode() {
    var node = new node_t();
    if (options.locations) {
      node.loc = new node_loc_t();
    }
    if (options.directSourceFile) {
      node.sourceFile = options.directSourceFile;
    }
    if (options.ranges) {
      node.range = [tokStart, 0];
    }
    return node;
  }

  /**
   * Start a node whose start offset information should be based on
   * the start of another node. For example, a binary operator node is
   * only started after its left-hand side has already been parsed.
   *
   * @param {!node_t} other
   * @returns {!node_t}
   */
  function startNodeFrom(other) {
    var node = new node_t();
    node.start = other.start;
    if (options.locations) {
      node.loc = new node_loc_t();
      node.loc.start = other.loc.start;
    }
    if (options.ranges) {
      node.range = [other.range[0], 0];
    }
    return node;
  }

  /**
   * Finish an AST node, adding `type` and `end` properties.
   *
   * @param {!node_t} node
   * @param {string} type
   * @returns {!node_t}
   */
  function finishNode(node, type) {
    node.type = type;
    node.end = lastEnd;
    if (options.locations) {
      node.loc.end = lastEndLoc;
    }
    if (options.ranges) {
      node.range[1] = lastEnd;
    }
    return node;
  }

  /**
   * Test whether a statement node is the string literal `"use strict"`.
   *
   * @param {!node_t} stmt
   * @returns {boolean}
   */
  function isUseStrict(stmt) {
    return stmt.type === "ExpressionStatement" &&
        stmt.expression.type === "Literal" &&
        stmt.expression.value === "use strict";
  }

  /**
   * Predicate that tests whether the next token is of the given
   * type, and if yes, consumes it as a side effect.
   * @param {!Object} type
   * @returns {boolean}
   */
  function eat(type) {
    if (tokType === type) {
      next();
      return true;
    }
    return false;
  }

  /**
   * Test whether a semicolon can be inserted at the current position.
   *
   * @returns {boolean}
   */
  function canInsertSemicolon() {
    return !options.strictSemicolons &&
        (tokType === _eof || tokType === _braceR ||
         newline.test(input.slice(lastEnd, tokStart)));
  }

  /**
   * Consume a semicolon, or, failing that, see if we are allowed to
   * pretend that there is a semicolon at this position.
   */
  function semicolon() {
    if (!eat(_semi) && !canInsertSemicolon()) {
      unexpected();
    }
  }

  /**
   * Expect a token of a given type.  If found, consume it, otherwise,
   * raise an unexpected token error.
   *
   * @param {!Object} type
   */
  function expect(type) {
    if (tokType === type) {
      next();
    } else {
      unexpected();
    }
  }

  /**
   * Raise an unexpected token error.
   * @throws {SyntaxError}
   */
  function unexpected() {
    raise(tokStart, "Unexpected token");
  }

  /**
   * Verify that a node is an lval — something that can be assigned to.
   *
   * @param {!node_t} expr
   */
  function checkLVal(expr) {
    if (expr.type !== "Identifier" && expr.type !== "MemberExpression") {
      raise(expr.start, "Assigning to rvalue");
    }
    if (strict && expr.type === "Identifier" && isStrictBadIdWord(expr.name)) {
      raise(expr.start, "Assigning to " + expr.name + " in strict mode");
    }
  }

  // ### Statement parsing

  /**
   * Parse a program. Initializes the parser, reads any number of
   * statements, and wraps them in a Program node.  Optionally takes a
   * `program` argument.  If present, the statements will be appended
   * to its body instead of creating a new node.
   *
   * @param {node_t} program
   * @returns {!node_t}
   */
  function parseTopLevel(program) {
    lastStart = lastEnd = tokPos;
    if (options.locations) {
      lastEndLoc = new line_loc_t();
    }
    inFunction = strict = false;
    labels = [];
    readToken();

    var node = program || startNode();
    var first = true;
    if (!program) {
      node.body = [];
    }
    while (tokType !== _eof) {
      var stmt = parseStatement();
      node.body.push(stmt);
      if (first && isUseStrict(stmt)) {
        setStrict(true);
      }
      first = false;
    }
    return finishNode(node, "Program");
  }

  var loopLabel = {kind: "loop"};
  var switchLabel = {kind: "switch"};

  /**
   * Parse a single statement.
   *
   * If expecting a statement and finding a slash operator, parse a
   * regular expression literal. This is to handle cases like
   * `if (foo) /blah/.exec(foo);`, where looking at the previous token
   * does not help.
   *
   * @returns {!node_t}
   */
  function parseStatement() {
    if (tokType === _slash || tokType === _assign && tokVal === "/=") {
      readToken(true);
    }

    var starttype = tokType;
    var node = startNode();

    // Most types of statements are recognized by the keyword they
    // start with. Many are trivial to parse, some require a bit of
    // complexity.

    switch (starttype) {
      case _break: case _continue:
        next();
        var isBreak = starttype === _break;
        if (eat(_semi) || canInsertSemicolon()) {
          node.label = null;
        } else if (tokType !== _name) {
          unexpected();
        } else {
          node.label = parseIdent();
          semicolon();
        }

        // Verify that there is an actual destination to break or
        // continue to.
        for (var i = 0; i < labels.length; ++i) {
          var lab = labels[i];
          if (node.label === null || lab.name === node.label.name) {
            if (lab.kind !== null && (isBreak || lab.kind === "loop")) break;
            if (node.label && isBreak) break;
          }
        }
        if (i === labels.length) {
          raise(node.start, "Unsyntactic " + starttype.keyword);
        }
        return finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");

      case _debugger:
        next();
        semicolon();
        return finishNode(node, "DebuggerStatement");

      case _do:
        next();
        labels.push(loopLabel);
        node.body = parseStatement();
        labels.pop();
        expect(_while);
        node.test = parseParenExpression();
        semicolon();
        return finishNode(node, "DoWhileStatement");

        // Disambiguating between a `for` and a `for`/`in` loop is
        // non-trivial. Basically, we have to parse the init `var`
        // statement or expression, disallowing the `in` operator (see
        // the second parameter to `parseExpression`), and then check
        // whether the next token is `in`. When there is no init part
        // (semicolon immediately after the opening parenthesis), it is
        // a regular `for` loop.

      case _for:
        next();
        labels.push(loopLabel);
        expect(_parenL);
        if (tokType === _semi) return parseFor(node, null);
        if (tokType === _var) {
          var init = startNode();
          next();
          parseVar(init, true);
          finishNode(init, "VariableDeclaration");
          if (init.declarations.length === 1 && eat(_in))
            return parseForIn(node, init);
          return parseFor(node, init);
        }
        var init = parseExpression(false, true);
        if (eat(_in)) {
          checkLVal(init);
          return parseForIn(node, init);
        }
        return parseFor(node, init);

      case _function:
        next();
        return parseFunction(node, true);

      case _if:
        next();
        node.test = parseParenExpression();
        node.consequent = parseStatement();
        node.alternate = eat(_else) ? parseStatement() : null;
        return finishNode(node, "IfStatement");

      case _return:
        if (!inFunction && !options.allowReturnOutsideFunction) {
          raise(tokStart, "'return' outside of function");
        }
        next();

        // In `return` (and `break`/`continue`), the keywords with
        // optional arguments, we eagerly look for a semicolon or the
        // possibility to insert one.

        if (eat(_semi) || canInsertSemicolon()) {
          node.argument = null;
        } else {
          node.argument = parseExpression();
          semicolon();
        }
        return finishNode(node, "ReturnStatement");

      case _switch:
        next();
        node.discriminant = parseParenExpression();
        node.cases = [];
        expect(_braceL);
        labels.push(switchLabel);

        // Statements under must be grouped (by label) in SwitchCase
        // nodes. `cur` is used to keep the node that we are currently
        // adding statements to.

        for (var cur, sawDefault; tokType !== _braceR;) {
          if (tokType === _case || tokType === _default) {
            var isCase = tokType === _case;
            if (cur) {
              finishNode(cur, "SwitchCase");
            }
            node.cases.push(cur = startNode());
            cur.consequent = [];
            next();
            if (isCase) {
              cur.test = parseExpression();
            } else {
              if (sawDefault) {
                raise(lastStart, "Multiple default clauses");
              }
              sawDefault = true;
              cur.test = null;
            }
            expect(_colon);
          } else {
            if (!cur) unexpected();
            cur.consequent.push(parseStatement());
          }
        }
        if (cur) finishNode(cur, "SwitchCase");
        next(); // Closing brace
        labels.pop();
        return finishNode(node, "SwitchStatement");

      case _throw:
        next();
        if (newline.test(input.slice(lastEnd, tokStart)))
          raise(lastEnd, "Illegal newline after throw");
        node.argument = parseExpression();
        semicolon();
        return finishNode(node, "ThrowStatement");

      case _try:
        next();
        node.block = parseBlock();
        node.handler = null;
        if (tokType === _catch) {
          var clause = startNode();
          next();
          expect(_parenL);
          clause.param = parseIdent();
          if (strict && isStrictBadIdWord(clause.param.name))
            raise(clause.param.start, "Binding " + clause.param.name + " in strict mode");
          expect(_parenR);
          // JS-Interpreter change:
          // Obsolete unused property; commenting out.
          // -- Neil Fraser, January 2023.
          // clause.guard = null;
          clause.body = parseBlock();
          node.handler = finishNode(clause, "CatchClause");
        }
        // JS-Interpreter change:
        // Obsolete unused property; commenting out.
        // -- Neil Fraser, January 2023.
        // node.guardedHandlers = empty;
        node.finalizer = eat(_finally) ? parseBlock() : null;
        if (!node.handler && !node.finalizer)
          raise(node.start, "Missing catch or finally clause");
        return finishNode(node, "TryStatement");

      case _var:
        next();
        parseVar(node);
        semicolon();
        return finishNode(node, "VariableDeclaration");

      case _while:
        next();
        node.test = parseParenExpression();
        labels.push(loopLabel);
        node.body = parseStatement();
        labels.pop();
        return finishNode(node, "WhileStatement");

      case _with:
        if (strict) raise(tokStart, "'with' in strict mode");
        next();
        node.object = parseParenExpression();
        node.body = parseStatement();
        return finishNode(node, "WithStatement");

      case _braceL:
        return parseBlock();

      case _semi:
        next();
        return finishNode(node, "EmptyStatement");

      // If the statement does not start with a statement keyword or a
      // brace, it's an ExpressionStatement or LabeledStatement. We
      // simply start parsing an expression, and afterwards, if the
      // next token is a colon and the expression was a simple
      // Identifier node, we switch to interpreting it as a label.
      default:
        var maybeName = tokVal;
        var expr = parseExpression();
        if (starttype === _name && expr.type === "Identifier" && eat(_colon)) {
          for (var i = 0; i < labels.length; ++i) {
            if (labels[i].name === maybeName) {
              raise(expr.start, "Label '" + maybeName + "' is already declared");
            }
          }
          var kind = tokType.isLoop ? "loop" :
              (tokType === _switch ? "switch" : null);
          labels.push({name: maybeName, kind: kind});
          node.body = parseStatement();
          labels.pop();
          node.label = expr;
          return finishNode(node, "LabeledStatement");
        } else {
          node.expression = expr;
          semicolon();
          return finishNode(node, "ExpressionStatement");
        }
    }
  }

  /**
   * Used for constructs like `switch` and `if` that insist on
   * parentheses around their expression.
   *
   * @returns {!node_t}
   */
  function parseParenExpression() {
    expect(_parenL);
    var val = parseExpression();
    expect(_parenR);
    return val;
  }

  /**
   * Parse a semicolon-enclosed block of statements, handling `"use
   * strict"` declarations when `allowStrict` is true (used for
   * function bodies).
   *
   * @param {boolean=} allowStrict
   * @returns {!node_t}
   */
  function parseBlock(allowStrict) {
    var node = startNode();
    var first = true;
    var strict = false;
    var oldStrict;
    node.body = [];
    expect(_braceL);
    while (!eat(_braceR)) {
      var stmt = parseStatement();
      node.body.push(stmt);
      if (first && allowStrict && isUseStrict(stmt)) {
        oldStrict = strict;
        setStrict(strict = true);
      }
      first = false;
    }
    if (strict && !oldStrict) setStrict(false);
    return finishNode(node, "BlockStatement");
  }

  /**
   * Parse a regular `for` loop. The disambiguation code in `parseStatement`
   * will already have parsed the init statement or expression.
   *
   * @param {!node_t} node
   * @param {node_t} init
   * @returns {!node_t}
   */
  function parseFor(node, init) {
    node.init = init;
    expect(_semi);
    node.test = tokType === _semi ? null : parseExpression();
    expect(_semi);
    node.update = tokType === _parenR ? null : parseExpression();
    expect(_parenR);
    node.body = parseStatement();
    labels.pop();
    return finishNode(node, "ForStatement");
  }

  /**
   * Parse a `for`/`in` loop.
   *
   * @param {!node_t} node
   * @param {!node_t} init
   * @returns {!node_t}
   */
  function parseForIn(node, init) {
    node.left = init;
    node.right = parseExpression();
    expect(_parenR);
    node.body = parseStatement();
    labels.pop();
    return finishNode(node, "ForInStatement");
  }

  /**
   * Parse a list of variable declarations.
   *
   * @param {!node_t} node
   * @param {boolean=} noIn
   */
  function parseVar(node, noIn) {
    node.declarations = [];
    node.kind = "var";
    for (;;) {
      var decl = startNode();
      decl.id = parseIdent();
      if (strict && isStrictBadIdWord(decl.id.name))
        raise(decl.id.start, "Binding " + decl.id.name + " in strict mode");
      decl.init = eat(_eq) ? parseExpression(true, noIn) : null;
      node.declarations.push(finishNode(decl, "VariableDeclarator"));
      if (!eat(_comma)) break;
    }
  }

  // ### Expression parsing

  // These nest, from the most general expression type at the top to
  // 'atomic', nondivisible expression types at the bottom. Most of
  // the functions will simply let the function(s) below them parse,
  // and, *if* the syntactic construct they handle is present, wrap
  // the AST node that the inner parser gave them in another node.

  /**
   * Parse a full expression. The arguments are used to forbid comma
   * sequences (in argument lists, array literals, or object literals)
   * or the `in` operator (in for loops initalization expressions).
   *
   * @param {boolean=} noComma
   * @param {boolean=} noIn
   * @returns {!node_t}
   */
  function parseExpression(noComma, noIn) {
    var expr = parseMaybeAssign(noIn);
    if (!noComma && tokType === _comma) {
      var node = startNodeFrom(expr);
      node.expressions = [expr];
      while (eat(_comma)) node.expressions.push(parseMaybeAssign(noIn));
      return finishNode(node, "SequenceExpression");
    }
    return expr;
  }

  /**
   * Parse an assignment expression. This includes applications of
   * operators like `+=`.
   *
   * @param {boolean|undefined} noIn
   * @returns {!node_t}
   */
  function parseMaybeAssign(noIn) {
    var left = parseMaybeConditional(noIn);
    if (tokType.isAssign) {
      var node = startNodeFrom(left);
      node.operator = tokVal;
      node.left = left;
      next();
      node.right = parseMaybeAssign(noIn);
      checkLVal(left);
      return finishNode(node, "AssignmentExpression");
    }
    return left;
  }

  /**
   * Parse a ternary conditional (`?:`) operator.
   *
   * @param {boolean|undefined} noIn
   * @returns {!node_t}
   */
  function parseMaybeConditional(noIn) {
    var expr = parseExprOps(noIn);
    if (eat(_question)) {
      var node = startNodeFrom(expr);
      node.test = expr;
      node.consequent = parseExpression(true);
      expect(_colon);
      node.alternate = parseExpression(true, noIn);
      return finishNode(node, "ConditionalExpression");
    }
    return expr;
  }

  /**
   * Start the precedence parser.
   *
   * @param {boolean|undefined} noIn
   * @returns {!node_t}
   */
  function parseExprOps(noIn) {
    return parseExprOp(parseMaybeUnary(), -1, noIn);
  }

  /**
   * Parse binary operators with the operator precedence parsing
   * algorithm. `left` is the left-hand side of the operator.
   * `minPrec` provides context that allows the function to stop and
   * defer further parser to one of its callers when it encounters an
   * operator that has a lower precedence than the set it is parsing.
   *
   * @param {!node_t} left
   * @param {number} minPrec
   * @param {boolean|undefined} noIn
   * @returns {!node_t}
   */
  function parseExprOp(left, minPrec, noIn) {
    var prec = tokType.binop;
    if (prec !== null && (!noIn || tokType !== _in)) {
      if (prec > minPrec) {
        var node = startNodeFrom(left);
        node.left = left;
        node.operator = tokVal;
        var op = tokType;
        next();
        node.right = parseExprOp(parseMaybeUnary(), prec, noIn);
        var exprNode = finishNode(node, (op === _logicalOR || op === _logicalAND) ? "LogicalExpression" : "BinaryExpression");
        return parseExprOp(exprNode, minPrec, noIn);
      }
    }
    return left;
  }

  /**
   * Parse unary operators, both prefix and postfix.
   *
   * @returns {!node_t}
   */
  function parseMaybeUnary() {
    if (tokType.prefix) {
      var node = startNode();
      var update = tokType.isUpdate;
      node.operator = tokVal;
      node.prefix = true;
      tokRegexpAllowed = true;
      next();
      node.argument = parseMaybeUnary();
      if (update) checkLVal(node.argument);
      else if (strict && node.operator === "delete" &&
               node.argument.type === "Identifier")
        raise(node.start, "Deleting local variable in strict mode");
      return finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
    }
    var expr = parseExprSubscripts();
    while (tokType.postfix && !canInsertSemicolon()) {
      var node = startNodeFrom(expr);
      node.operator = tokVal;
      node.prefix = false;
      node.argument = expr;
      checkLVal(expr);
      next();
      expr = finishNode(node, "UpdateExpression");
    }
    return expr;
  }

  /**
   * Parse call, dot, and `[]`-subscript expressions.
   *
   * @returns {!node_t}
   */
  function parseExprSubscripts() {
    return parseSubscripts(parseExprAtom());
  }

  /**
   * @param {!node_t} base
   * @param {boolean=} noCalls
   * @returns {!node_t}
   */
  function parseSubscripts(base, noCalls) {
    var node;
    if (eat(_dot)) {
      node = startNodeFrom(base);
      node.object = base;
      node.property = parseIdent(true);
      node.computed = false;
      return parseSubscripts(finishNode(node, "MemberExpression"), noCalls);
    }
    if (eat(_bracketL)) {
      node = startNodeFrom(base);
      node.object = base;
      node.property = parseExpression();
      node.computed = true;
      expect(_bracketR);
      return parseSubscripts(finishNode(node, "MemberExpression"), noCalls);
    }
    if (!noCalls && eat(_parenL)) {
      node = startNodeFrom(base);
      node.callee = base;
      node.arguments = parseExprList(_parenR, false);
      return parseSubscripts(finishNode(node, "CallExpression"), noCalls);
    }
    return base;
  }

  /**
   * Parse an atomic expression — either a single token that is an expression,
   * an expression started by a keyword like `function` or `new`,
   * or an expression wrapped in punctuation like `()`, `[]`, or `{}`.
   *
   * @returns {!node_t}
   * @suppress {missingReturn}
   */
  function parseExprAtom() {
    var node;
    switch (tokType) {
      case _this:
        node = startNode();
        next();
        return finishNode(node, "ThisExpression");
      case _name:
        return parseIdent();
      case _num: case _string: case _regexp:
        node = startNode();
        node.value = tokVal;
        node.raw = input.slice(tokStart, tokEnd);
        next();
        return finishNode(node, "Literal");

      case _null: case _true: case _false:
        node = startNode();
        node.value = tokType.atomValue;
        node.raw = tokType.keyword;
        next();
        return finishNode(node, "Literal");

      case _parenL:
        var tokStartLoc1 = tokStartLoc;
        var tokStart1 = tokStart;
        next();
        var val = parseExpression();
        val.start = tokStart1;
        val.end = tokEnd;
        if (options.locations) {
          val.loc.start = tokStartLoc1;
          val.loc.end = tokEndLoc;
        }
        if (options.ranges) {
          val.range = [tokStart1, tokEnd];
        }
        expect(_parenR);
        return val;

      case _bracketL:
        node = startNode();
        next();
        node.elements = parseExprList(_bracketR, true, true);
        return finishNode(node, "ArrayExpression");

      case _braceL:
        return parseObj();

      case _function:
        node = startNode();
        next();
        return parseFunction(node, false);

      case _new:
        return parseNew();
    }
    unexpected();
  }

  /**
   * New's precedence is slightly tricky. It must allow its argument to be
   * a `[]` or dot subscript expression, but not a call — at least, not
   * without wrapping it in parentheses. Thus, it uses the noCalls argument
   * to parseSubscripts to prevent it from consuming the argument list.
   *
   * @returns {!node_t}
   */
  function parseNew() {
    var node = startNode();
    next();
    node.callee = parseSubscripts(parseExprAtom(), true);
    node.arguments = eat(_parenL) ? parseExprList(_parenR, false) : empty;
    return finishNode(node, "NewExpression");
  }

  /**
   * Parse an object literal.
   *
   * @returns {!node_t}
   */
  function parseObj() {
    var node = startNode();
    var first = true;
    var sawGetSet = false;
    node.properties = [];
    next();
    while (!eat(_braceR)) {
      if (!first) {
        expect(_comma);
        if (options.allowTrailingCommas && eat(_braceR)) {
          break;
        }
      } else {
        first = false;
      }

      var prop = {key: parsePropertyName()};
      var isGetSet = false;
      var kind;
      if (eat(_colon)) {
        prop.value = parseExpression(true);
        kind = prop.kind = "init";
      } else if (prop.key.type === "Identifier" &&
                 (prop.key.name === "get" || prop.key.name === "set")) {
        isGetSet = sawGetSet = true;
        kind = prop.kind = prop.key.name;
        prop.key = parsePropertyName();
        if (tokType !== _parenL) unexpected();
        prop.value = parseFunction(startNode(), false);
      } else {
        unexpected();
      }

      // getters and setters are not allowed to clash — either with
      // each other or with an init property — and in strict mode,
      // init properties are also not allowed to be repeated.

      if (prop.key.type === "Identifier" && (strict || sawGetSet)) {
        for (var i = 0; i < node.properties.length; ++i) {
          var other = node.properties[i];
          if (other.key.name === prop.key.name) {
            var conflict = kind === other.kind || isGetSet && other.kind === "init" ||
                kind === "init" && (other.kind === "get" || other.kind === "set");
            if (conflict && !strict && kind === "init" && other.kind === "init") {
              conflict = false;
            }
            if (conflict) {
              raise(prop.key.start, "Redefinition of property");
            }
          }
        }
      }
      node.properties.push(prop);
    }
    return finishNode(node, "ObjectExpression");
  }

  /**
   * @returns {!node_t}
   */
  function parsePropertyName() {
    if (tokType === _num || tokType === _string) {
      return parseExprAtom();
    }
    return parseIdent(true);
  }

  /**
   * Parse a function declaration or literal (depending on the
   * `isStatement` parameter).
   *
   * @param {!node_t} node
   * @param {boolean} isStatement
   * @returns {!node_t}
   */
  function parseFunction(node, isStatement) {
    if (tokType === _name) {
      node.id = parseIdent();
    } else if (isStatement) {
      unexpected();
    } else {
      node.id = null;
    }
    node.params = [];
    var first = true;
    expect(_parenL);
    while (!eat(_parenR)) {
      if (!first) {
        expect(_comma);
      } else {
        first = false;
      }
      node.params.push(parseIdent());
    }

    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    var oldInFunc = inFunction;
    var oldLabels = labels;
    inFunction = true;
    labels = [];
    node.body = parseBlock(true);
    inFunction = oldInFunc;
    labels = oldLabels;

    // If this is a strict mode function, verify that argument names
    // are not repeated, and it does not try to bind the words `eval`
    // or `arguments`.
    if (strict || node.body.body.length && isUseStrict(node.body.body[0])) {
      for (var i = node.id ? -1 : 0; i < node.params.length; ++i) {
        var id = i < 0 ? node.id : node.params[i];
        if (isStrictReservedWord(id.name) || isStrictBadIdWord(id.name)) {
          raise(id.start, "Defining '" + id.name + "' in strict mode");
        }
        if (i >= 0) {
          for (var j = 0; j < i; ++j) {
            if (id.name === node.params[j].name) {
              raise(id.start, "Argument name clash in strict mode");
            }
          }
        }
      }
    }

    return finishNode(node, isStatement ? "FunctionDeclaration" : "FunctionExpression");
  }

  /**
   * Parses a comma-separated list of expressions, and returns them as
   * an array. `close` is the token type that ends the list, and
   * `allowEmpty` can be turned on to allow subsequent commas with
   * nothing in between them to be parsed as `null` (which is needed
   * for array literals).
   *
   * @param {!Object} close
   * @param {boolean} allowTrailingComma
   * @param {boolean=} allowEmpty
   * @returns {!Array<!node_t>}
   */
  function parseExprList(close, allowTrailingComma, allowEmpty) {
    var elts = [];
    var first = true;
    while (!eat(close)) {
      if (!first) {
        expect(_comma);
        if (allowTrailingComma && options.allowTrailingCommas && eat(close)) {
          break;
        }
      } else {
        first = false;
      }

      elts.push((allowEmpty && tokType === _comma) ?
          null : parseExpression(true));
    }
    return elts;
  }

  /**
   * Parse the next token as an identifier. If `liberal` is true (used
   * when parsing properties), it will also convert keywords into
   * identifiers.
   *
   * @param {boolean=} liberal
   * @returns {!node_t}
   */
  function parseIdent(liberal) {
    var node = startNode();
    if (liberal && options.forbidReserved === "everywhere") {
      liberal = false;
    }
    if (tokType === _name) {
      if (!liberal &&
          (options.forbidReserved && isReservedWord5(tokVal) ||
           strict && isStrictReservedWord(tokVal)) &&
          input.slice(tokStart, tokEnd).indexOf("\\") === -1) {
        raise(tokStart, "The keyword '" + tokVal + "' is reserved");
      }
      node.name = tokVal;
    } else if (liberal && tokType.keyword) {
      node.name = tokType.keyword;
    } else {
      unexpected();
    }
    tokRegexpAllowed = false;
    next();
    return finishNode(node, "Identifier");
  }

});


/*

 Copyright 2012 Marijn Haverbeke
 SPDX-License-Identifier: MIT
*/
var p;
var ba="undefined"===typeof globalThis?this||window:globalThis,ca=function(a){function b(f){return 48>f?36===f:58>f?!0:65>f?!1:91>f?!0:97>f?95===f:123>f?!0:170<=f&&Kc.test(String.fromCharCode(f))}function d(f){return 65>f?36===f:91>f?!0:97>f?95===f:123>f?!0:170<=f&&Qb.test(String.fromCharCode(f))}function c(f,h){var l=r;for(var n=1,w=0;;){Ta.lastIndex=w;var K=Ta.exec(l);if(K&&K.index<f)++n,w=K.index+K[0].length;else break}l={line:n,eb:f-w};h+=" ("+l.line+":"+l.eb+")";h=new SyntaxError(h);h.j=f;h.O=
l;h.o=m;throw h;}function e(f){f=f.split(" ");for(var h=Object.create(null),l=0;l<f.length;l++)h[f[l]]=!0;return function(n){return h[n]||!1}}function g(){this.line=ka;this.eb=m-W}function k(f,h){na=m;z.D&&(cb=new g);x=f;C();T=h;ya=f.m}function q(){for(var f=m,h=z.Aa&&z.D&&new g,l=r.charCodeAt(m+=2);m<oa&&10!==l&&13!==l&&8232!==l&&8233!==l;)++m,l=r.charCodeAt(m);z.Aa&&z.Aa(!1,r.slice(f+2,m),f,m,h,z.D&&new g)}function C(){for(;m<oa;){var f=r.charCodeAt(m);if(32===f)++m;else if(13===f)++m,f=r.charCodeAt(m),
10===f&&++m,z.D&&(++ka,W=m);else if(10===f||8232===f||8233===f)++m,z.D&&(++ka,W=m);else if(8<f&&14>f)++m;else if(47===f)if(f=r.charCodeAt(m+1),42===f){f=void 0;var h=z.Aa&&z.D&&new g,l=m,n=r.indexOf("*/",m+=2);-1===n&&c(m-2,"Unterminated comment");m=n+2;if(z.D)for(Ta.lastIndex=l;(f=Ta.exec(r))&&f.index<m;)++ka,W=f.index+f[0].length;z.Aa&&z.Aa(!0,r.slice(l+2,n),l,m,h,z.D&&new g)}else if(47===f)q();else break;else if(160===f)++m;else if(5760<=f&&Lc.test(String.fromCharCode(f)))++m;else break}}function R(f){switch(f){case 46:f=
r.charCodeAt(m+1);48<=f&&57>=f?Rb(!0):(++m,k(Sb));return;case 40:return++m,k(X);case 41:return++m,k(V);case 59:return++m,k(Y);case 44:return++m,k(ea);case 91:return++m,k(db);case 93:return++m,k(eb);case 123:return++m,k(za);case 125:return++m,k(pa);case 58:return++m,k(Aa);case 63:return++m,k(Tb);case 48:if(f=r.charCodeAt(m+1),120===f||88===f){m+=2;f=Ba(16);null===f&&c(I+2,"Expected hexadecimal number");d(r.charCodeAt(m))&&c(m,"Identifier directly after number");k(Ca,f);return}case 49:case 50:case 51:case 52:case 53:case 54:case 55:case 56:case 57:return Rb(!1);
case 34:case 39:m++;for(var h="";;){m>=oa&&c(I,"Unterminated string constant");var l=r.charCodeAt(m);if(l===f){++m;k(Ua,h);break}if(92===l){l=r.charCodeAt(++m);var n=/^[0-7]+/.exec(r.slice(m,m+3));for(n&&(n=n[0]);n&&255<parseInt(n,8);)n=n.slice(0,-1);"0"===n&&(n=null);++m;if(n)S&&c(m-2,"Octal literal in strict mode"),h+=String.fromCharCode(parseInt(n,8)),m+=n.length-1;else switch(l){case 110:h+="\n";break;case 114:h+="\r";break;case 120:h+=String.fromCharCode(Va(2));break;case 117:h+=String.fromCharCode(Va(4));
break;case 85:h+=String.fromCharCode(Va(8));break;case 116:h+="\t";break;case 98:h+="\b";break;case 118:h+="\v";break;case 102:h+="\f";break;case 48:h+="\x00";break;case 13:10===r.charCodeAt(m)&&++m;case 10:z.D&&(W=m,++ka);break;default:h+=String.fromCharCode(l)}}else 13!==l&&10!==l&&8232!==l&&8233!==l||c(I,"Unterminated string constant"),h+=String.fromCharCode(l),++m}return;case 47:f=r.charCodeAt(m+1);ya?(++m,Ub()):61===f?L(la,2):L(Vb,1);return;case 37:case 42:61===r.charCodeAt(m+1)?L(la,2):L(Mc,
1);return;case 124:case 38:h=r.charCodeAt(m+1);h===f?L(124===f?Wb:Xb,2):61===h?L(la,2):L(124===f?Nc:Oc,1);return;case 94:61===r.charCodeAt(m+1)?L(la,2):L(Pc,1);return;case 43:case 45:h=r.charCodeAt(m+1);h===f?45===h&&62===r.charCodeAt(m+2)&&Wa.test(r.slice(fa,m))?(m+=3,q(),C(),ha()):L(Qc,2):61===h?L(la,2):L(Rc,1);return;case 60:case 62:h=r.charCodeAt(m+1);l=1;h===f?(l=62===f&&62===r.charCodeAt(m+2)?3:2,61===r.charCodeAt(m+l)?L(la,l+1):L(Sc,l)):33===h&&60===f&&45===r.charCodeAt(m+2)&&45===r.charCodeAt(m+
3)?(m+=4,q(),C(),ha()):(61===h&&(l=61===r.charCodeAt(m+2)?3:2),L(Tc,l));return;case 61:case 33:61===r.charCodeAt(m+1)?L(Uc,61===r.charCodeAt(m+2)?3:2):L(61===f?Yb:Zb,1);return;case 126:return L(Zb,1)}return!1}function ha(f){f?m=I+1:I=m;z.D&&(fb=new g);if(f)return Ub();if(m>=oa)return k(gb);f=r.charCodeAt(m);if(d(f)||92===f)return $b();if(!1===R(f)){f=String.fromCharCode(f);if("\\"===f||Qb.test(f))return $b();c(m,"Unexpected character '"+f+"'")}}function L(f,h){var l=r.slice(m,m+h);m+=h;k(f,l)}function Ub(){for(var f,
h,l=m;;){m>=oa&&c(l,"Unterminated regexp");var n=r.charAt(m);Wa.test(n)&&c(l,"Unterminated regexp");if(f)f=!1;else{if("["===n)h=!0;else if("]"===n&&h)h=!1;else if("/"===n&&!h)break;f="\\"===n}++m}f=r.slice(l,m);++m;(h=ac())&&!/^[gmi]*$/.test(h)&&c(l,"Invalid regexp flag");try{var w=new RegExp(f,h)}catch(K){throw K instanceof SyntaxError&&c(l,K.message),K;}k(bc,w)}function Ba(f,h){for(var l=m,n=0,w=void 0===h?Infinity:h,K=0;K<w;++K){var O=r.charCodeAt(m);O=97<=O?O-97+10:65<=O?O-65+10:48<=O&&57>=O?
O-48:Infinity;if(O>=f)break;++m;n=n*f+O}return m===l||void 0!==h&&m-l!==h?null:n}function Rb(f){var h=m,l=!1,n=48===r.charCodeAt(m);f||null!==Ba(10)||c(h,"Invalid number");46===r.charCodeAt(m)&&(++m,Ba(10),l=!0);f=r.charCodeAt(m);if(69===f||101===f)f=r.charCodeAt(++m),43!==f&&45!==f||++m,null===Ba(10)&&c(h,"Invalid number"),l=!0;d(r.charCodeAt(m))&&c(m,"Identifier directly after number");f=r.slice(h,m);var w;l?w=parseFloat(f):n&&1!==f.length?/[89]/.test(f)||S?c(h,"Invalid number"):w=parseInt(f,8):
w=parseInt(f,10);k(Ca,w)}function Va(f){f=Ba(16,f);null===f&&c(I,"Bad character escape sequence");return f}function ac(){qa=!1;for(var f,h=!0,l=m;;){var n=r.charCodeAt(m);if(b(n))qa&&(f+=r.charAt(m)),++m;else if(92===n){qa||(f=r.slice(l,m));qa=!0;117!==r.charCodeAt(++m)&&c(m,"Expecting Unicode escape sequence \\uXXXX");++m;n=Va(4);var w=String.fromCharCode(n);w||c(m-1,"Invalid Unicode escape");(h?d(n):b(n))||c(m-4,"Invalid Unicode escape");f+=w}else break;h=!1}return qa?f:r.slice(l,m)}function $b(){var f=
ac(),h=ra;!qa&&Vc(f)&&(h=Wc[f]);k(h,f)}function B(){hb=I;fa=na;ib=cb;ha()}function jb(f){S=f;m=I;if(z.D)for(;m<W;)W=r.lastIndexOf("\n",W-2)+1,--ka;C();ha()}function cc(){this.type=null;this.start=I;this.end=null}function dc(){this.start=fb;this.end=null;kb&&(this.source=kb)}function M(){var f=new cc;z.D&&(f.O=new dc);z.vb&&(f.sourceFile=z.vb);z.Za&&(f.j=[I,0]);return f}function ia(f){var h=new cc;h.start=f.start;z.D&&(h.O=new dc,h.O.start=f.O.start);z.Za&&(h.j=[f.j[0],0]);return h}function y(f,h){f.type=
h;f.end=fa;z.D&&(f.O.end=ib);z.Za&&(f.j[1]=fa);return f}function lb(f){return"ExpressionStatement"===f.type&&"Literal"===f.pa.type&&"use strict"===f.pa.value}function E(f){return x===f?(B(),!0):!1}function Xa(){return!z.ec&&(x===gb||x===pa||Wa.test(r.slice(fa,I)))}function ma(){E(Y)||Xa()||Z()}function F(f){x===f?B():Z()}function Z(){c(I,"Unexpected token")}function Ya(f){"Identifier"!==f.type&&"MemberExpression"!==f.type&&c(f.start,"Assigning to rvalue");S&&"Identifier"===f.type&&Za(f.name)&&c(f.start,
"Assigning to "+f.name+" in strict mode")}function U(){(x===Vb||x===la&&"/="===T)&&ha(!0);var f=x,h=M();switch(f){case mb:case ec:B();var l=f===mb;E(Y)||Xa()?h.label=null:x!==ra?Z():(h.label=aa(),ma());for(var n=0;n<G.length;++n){var w=G[n];if(null===h.label||w.name===h.label.name){if(null!==w.kind&&(l||"loop"===w.kind))break;if(h.label&&l)break}}n===G.length&&c(h.start,"Unsyntactic "+f.l);return y(h,l?"BreakStatement":"ContinueStatement");case fc:return B(),ma(),y(h,"DebuggerStatement");case gc:return B(),
G.push(nb),h.body=U(),G.pop(),F(ob),h.test=Da(),ma(),y(h,"DoWhileStatement");case hc:B();G.push(nb);F(X);if(x===Y)return pb(h,null);if(x===qb)return f=M(),B(),ic(f,!0),y(f,"VariableDeclaration"),1===f.ia.length&&E($a)?jc(h,f):pb(h,f);f=N(!1,!0);return E($a)?(Ya(f),jc(h,f)):pb(h,f);case rb:return B(),sb(h,!0);case kc:return B(),h.test=Da(),h.fa=U(),h.alternate=E(lc)?U():null,y(h,"IfStatement");case mc:return Ea||z.Gb||c(I,"'return' outside of function"),B(),E(Y)||Xa()?h.J=null:(h.J=N(),ma()),y(h,"ReturnStatement");
case tb:B();h.Nb=Da();h.tb=[];F(za);for(G.push(Xc);x!==pa;)x===ub||x===nc?(f=x===ub,n&&y(n,"SwitchCase"),h.tb.push(n=M()),n.fa=[],B(),f?n.test=N():(l&&c(hb,"Multiple default clauses"),l=!0,n.test=null),F(Aa)):(n||Z(),n.fa.push(U()));n&&y(n,"SwitchCase");B();G.pop();return y(h,"SwitchStatement");case oc:return B(),Wa.test(r.slice(fa,I))&&c(fa,"Illegal newline after throw"),h.J=N(),ma(),y(h,"ThrowStatement");case pc:return B(),h.block=Fa(),h.Ha=null,x===qc&&(f=M(),B(),F(X),f.Wa=aa(),S&&Za(f.Wa.name)&&
c(f.Wa.start,"Binding "+f.Wa.name+" in strict mode"),F(V),f.body=Fa(),h.Ha=y(f,"CatchClause")),h.ib=E(rc)?Fa():null,h.Ha||h.ib||c(h.start,"Missing catch or finally clause"),y(h,"TryStatement");case qb:return B(),ic(h),ma(),y(h,"VariableDeclaration");case ob:return B(),h.test=Da(),G.push(nb),h.body=U(),G.pop(),y(h,"WhileStatement");case sc:return S&&c(I,"'with' in strict mode"),B(),h.object=Da(),h.body=U(),y(h,"WithStatement");case za:return Fa();case Y:return B(),y(h,"EmptyStatement");default:l=T;
w=N();if(f===ra&&"Identifier"===w.type&&E(Aa)){for(n=0;n<G.length;++n)G[n].name===l&&c(w.start,"Label '"+l+"' is already declared");G.push({name:l,kind:x.ca?"loop":x===tb?"switch":null});h.body=U();G.pop();h.label=w;return y(h,"LabeledStatement")}h.pa=w;ma();return y(h,"ExpressionStatement")}}function Da(){F(X);var f=N();F(V);return f}function Fa(f){var h=M(),l=!0,n=!1;h.body=[];for(F(za);!E(pa);){var w=U();h.body.push(w);if(l&&f&&lb(w)){var K=n;jb(n=!0)}l=!1}n&&!K&&jb(!1);return y(h,"BlockStatement")}
function pb(f,h){f.za=h;F(Y);f.test=x===Y?null:N();F(Y);f.update=x===V?null:N();F(V);f.body=U();G.pop();return y(f,"ForStatement")}function jc(f,h){f.left=h;f.right=N();F(V);f.body=U();G.pop();return y(f,"ForInStatement")}function ic(f,h){f.ia=[];for(f.kind="var";;){var l=M();l.id=aa();S&&Za(l.id.name)&&c(l.id.start,"Binding "+l.id.name+" in strict mode");l.za=E(Yb)?N(!0,h):null;f.ia.push(y(l,"VariableDeclarator"));if(!E(ea))break}}function N(f,h){var l=vb(h);if(!f&&x===ea){f=ia(l);for(f.xb=[l];E(ea);)f.xb.push(vb(h));
return y(f,"SequenceExpression")}return l}function vb(f){var h=wb(xb(),-1,f);if(E(Tb)){var l=ia(h);l.test=h;l.fa=N(!0);F(Aa);l.alternate=N(!0,f);h=y(l,"ConditionalExpression")}return x.Bb?(l=ia(h),l.operator=T,l.left=h,B(),l.right=vb(f),Ya(h),y(l,"AssignmentExpression")):h}function wb(f,h,l){var n=x.K;if(null!==n&&(!l||x!==$a)&&n>h){var w=ia(f);w.left=f;w.operator=T;f=x;B();w.right=wb(xb(),n,l);n=y(w,f===Wb||f===Xb?"LogicalExpression":"BinaryExpression");return wb(n,h,l)}return f}function xb(){if(x.prefix){var f=
M(),h=x.Yb;f.operator=T;ya=f.prefix=!0;B();f.J=xb();h?Ya(f.J):S&&"delete"===f.operator&&"Identifier"===f.J.type&&c(f.start,"Deleting local variable in strict mode");return y(f,h?"UpdateExpression":"UnaryExpression")}for(h=Ga(ab());x.ac&&!Xa();)f=ia(h),f.operator=T,f.prefix=!1,f.J=h,Ya(h),B(),h=y(f,"UpdateExpression");return h}function Ga(f,h){if(E(Sb)){var l=ia(f);l.object=f;l.Ya=aa(!0);l.fb=!1;return Ga(y(l,"MemberExpression"),h)}return E(db)?(l=ia(f),l.object=f,l.Ya=N(),l.fb=!0,F(eb),Ga(y(l,"MemberExpression"),
h)):!h&&E(X)?(l=ia(f),l.callee=f,l.arguments=yb(V,!1),Ga(y(l,"CallExpression"),h)):f}function ab(){switch(x){case tc:var f=M();B();return y(f,"ThisExpression");case ra:return aa();case Ca:case Ua:case bc:return f=M(),f.value=T,f.raw=r.slice(I,na),B(),y(f,"Literal");case uc:case vc:case wc:return f=M(),f.value=x.cb,f.raw=x.l,B(),y(f,"Literal");case X:f=fb;var h=I;B();var l=N();l.start=h;l.end=na;z.D&&(l.O.start=f,l.O.end=cb);z.Za&&(l.j=[h,na]);F(V);return l;case db:return f=M(),B(),f.elements=yb(eb,
!0,!0),y(f,"ArrayExpression");case za:f=M();h=!0;l=!1;f.h=[];for(B();!E(pa);){if(h)h=!1;else if(F(ea),z.sb&&E(pa))break;var n={key:x===Ca||x===Ua?ab():aa(!0)},w=!1;if(E(Aa)){n.value=N(!0);var K=n.kind="init"}else"Identifier"!==n.key.type||"get"!==n.key.name&&"set"!==n.key.name?Z():(w=l=!0,K=n.kind=n.key.name,n.key=x===Ca||x===Ua?ab():aa(!0),x!==X&&Z(),n.value=sb(M(),!1));if("Identifier"===n.key.type&&(S||l))for(var O=0;O<f.h.length;++O){var sa=f.h[O];if(sa.key.name===n.key.name){var zb=K===sa.kind||
w&&"init"===sa.kind||"init"===K&&("get"===sa.kind||"set"===sa.kind);zb&&!S&&"init"===K&&"init"===sa.kind&&(zb=!1);zb&&c(n.key.start,"Redefinition of property")}}f.h.push(n)}return y(f,"ObjectExpression");case rb:return f=M(),B(),sb(f,!1);case xc:return f=M(),B(),f.callee=Ga(ab(),!0),f.arguments=E(X)?yb(V,!1):Yc,y(f,"NewExpression")}Z()}function sb(f,h){x===ra?f.id=aa():h?Z():f.id=null;f.sa=[];var l=!0;for(F(X);!E(V);)l?l=!1:F(ea),f.sa.push(aa());l=Ea;var n=G;Ea=!0;G=[];f.body=Fa(!0);Ea=l;G=n;if(S||
f.body.body.length&&lb(f.body.body[0]))for(l=f.id?-1:0;l<f.sa.length;++l)if(n=0>l?f.id:f.sa[l],(yc(n.name)||Za(n.name))&&c(n.start,"Defining '"+n.name+"' in strict mode"),0<=l)for(var w=0;w<l;++w)n.name===f.sa[w].name&&c(n.start,"Argument name clash in strict mode");return y(f,h?"FunctionDeclaration":"FunctionExpression")}function yb(f,h,l){for(var n=[],w=!0;!E(f);){if(w)w=!1;else if(F(ea),h&&z.sb&&E(f))break;n.push(l&&x===ea?null:N(!0))}return n}function aa(f){var h=M();f&&"everywhere"===z.yb&&(f=
!1);x===ra?(!f&&(z.yb&&Zc(T)||S&&yc(T))&&-1===r.slice(I,na).indexOf("\\")&&c(I,"The keyword '"+T+"' is reserved"),h.name=T):f&&x.l?h.name=x.l:Z();ya=!1;B();return y(h,"Identifier")}a.version="0.5.0";var z,r="",oa,kb;a.parse=function(f,h){r=String(f);oa=r.length;z=h||{};for(var l in zc)Object.prototype.hasOwnProperty.call(z,l)||(z[l]=zc[l]);kb=z.sourceFile;ka=1;m=W=0;ya=!0;C();l=z.bc;hb=fa=m;z.D&&(ib=new g);Ea=S=!1;G=[];ha();f=l||M();h=!0;l||(f.body=[]);for(;x!==gb;)l=U(),f.body.push(l),h&&lb(l)&&
jb(!0),h=!1;return y(f,"Program")};var zc={ec:!1,sb:!0,yb:!1,Gb:!1,D:!1,Aa:null,Za:!1,bc:null,sourceFile:null,vb:null},m=0,I=0,na=0,fb,cb,x,T,ya,ka,W,hb=0,fa=0,ib,Ea,G,S,Yc=[],Ca={type:"num"},bc={type:"regexp"},Ua={type:"string"},ra={type:"name"},gb={type:"eof"},mb={l:"break"},ub={l:"case",m:!0},qc={l:"catch"},ec={l:"continue"},fc={l:"debugger"},nc={l:"default"},gc={l:"do",ca:!0},lc={l:"else",m:!0},rc={l:"finally"},hc={l:"for",ca:!0},rb={l:"function"},kc={l:"if"},mc={l:"return",m:!0},tb={l:"switch"},
oc={l:"throw",m:!0},pc={l:"try"},qb={l:"var"},ob={l:"while",ca:!0},sc={l:"with"},xc={l:"new",m:!0},tc={l:"this"},uc={l:"null",cb:null},vc={l:"true",cb:!0},wc={l:"false",cb:!1},$a={l:"in",K:7,m:!0},Wc={"break":mb,"case":ub,"catch":qc,"continue":ec,"debugger":fc,"default":nc,"do":gc,"else":lc,"finally":rc,"for":hc,"function":rb,"if":kc,"return":mc,"switch":tb,"throw":oc,"try":pc,"var":qb,"while":ob,"with":sc,"null":uc,"true":vc,"false":wc,"new":xc,"in":$a,"instanceof":{l:"instanceof",K:7,m:!0},"this":tc,
"typeof":{l:"typeof",prefix:!0,m:!0},"void":{l:"void",prefix:!0,m:!0},"delete":{l:"delete",prefix:!0,m:!0}},db={type:"[",m:!0},eb={type:"]"},za={type:"{",m:!0},pa={type:"}"},X={type:"(",m:!0},V={type:")"},ea={type:",",m:!0},Y={type:";",m:!0},Aa={type:":",m:!0},Sb={type:"."},Tb={type:"?",m:!0},Vb={K:10,m:!0},Yb={Bb:!0,m:!0},la={Bb:!0,m:!0},Qc={ac:!0,prefix:!0,Yb:!0},Zb={prefix:!0,m:!0},Wb={K:1,m:!0},Xb={K:2,m:!0},Nc={K:3,m:!0},Pc={K:4,m:!0},Oc={K:5,m:!0},Uc={K:6,m:!0},Tc={K:7,m:!0},Sc={K:8,m:!0},Rc=
{K:9,prefix:!0,m:!0},Mc={K:10,m:!0},Zc=e("class enum extends super const export import"),yc=e("implements interface let package private protected public static yield"),Za=e("eval arguments"),Vc=e("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this"),Lc=/[\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\ufeff]/,Qb=RegExp("[\u00aa\u00b5\u00ba\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0\u08a2-\u08ac\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097f\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d\u0c58\u0c59\u0c60\u0c61\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d60\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191c\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19c1-\u19c7\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua697\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa80-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc]"),
Kc=RegExp("[\u00aa\u00b5\u00ba\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0\u08a2-\u08ac\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097f\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d\u0c58\u0c59\u0c60\u0c61\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d60\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191c\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19c1-\u19c7\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua697\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa80-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc\u0300-\u036f\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u0620-\u0649\u0672-\u06d3\u06e7-\u06e8\u06fb-\u06fc\u0730-\u074a\u0800-\u0814\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0840-\u0857\u08e4-\u08fe\u0900-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962-\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09d7\u09df-\u09e0\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2-\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b5f-\u0b60\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c01-\u0c03\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62-\u0c63\u0c66-\u0c6f\u0c82\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2-\u0ce3\u0ce6-\u0cef\u0d02\u0d03\u0d46-\u0d48\u0d57\u0d62-\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e34-\u0e3a\u0e40-\u0e45\u0e50-\u0e59\u0eb4-\u0eb9\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f41-\u0f47\u0f71-\u0f84\u0f86-\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u1029\u1040-\u1049\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u170e-\u1710\u1720-\u1730\u1740-\u1750\u1772\u1773\u1780-\u17b2\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u1920-\u192b\u1930-\u193b\u1951-\u196d\u19b0-\u19c0\u19c8-\u19c9\u19d0-\u19d9\u1a00-\u1a15\u1a20-\u1a53\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1b46-\u1b4b\u1b50-\u1b59\u1b6b-\u1b73\u1bb0-\u1bb9\u1be6-\u1bf3\u1c00-\u1c22\u1c40-\u1c49\u1c5b-\u1c7d\u1cd0-\u1cd2\u1d00-\u1dbe\u1e01-\u1f15\u200c\u200d\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2d81-\u2d96\u2de0-\u2dff\u3021-\u3028\u3099\u309a\ua640-\ua66d\ua674-\ua67d\ua69f\ua6f0-\ua6f1\ua7f8-\ua800\ua806\ua80b\ua823-\ua827\ua880-\ua881\ua8b4-\ua8c4\ua8d0-\ua8d9\ua8f3-\ua8f7\ua900-\ua909\ua926-\ua92d\ua930-\ua945\ua980-\ua983\ua9b3-\ua9c0\uaa00-\uaa27\uaa40-\uaa41\uaa4c-\uaa4d\uaa50-\uaa59\uaa7b\uaae0-\uaae9\uaaf2-\uaaf3\uabc0-\uabe1\uabec\uabed\uabf0-\uabf9\ufb20-\ufb28\ufe00-\ufe0f\ufe20-\ufe26\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f]"),
Wa=/[\n\r\u2028\u2029]/,Ta=/\r\n|[\n\r\u2028\u2029]/g,qa,nb={kind:"loop"},Xc={kind:"switch"}};"object"===typeof exports&&"object"===typeof module?ca(exports):"function"===typeof define&&define.ic?define(["exports"],ca):ca(ba.j||(ba.j={}));/*

 Copyright 2013 Neil Fraser
 SPDX-License-Identifier: Apache-2.0
*/
function t(a,b){"string"===typeof a&&(a=da(a,"code"));var d=a.constructor;this.Da=function(){return new d({options:{}})};var c=this.Da(),e;for(e in a)c[e]="body"===e?a[e].slice():a[e];this.va=c;this.$=[];this.qb=b;this.wa=!1;this.Z=[];this.ab=0;this.rb=Object.create(null);a=/^step([A-Z]\w*)$/;var g,k;for(k in this)"function"===typeof this[k]&&(g=k.match(a))&&(this.rb[g[1]]=this[k].bind(this));this.M=ja(this,this.va,null);this.Qa=this.M.object;this.va=da(this.Z.join("\n"),"polyfills");this.Z=void 0;
ta(this.va);g=new u(this.va,this.M);g.done=!1;this.j=[g];this.Cb();this.value=void 0;this.va=c;g=new u(this.va,this.M);g.done=!1;this.j.length=0;this.j[0]=g}
var ua={DONE:0,STEP:1,TASK:2,ASYNC:3},va={D:!0,jc:5},wa={configurable:!0,enumerable:!0,writable:!1},v={configurable:!0,enumerable:!1,writable:!0},A={configurable:!0,enumerable:!1,writable:!1},xa={configurable:!1,enumerable:!1,writable:!1},Ha={configurable:!1,enumerable:!0,writable:!0},Ia={STEP_ERROR:!0},Ja={SCOPE_REFERENCE:!0},Ka={VALUE_IN_DESCRIPTOR:!0},La={REGEXP_TIMEOUT:!0},Ma=[],Na=null,Oa=null,Pa="undefined"===typeof globalThis?this||window:globalThis,Qa=["onmessage = function(e) {","var result;",
"var data = e.data;","switch (data[0]) {","case 'split':","result = data[1].split(data[2], data[3]);","break;","case 'match':","result = data[1].match(data[2]);","break;","case 'search':","result = data[1].search(data[2]);","break;","case 'replace':","result = data[1].replace(data[2], data[3]);","break;","case 'exec':","var regexp = data[1];","regexp.lastIndex = data[2];","result = [regexp.exec(data[3]), data[1].lastIndex];","break;","default:","throw Error('Unknown RegExp operation: ' + data[0]);",
"}","postMessage(result);","close();","};"];function Ra(a){var b=a>>>0;return b===Number(a)?b:NaN}function Sa(a){var b=a>>>0;return String(b)===String(a)&&4294967295!==b?b:NaN}function ta(a,b,d){b?a.start=b:delete a.start;d?a.end=d:delete a.end;for(var c in a)if(a[c]!==a.O&&a.hasOwnProperty(c)){var e=a[c];e&&"object"===typeof e&&ta(e,b,d)}}t.prototype.REGEXP_MODE=2;t.prototype.REGEXP_THREAD_TIMEOUT=1E3;t.prototype.POLYFILL_TIMEOUT=1E3;p=t.prototype;p.R=!1;p.Ma=!1;p.Ib=0;p.hc=0;
function da(a,b){var d={},c;for(c in va)d[c]=va[c];d.sourceFile=b;return Pa.j.parse(a,d)}p.Hb=function(a){var b=this.j[0];if(!b||"Program"!==b.node.type)throw Error("Expecting original AST to start with a Program node");"string"===typeof a&&(a=da(a,"appendCode"+this.Ib++));if(!a||"Program"!==a.type)throw Error("Expecting new AST to start with a Program node");bb(this,a,b.scope);Array.prototype.push.apply(b.node.body,a.body);b.node.body.lb=null;b.done=!1};
p.nb=function(){var a=this.j,b;do{var d=a[a.length-1];if(this.wa)break;else if(!d||"Program"===d.node.type&&d.done){if(!this.$.length)return!1;d=this.$[0];if(!d||d.time>Date.now())d=null;else{this.$.shift();0<=d.j&&Ab(this,d,d.j);var c=new u(d.node,d.scope);d.o&&(c.ma=2,c.C=this.Qa,c.aa=d.o,c.Ta=!0,c.G=d.A);d=c}if(!d)break}c=d.node;var e=Oa;Oa=this;try{var g=this.rb[c.type](a,d,c)}catch(k){if(k!==Ia)throw this.value!==k&&(this.value=void 0),k;}finally{Oa=e}g&&a.push(g);if(this.R)throw this.value=
void 0,Error("Getter not supported in this context");if(this.Ma)throw this.value=void 0,Error("Setter not supported in this context");b||c.end||(b=Date.now()+this.POLYFILL_TIMEOUT)}while(!c.end&&b>Date.now());return!0};p.Cb=function(){for(;!this.wa&&this.nb(););return this.wa};p.Wb=function(){if(this.wa)return ua.ASYNC;var a=this.j;return!(a=a[a.length-1])||"Program"===a.node.type&&a.done?(a=this.$[0])?a.time>Date.now()?ua.TASK:ua.STEP:ua.DONE:ua.STEP};
function Bb(a,b){a.g(b,"NaN",NaN,xa);a.g(b,"Infinity",Infinity,xa);a.g(b,"undefined",void 0,xa);a.g(b,"window",b,wa);a.g(b,"this",b,xa);a.g(b,"self",b);a.L=new D(null);a.X=new D(a.L);Cb(a,b);Db(a,b);b.Ca=a.L;a.g(b,"constructor",a.u,v);Eb(a,b);Fb(a,b);Gb(a,b);Hb(a,b);Ib(a,b);Jb(a,b);Kb(a,b);Lb(a,b);Mb(a,b);var d=a.i(function(){throw EvalError("Can't happen");},!1);d.eval=!0;a.g(b,"eval",d,v);a.g(b,"parseInt",a.i(parseInt,!1),v);a.g(b,"parseFloat",a.i(parseFloat,!1),v);a.g(b,"isNaN",a.i(isNaN,!1),v);
a.g(b,"isFinite",a.i(isFinite,!1),v);for(var c=[[escape,"escape"],[unescape,"unescape"],[decodeURI,"decodeURI"],[decodeURIComponent,"decodeURIComponent"],[encodeURI,"encodeURI"],[encodeURIComponent,"encodeURIComponent"]],e=0;e<c.length;e++)d=function(g){return function(k){try{return g(k)}catch(q){H(a,a.Eb,q.message)}}}(c[e][0]),a.g(b,c[e][1],a.i(d,!1),v);d=function(g){return Nb(a,!1,arguments)};a.g(b,"setTimeout",a.i(d,!1),v);d=function(g){return Nb(a,!0,arguments)};a.g(b,"setInterval",a.i(d,!1),
v);d=function(g){Ob(a,g)};a.g(b,"clearTimeout",a.i(d,!1),v);d=function(g){Ob(a,g)};a.g(b,"clearInterval",a.i(d,!1),v);a.OBJECT=a.u;a.OBJECT_PROTO=a.L;a.FUNCTION=a.P;a.FUNCTION_PROTO=a.X;a.ARRAY=a.ua;a.ARRAY_PROTO=a.Na;a.REGEXP=a.I;a.REGEXP_PROTO=a.Pa;a.DATE=a.W;a.DATE_PROTO=a.ob;a.qb&&a.qb(a,b)}p.Tb=0;
function Cb(a,b){var d=/^[A-Za-z_$][\w$]*$/;var c=function(e){var g=arguments.length?String(arguments[arguments.length-1]):"",k=Array.prototype.slice.call(arguments,0,-1).join(",").trim();if(k){k=k.split(/\s*,\s*/);for(var q=0;q<k.length;q++){var C=k[q];d.test(C)||H(a,a.Y,"Invalid function argument: "+C)}k=k.join(", ")}try{var R=da("(function("+k+") {"+g+"})","function"+a.Tb++)}catch(ha){H(a,a.Y,"Invalid code: "+ha.message)}1!==R.body.length&&H(a,a.Y,"Invalid code in function body");return Pb(a,R.body[0].pa,
a.M,"anonymous")};a.P=a.i(c,!0);a.g(b,"Function",a.P,v);a.g(a.P,"prototype",a.X,v);a.g(a.X,"constructor",a.P,v);a.X.Va=function(){};a.X.Va.id=a.ab++;a.X.zb=!0;a.g(a.X,"length",0,A);a.X.H="Function";c=function(e,g,k){var q=a.j[a.j.length-1];q.aa=e;q.C=g;q.G=[];null!==k&&void 0!==k&&(k instanceof D?q.G=Array.from(k.h):H(a,a.o,"CreateListFromArrayLike called on non-object"));q.hb=!1};J(a,a.P,"apply",c);a.Z.push("(function(){var d=Function.prototype.apply;Function.prototype.apply=function(e,b){for(var c=[],a=0;b&&a<b.length;a++)c[a]=b[a];return d(this,e,c)}})();");
c=function(e){var g=a.j[a.j.length-1];g.aa=this;g.C=e;g.G=[];for(var k=1;k<arguments.length;k++)g.G.push(arguments[k]);g.hb=!1};J(a,a.P,"call",c);a.Z.push('Object.defineProperty(Function.prototype,"bind",{configurable:!0,writable:!0,value:function(c){if("function"!==typeof this)throw TypeError("What is trying to be bound is not callable");var d=Array.prototype.slice.call(arguments,1),e=this,a=function(){},b=function(){return e.apply(this instanceof a?this:c,d.concat(Array.prototype.slice.call(arguments)))};this.prototype&&(a.prototype=this.prototype);b.prototype=new a;return b}});');
c=function(){return String(this)};J(a,a.P,"toString",c);a.g(a.P,"toString",a.i(c,!1),v);c=function(){return this.valueOf()};J(a,a.P,"valueOf",c);a.g(a.P,"valueOf",a.i(c,!1),v)}
function Db(a,b){function d(e){void 0!==e&&null!==e||H(a,a.o,"Cannot convert '"+e+"' to object")}var c=function(e){if(void 0===e||null===e)return Ac(a)?this:a.s(a.L);if(!(e instanceof D)){var g=a.s(Bc(a,e));g.data=e;return g}return e};a.u=a.i(c,!0);a.g(a.u,"prototype",a.L,v);a.g(a.L,"constructor",a.u,v);a.g(b,"Object",a.u,v);c=function(e){d(e);return a.S(Object.getOwnPropertyNames(e instanceof D?e.h:e))};a.g(a.u,"getOwnPropertyNames",a.i(c,!1),v);c=function(e){d(e);e instanceof D&&(e=e.h);return a.S(Object.keys(e))};
a.g(a.u,"keys",a.i(c,!1),v);c=function(e){if(null===e)return a.s(null);e instanceof D||H(a,a.o,"Object prototype may only be an Object or null, not "+e);return a.s(e)};a.g(a.u,"create",a.i(c,!1),v);a.Z.push("(function(){var c=Object.create;Object.create=function(a,b){a=c(a);b&&Object.defineProperties(a,b);return a}})();");c=function(e,g,k){g=String(g);e instanceof D||H(a,a.o,"Object.defineProperty called on non-object: "+e);k instanceof D||H(a,a.o,"Property description must be an object");!e.preventExtensions||
g in e.h||H(a,a.o,"Can't define property '"+g+"', object is not extensible");a.g(e,g,Ka,k.h);return e};a.g(a.u,"defineProperty",a.i(c,!1),v);a.Z.push('(function(){var d=Object.defineProperty;Object.defineProperty=function(e,c,a){var b={};"configurable"in a&&(b.configurable=a.configurable);"enumerable"in a&&(b.enumerable=a.enumerable);"writable"in a&&(b.writable=a.writable);"value"in a&&(b.value=a.value);"get"in a&&(b.get=a.get);"set"in a&&(b.set=a.set);return d(e,c,b)}})();\nObject.defineProperty(Object,"defineProperties",{configurable:!0,writable:!0,value:function(d,e){for(var c=Object.keys(e),a=0;a<c.length;a++)Object.defineProperty(d,c[a],e[c[a]]);return d}});');
c=function(e,g){e instanceof D||H(a,a.o,"Object.getOwnPropertyDescriptor called on non-object: "+e);g=String(g);if(g in e.h){var k=Object.getOwnPropertyDescriptor(e.h,g),q=e.ba[g];e=e.ea[g];g=a.s(a.L);q||e?(a.g(g,"get",q),a.g(g,"set",e)):(a.g(g,"value",k.value),a.g(g,"writable",k.writable));a.g(g,"configurable",k.configurable);a.g(g,"enumerable",k.enumerable);return g}};a.g(a.u,"getOwnPropertyDescriptor",a.i(c,!1),v);c=function(e){d(e);return Bc(a,e)};a.g(a.u,"getPrototypeOf",a.i(c,!1),v);c=function(e){return!!e&&
!e.preventExtensions};a.g(a.u,"isExtensible",a.i(c,!1),v);c=function(e){e instanceof D&&(e.preventExtensions=!0);return e};a.g(a.u,"preventExtensions",a.i(c,!1),v);J(a,a.u,"toString",D.prototype.toString);J(a,a.u,"toLocaleString",D.prototype.toString);J(a,a.u,"valueOf",D.prototype.valueOf);c=function(e){d(this);return this instanceof D?String(e)in this.h:this.hasOwnProperty(e)};J(a,a.u,"hasOwnProperty",c);c=function(e){d(this);return this instanceof D?Object.prototype.propertyIsEnumerable.call(this.h,
e):this.propertyIsEnumerable(e)};J(a,a.u,"propertyIsEnumerable",c);c=function(e){for(;;){e=Bc(a,e);if(!e)return!1;if(e===this)return!0}};J(a,a.u,"isPrototypeOf",c)}
function Eb(a,b){var d=function(c){var e=Ac(a)?this:Cc(a),g=arguments[0];if(1===arguments.length&&"number"===typeof g)isNaN(Ra(g))&&H(a,a.$a,"Invalid array length: "+g),e.h.length=g;else{for(g=0;g<arguments.length;g++)e.h[g]=arguments[g];e.h.length=g}return e};a.ua=a.i(d,!0);a.Na=a.ua.h.prototype;a.g(b,"Array",a.ua,v);d=function(c){return c&&"Array"===c.H};a.g(a.ua,"isArray",a.i(d,!1),v);a.g(a.Na,"length",0,{configurable:!1,enumerable:!1,writable:!0});a.Na.H="Array";a.Z.push('(function(){function g(c,b){Object.defineProperty(b,"name",{value:c});Object.defineProperty(Array.prototype,c,{configurable:!0,writable:!0,value:b})}g("pop",function(){if(!this)throw TypeError();var c=Object(this),b=c.length>>>0;if(!b||0>b)c.length=0;else{b--;var d=c[b];delete c[b];c.length=b;return d}});g("push",function(c){if(!this)throw TypeError();for(var b=Object(this),d=b.length>>>0,a=0;a<arguments.length;a++)b[d]=arguments[a],d++;return b.length=d});g("shift",function(){if(!this)throw TypeError();\nvar c=Object(this),b=c.length>>>0;if(!b||0>b)c.length=0;else{for(var d=c[0],a=0;a<b-1;a++)a+1 in c?c[a]=c[a+1]:delete c[a];delete c[a];c.length=b-1;return d}});g("unshift",function(c){if(!this)throw TypeError();var b=Object(this),d=b.length>>>0;if(!d||0>d)d=0;for(var a=d-1;0<=a;a--)a in b?b[a+arguments.length]=b[a]:delete b[a+arguments.length];for(a=0;a<arguments.length;a++)b[a]=arguments[a];return b.length=d+arguments.length});g("reverse",function(){if(!this)throw TypeError();var c=Object(this),\nb=c.length>>>0;if(!b||2>b)return c;for(var d=0;d<b/2-.5;d++){var a=c[d],e=d in c;b-d-1 in c?c[d]=c[b-d-1]:delete c[d];e?c[b-d-1]=a:delete c[b-d-1]}return c});g("indexOf",function(c,b){if(!this)throw TypeError();var d=Object(this),a=d.length>>>0;b|=0;if(!a||b>=a)return-1;for(b=Math.max(0<=b?b:a-Math.abs(b),0);b<a;){if(b in d&&d[b]===c)return b;b++}return-1});g("lastIndexOf",function(c,b){if(!this)throw TypeError();var d=Object(this),a=d.length>>>0;if(!a)return-1;var e=a-1;1<arguments.length&&(e=b|\n0)&&(e=(0<e||-1)*Math.floor(Math.abs(e)));for(a=0<=e?Math.min(e,a-1):a-Math.abs(e);0<=a;){if(a in d&&d[a]===c)return a;a--}return-1});g("slice",function(c,b){if(!this)throw TypeError();var d=Object(this),a=d.length>>>0;c|=0;c=0<=c?c:Math.max(0,a+c);"undefined"!==typeof b?(Infinity!==b&&(b|=0),b=0>b?a+b:Math.min(b,a)):b=a;b-=c;a=Array(b);for(var e=0;e<b;e++)c+e in d&&(a[e]=d[c+e]);return a});g("splice",function(c,b,d){if(!this)throw TypeError();var a=Object(this),e=a.length>>>0;c|=0;c=0>c?Math.max(e+\nc,0):Math.min(c,e);b=2>arguments.length?e-c:Math.max(0,Math.min(b|0,e-c));for(var h=[],f=c;f<c+b;f++)f in a?h.push(a[f]):h.length++,f+b in a?a[f]=a[f+b]:delete a[f];for(f=c+b;f<e-b;f++)f+b in a?a[f]=a[f+b]:delete a[f];for(f=e-b;f<e;f++)delete a[f];e-=b;if(2<arguments.length){var k=arguments.length-2;for(f=e-1;f>=c;f--)f in a?a[f+k]=a[f]:delete a[f+k];e+=k;for(f=2;f<arguments.length;f++)a[c+f-2]=arguments[f]}a.length=e;return h});g("concat",function(c){if(!this)throw TypeError();for(var b=Object(this),\nd=[],a=-1;a<arguments.length;a++){var e=-1===a?b:arguments[a];if(Array.isArray(e))for(var h=0,f=e.length;h<f;h++)h in e?d.push(e[h]):d.length++;else d.push(e)}return d});g("join",function(c){if(!this)throw TypeError();var b=Object(this),d=b.length>>>0;c="undefined"===typeof c?",":""+c;for(var a="",e=0;e<d;e++)e&&c&&(a+=c),a+=null===b[e]||void 0===b[e]?"":b[e];return a});g("every",function(c,b){if(!this||"function"!==typeof c)throw TypeError();var d,a=0,e=Object(this),h=e.length>>>0;for(1<arguments.length&&\n(d=b);a<h;){if(a in e&&!c.call(d,e[a],a,e))return!1;a++}return!0});g("filter",function(c,b){if(!this||"function"!==typeof c)throw TypeError();for(var d=Object(this),a=d.length>>>0,e=[],h=2<=arguments.length?arguments[1]:void 0,f=0;f<a;f++)if(f in d){var k=d[f];c.call(h,k,f,d)&&e.push(k)}return e});g("forEach",function(c,b){if(!this||"function"!==typeof c)throw TypeError();var d,a=0,e=Object(this),h=e.length>>>0;for(1<arguments.length&&(d=b);a<h;)a in e&&c.call(d,e[a],a,e),a++});g("map",function(c,\nb){if(!this||"function"!==typeof c)throw TypeError();var d,a=0,e=Object(this),h=e.length>>>0;1<arguments.length&&(d=b);for(var f=Array(h);a<h;)a in e&&(f[a]=c.call(d,e[a],a,e)),a++;return f});g("reduce",function(c){if(!this||"function"!==typeof c)throw TypeError();var b=Object(this),d=b.length>>>0,a=0;if(2===arguments.length)var e=arguments[1];else{for(;a<d&&!(a in b);)a++;if(a>=d)throw TypeError("Reduce of empty array with no initial value");e=b[a++]}for(;a<d;a++)a in b&&(e=c(e,b[a],a,b));return e});\ng("reduceRight",function(c){if(!this||"function"!==typeof c)throw TypeError();var b=Object(this),d=(b.length>>>0)-1;if(2<=arguments.length)var a=arguments[1];else{for(;0<=d&&!(d in b);)d--;if(0>d)throw TypeError("Reduce of empty array with no initial value");a=b[d--]}for(;0<=d;d--)d in b&&(a=c(a,b[d],d,b));return a});g("some",function(c){if(!this||"function"!==typeof c)throw TypeError();for(var b=Object(this),d=b.length>>>0,a=2<=arguments.length?arguments[1]:void 0,e=0;e<d;e++)if(e in b&&c.call(a,\nb[e],e,b))return!0;return!1});g("sort",function(c){if(!this)throw TypeError();"function"!==typeof c&&(c=void 0);for(var b=0;b<this.length;b++){for(var d=0,a=0;a<this.length-b-1;a++)if(c?0<c(this[a],this[a+1]):String(this[a])>String(this[a+1])){var e=this[a],h=a in this;a+1 in this?this[a]=this[a+1]:delete this[a];h?this[a+1]=e:delete this[a+1];d++}if(!d)break}return this});g("toLocaleString",function(){if(!this)throw TypeError();for(var c=Object(this),b=c.length>>>0,d=[],a=0;a<b;a++)d[a]=null===c[a]||\nvoid 0===c[a]?"":c[a].toLocaleString();return d.join(",")})})();')}
function Fb(a,b){var d=function(c){c=arguments.length?Pa.String(c):"";return Ac(a)?(this.data=c,this):c};a.F=a.i(d,!0);a.g(b,"String",a.F,v);a.g(a.F,"fromCharCode",a.i(String.fromCharCode,!1),v);b="charAt charCodeAt concat indexOf lastIndexOf slice substr substring toLocaleLowerCase toLocaleUpperCase toLowerCase toUpperCase trim".split(" ");for(d=0;d<b.length;d++)J(a,a.F,b[d],String.prototype[b[d]]);d=function(c,e,g){e=a.T(e);g=a.T(g);try{return String(this).localeCompare(c,e,g)}catch(k){H(a,a.A,
"localeCompare: "+k.message)}};J(a,a.F,"localeCompare",d);d=function(c,e,g){var k=String(this);e=e?Number(e):void 0;if(P(a,c,a.I)&&(c=c.data,Dc(a,c,g),2===a.REGEXP_MODE)){if(Na)c=Ec(a,"string.split(separator, limit)",{string:k,separator:c,limit:e},c,g),c!==La&&g(a.S(c));else{var q=a.la(),C=Fc(a,c,q,g);q.onmessage=function(R){clearTimeout(C);g(a.S(R.data))};q.postMessage(["split",k,c,e])}return}c=k.split(c,e);g(a.S(c))};Gc(a,a.F,"split",d);d=function(c,e){var g=String(this);c=P(a,c,a.I)?c.data:new RegExp(c);
Dc(a,c,e);if(2===a.REGEXP_MODE)if(Na)c=Ec(a,"string.match(regexp)",{string:g,regexp:c},c,e),c!==La&&e(c&&Hc(a,c));else{var k=a.la(),q=Fc(a,c,k,e);k.onmessage=function(C){clearTimeout(q);e(C.data&&Hc(a,C.data))};k.postMessage(["match",g,c])}else c=g.match(c),e(c&&Hc(a,c))};Gc(a,a.F,"match",d);d=function(c,e){var g=String(this);P(a,c,a.I)?c=c.data:c=new RegExp(c);Dc(a,c,e);if(2===a.REGEXP_MODE)if(Na)c=Ec(a,"string.search(regexp)",{string:g,regexp:c},c,e),c!==La&&e(c);else{var k=a.la(),q=Fc(a,c,k,e);
k.onmessage=function(C){clearTimeout(q);e(C.data)};k.postMessage(["search",g,c])}else e(g.search(c))};Gc(a,a.F,"search",d);d=function(c,e,g){var k=String(this);e=String(e);if(P(a,c,a.I)&&(c=c.data,Dc(a,c,g),2===a.REGEXP_MODE)){if(Na)c=Ec(a,"string.replace(substr, newSubstr)",{string:k,substr:c,newSubstr:e},c,g),c!==La&&g(c);else{var q=a.la(),C=Fc(a,c,q,g);q.onmessage=function(R){clearTimeout(C);g(R.data)};q.postMessage(["replace",k,c,e])}return}g(k.replace(c,e))};Gc(a,a.F,"replace",d);a.Z.push('(function(){var g=String.prototype.replace;String.prototype.replace=function(c,e){if("function"!==typeof e)return g.call(this,c,e);var b=this;if(c instanceof RegExp){for(var d=[],a=c.exec(b);a;){a.push(a.index,b);var f=e.apply(null,a);d.push([a.index,a[0].length,f]);a=c.global?c.exec(b):null}for(a=d.length-1;0<=a;a--)b=b.substring(0,d[a][0])+d[a][2]+b.substring(d[a][0]+d[a][1])}else a=b.indexOf(c),-1!==a&&(f=e(b.substr(a,c.length),a,b),b=b.substring(0,a)+f+b.substring(a+c.length));return b}})();')}
function Gb(a,b){a.Oa=a.i(function(d){d=Pa.Boolean(d);return Ac(a)?(this.data=d,this):d},!0);a.g(b,"Boolean",a.Oa,v)}
function Hb(a,b){var d=function(c){c=arguments.length?Pa.Number(c):0;return Ac(a)?(this.data=c,this):c};a.V=a.i(d,!0);a.g(b,"Number",a.V,v);b=["MAX_VALUE","MIN_VALUE","NaN","NEGATIVE_INFINITY","POSITIVE_INFINITY"];for(d=0;d<b.length;d++)a.g(a.V,b[d],Number[b[d]],xa);d=function(c){try{return Number(this).toExponential(c)}catch(e){H(a,a.A,e.message)}};J(a,a.V,"toExponential",d);d=function(c){try{return Number(this).toFixed(c)}catch(e){H(a,a.A,e.message)}};J(a,a.V,"toFixed",d);d=function(c){try{return Number(this).toPrecision(c)}catch(e){H(a,
a.A,e.message)}};J(a,a.V,"toPrecision",d);d=function(c){try{return Number(this).toString(c)}catch(e){H(a,a.A,e.message)}};J(a,a.V,"toString",d);d=function(c,e){c=c?a.T(c):void 0;e=e?a.T(e):void 0;try{return Number(this).toLocaleString(c,e)}catch(g){H(a,a.A,"toLocaleString: "+g.message)}};J(a,a.V,"toLocaleString",d)}
function Ib(a,b){var d=function(e,g){if(!Ac(a))return Pa.Date();var k=[null].concat(Array.from(arguments));this.data=new (Function.prototype.bind.apply(Pa.Date,k));return this};a.W=a.i(d,!0);a.ob=a.W.h.prototype;a.g(b,"Date",a.W,v);a.g(a.W,"now",a.i(Date.now,!1),v);a.g(a.W,"parse",a.i(Date.parse,!1),v);a.g(a.W,"UTC",a.i(Date.UTC,!1),v);b="getDate getDay getFullYear getHours getMilliseconds getMinutes getMonth getSeconds getTime getTimezoneOffset getUTCDate getUTCDay getUTCFullYear getUTCHours getUTCMilliseconds getUTCMinutes getUTCMonth getUTCSeconds getYear setDate setFullYear setHours setMilliseconds setMinutes setMonth setSeconds setTime setUTCDate setUTCFullYear setUTCHours setUTCMilliseconds setUTCMinutes setUTCMonth setUTCSeconds setYear toDateString toJSON toGMTString toLocaleDateString toLocaleString toLocaleTimeString toTimeString toUTCString".split(" ");
for(var c=0;c<b.length;c++)d=function(e){return function(g){var k=this.data;k instanceof Date||H(a,a.o,e+" not called on a Date");for(var q=[],C=0;C<arguments.length;C++)q[C]=a.T(arguments[C]);return k[e].apply(k,q)}}(b[c]),J(a,a.W,b[c],d);d=function(){try{return this.data.toISOString()}catch(e){H(a,a.$a,"toISOString: "+e.message)}};J(a,a.W,"toISOString",d)}
function Jb(a,b){var d=function(c,e){if(Ac(a))var g=this;else{if(void 0===e&&P(a,c,a.I))return c;g=a.s(a.Pa)}c=void 0===c?"":String(c);e=e?String(e):"";/^[gmi]*$/.test(e)||H(a,a.Y,"Invalid regexp flag: "+e);try{var k=new Pa.RegExp(c,e)}catch(q){H(a,a.Y,q.message)}Ic(a,g,k);return g};a.I=a.i(d,!0);a.Pa=a.I.h.prototype;a.g(b,"RegExp",a.I,v);a.g(a.I.h.prototype,"global",void 0,A);a.g(a.I.h.prototype,"ignoreCase",void 0,A);a.g(a.I.h.prototype,"multiline",void 0,A);a.g(a.I.h.prototype,"source","(?:)",
A);a.Z.push('Object.defineProperty(RegExp.prototype,"test",{configurable:!0,writable:!0,value:function(a){return!!this.exec(a)}});');d=function(c,e){var g=this.data;c=String(c);g.lastIndex=Number(a.N(this,"lastIndex"));Dc(a,g,e);if(2===a.REGEXP_MODE)if(Na)c=Ec(a,"regexp.exec(string)",{string:c,regexp:g},g,e),c!==La&&(a.g(this,"lastIndex",g.lastIndex),e(Hc(a,c)));else{var k=a.la(),q=Fc(a,g,k,e),C=this;k.onmessage=function(R){clearTimeout(q);a.g(C,"lastIndex",R.data[1]);e(Hc(a,R.data[0]))};k.postMessage(["exec",
g,g.lastIndex,c])}else c=g.exec(c),a.g(this,"lastIndex",g.lastIndex),e(Hc(a,c))};Gc(a,a.I,"exec",d)}function Hc(a,b){if(b){for(var d=Object.getOwnPropertyNames(b),c=0;c<d.length;c++){var e=d[c];isNaN(Number(e))&&"length"!==e&&"input"!==e&&"index"!==e&&delete b[e]}return a.S(b)}return null}
function Kb(a,b){function d(c){var e=a.i(function(g){var k=Ac(a)?this:a.ga(e);Jc(a,k,g);return k},!0);a.g(e,"prototype",a.ga(a.A),v);a.g(e.h.prototype,"name",c,v);a.g(b,c,e,v);return e}a.A=a.i(function(c){var e=Ac(a)?this:a.ga(a.A);Jc(a,e,c);return e},!0);a.g(b,"Error",a.A,v);a.g(a.A.h.prototype,"message","",v);a.g(a.A.h.prototype,"name","Error",v);d("EvalError");a.$a=d("RangeError");a.pb=d("ReferenceError");a.Y=d("SyntaxError");a.o=d("TypeError");a.Eb=d("URIError")}
function Lb(a,b){var d=a.s(a.L);a.g(b,"Math",d,v);var c="E LN2 LN10 LOG2E LOG10E PI SQRT1_2 SQRT2".split(" ");for(b=0;b<c.length;b++)a.g(d,c[b],Math[c[b]],A);c="abs acos asin atan atan2 ceil cos exp floor log max min pow random round sin sqrt tan".split(" ");for(b=0;b<c.length;b++)a.g(d,c[b],a.i(Math[c[b]],!1),v)}
function Mb(a,b){var d=a.s(a.L);a.g(b,"JSON",d,v);b=function(c){try{var e=JSON.parse(String(c))}catch(g){H(a,a.Y,g.message)}return a.S(e)};a.g(d,"parse",a.i(b,!1));b=function(c,e,g){e&&"Function"===e.H?H(a,a.o,"Function replacer on JSON.stringify not supported"):e&&"Array"===e.H?(e=a.T(e),e=e.filter(function(q){return"string"===typeof q||"number"===typeof q})):e=null;"string"!==typeof g&&"number"!==typeof g&&(g=void 0);c=a.T(c);try{var k=JSON.stringify(c,e,g)}catch(q){H(a,a.o,q.message)}return k};
a.g(d,"stringify",a.i(b,!1))}function P(a,b,d){if(null===b||void 0===b||!d)return!1;d=d.h.prototype;if(b===d)return!0;for(b=Bc(a,b);b;){if(b===d)return!0;b=b.Ca}return!1}function Ic(a,b,d){b.data=new RegExp(d.source,d.flags);a.g(b,"lastIndex",d.lastIndex,v);a.g(b,"source",d.source,A);a.g(b,"global",d.global,A);a.g(b,"ignoreCase",d.ignoreCase,A);a.g(b,"multiline",d.multiline,A)}
function Jc(a,b,d){d&&a.g(b,"message",String(d),v);d=[];for(var c=a.j.length-1;0<=c;c--){var e=a.j[c],g=e.node;"CallExpression"===g.type&&(e=e.aa)&&d.length&&(d[d.length-1].Lb=a.N(e,"name"));!g.O||d.length&&"CallExpression"!==g.type||d.push({Kb:g.O})}c=String(a.N(b,"name"));g=String(a.N(b,"message"));g=c+": "+g+"\n";for(c=0;c<d.length;c++){var k=d[c].Kb;e=d[c].Lb;k=k.source+":"+k.start.line+":"+k.start.eb;g=e?g+("  at "+e+" ("+k+")\n"):g+("  at "+k+"\n")}a.g(b,"stack",g.trim(),v)}
p.la=function(){var a=this.la.Jb;a||(a=new Blob([Qa.join("\n")],{type:"application/javascript"}),this.la.Jb=a);return new Worker(URL.createObjectURL(a))};function Ec(a,b,d,c,e){var g={timeout:a.REGEXP_THREAD_TIMEOUT};try{return Na.runInNewContext(b,d,g)}catch(k){e(null),H(a,a.A,"RegExp Timeout: "+c)}return La}
function Dc(a,b,d){if(0===a.REGEXP_MODE)var c=!1;else if(1===a.REGEXP_MODE)c=!0;else if(Na)c=!0;else if("function"===typeof Worker&&"function"===typeof URL)c=!0;else if("function"===typeof require){try{Na=require("vm")}catch(e){}c=!!Na}else c=!1;c||(d(null),H(a,a.A,"Regular expressions not supported: "+b))}function Fc(a,b,d,c){return setTimeout(function(){d.terminate();c(null);try{H(a,a.A,"RegExp Timeout: "+b)}catch(e){}},a.REGEXP_THREAD_TIMEOUT)}p.ga=function(a){return this.s(a&&a.h.prototype)};
p.s=function(a){if("object"!==typeof a)throw Error("Non object prototype");a=new D(a);P(this,a,this.A)&&(a.H="Error");return a};function Cc(a){var b=a.s(a.Na);a.g(b,"length",0,{configurable:!1,enumerable:!1,writable:!0});b.H="Array";return b}function $c(a,b,d){var c=a.s(a.X);d?(d=a.s(a.L),a.g(c,"prototype",d,v),a.g(d,"constructor",c,v)):c.zb=!0;a.g(c,"length",b,A);c.H="Function";return c}
function Pb(a,b,d,c){var e=$c(a,b.sa.length,!0);e.Xa=d;e.node=b;a.g(e,"name",b.id?String(b.id.name):c||"",A);return e}p.i=function(a,b){b=$c(this,a.length,b);b.Va=a;a.id=this.ab++;this.g(b,"name",a.name,A);return b};p.ub=function(a){var b=$c(this,a.length,!0);b.bb=a;a.id=this.ab++;this.g(b,"name",a.name,A);return b};
p.S=function(a,b){if(null===a||void 0===a||!0===a||!1===a||"string"===typeof a||"number"===typeof a)return a;if(a instanceof D)throw Error("Object is already pseudo");b=b||{da:[],ja:[]};var d=b.ja.indexOf(a);if(-1!==d)return b.da[d];b.ja.push(a);if(a instanceof RegExp){var c=this.s(this.Pa);Ic(this,c,a);b.da.push(c);return c}if(a instanceof Date)return c=this.s(this.ob),c.data=new Date(a.valueOf()),b.da.push(c),c;var e;a instanceof Number?e=this.ga(this.V):a instanceof String?e=this.ga(this.F):a instanceof
Boolean&&(e=this.ga(this.Oa));if(e)return e.data=a.valueOf(),b.da.push(e),e;if("function"===typeof a){var g=this;c=Object.getOwnPropertyDescriptor(a,"prototype");c=this.i(function(){var k=Array.prototype.slice.call(arguments).map(function(q){return g.T(q)});k=a.apply(g,k);return g.S(k)},!!c);b.da.push(c);return c}e=Array.isArray(a)?Cc(this):this.s(this.L);b.da.push(e);for(c in a)this.g(e,c,this.S(a[c],b));return e};
p.T=function(a,b){if(null===a||void 0===a||!0===a||!1===a||"string"===typeof a||"number"===typeof a)return a;if(!(a instanceof D))throw Error("Object is not pseudo");b=b||{da:[],ja:[]};var d=b.da.indexOf(a);if(-1!==d)return b.ja[d];b.da.push(a);if(P(this,a,this.I)){var c=new RegExp(a.data.source,a.data.flags);c.lastIndex=a.data.lastIndex;b.ja.push(c);return c}if(P(this,a,this.W))return a=new Date(a.data.valueOf()),b.ja.push(a),a;if(P(this,a,this.V)||P(this,a,this.F)||P(this,a,this.Oa))return a=Object(a.data),
b.ja.push(a),a;d=P(this,a,this.ua)?[]:{};b.ja.push(d);for(c in a.h){var e=this.T(a.h[c],b);Object.defineProperty(d,c,{value:e,writable:!0,enumerable:!0,configurable:!0})}return d};function Bc(a,b){switch(typeof b){case "number":return a.V.h.prototype;case "boolean":return a.Oa.h.prototype;case "string":return a.F.h.prototype}return b?b.Ca:null}
p.N=function(a,b){if(this.R)throw Error("Getter not supported in that context");b=String(b);void 0!==a&&null!==a||H(this,this.o,"Cannot read property '"+b+"' of "+a);if("object"===typeof a&&!(a instanceof D))throw TypeError("Expecting native value or pseudo object");if("length"===b){if(P(this,a,this.F))return String(a).length}else if(64>b.charCodeAt(0)&&P(this,a,this.F)){var d=Sa(b);if(!isNaN(d)&&d<String(a).length)return String(a)[d]}do if(a.h&&b in a.h)return(d=a.ba[b])?(this.R=!0,d):a.h[b];while(a=
Bc(this,a))};function ad(a,b,d){if(!(b instanceof D))throw TypeError("Primitive data type has no properties");d=String(d);if("length"===d&&P(a,b,a.F))return!0;if(P(a,b,a.F)){var c=Sa(d);if(!isNaN(c)&&c<String(b).length)return!0}do if(b.h&&d in b.h)return!0;while(b=Bc(a,b));return!1}
p.g=function(a,b,d,c){if(this.Ma)throw Error("Setter not supported in that context");b=String(b);void 0!==a&&null!==a||H(this,this.o,"Cannot set property '"+b+"' of "+a);if("object"===typeof a&&!(a instanceof D))throw TypeError("Expecting native value or pseudo object");c&&("get"in c||"set"in c)&&("value"in c||"writable"in c)&&H(this,this.o,"Invalid property descriptor. Cannot both specify accessors and a value or writable attribute");var e=!this.j||bd(this).U;if(a instanceof D){if(P(this,a,this.F)){var g=
Sa(b);if("length"===b||!isNaN(g)&&g<String(a).length){e&&H(this,this.o,"Cannot assign to read only property '"+b+"' of String '"+a.data+"'");return}}if("Array"===a.H)if(g=a.h.length,"length"===b){if(c){if(!("value"in c))return;d=c.value}d=Ra(d);isNaN(d)&&H(this,this.$a,"Invalid array length");if(d<g)for(k in a.h){var k=Sa(k);!isNaN(k)&&d<=k&&delete a.h[k]}}else isNaN(k=Sa(b))||(a.h.length=Math.max(g,k+1));if(!a.preventExtensions||b in a.h)if(c){e={};"get"in c&&c.get&&(a.ba[b]=c.get,e.get=this.g.Zb);
"set"in c&&c.set&&(a.ea[b]=c.set,e.set=this.g.$b);"configurable"in c&&(e.configurable=c.configurable);"enumerable"in c&&(e.enumerable=c.enumerable);"writable"in c&&(e.writable=c.writable,delete a.ba[b],delete a.ea[b]);"value"in c?(e.value=c.value,delete a.ba[b],delete a.ea[b]):d!==Ka&&(e.value=d,delete a.ba[b],delete a.ea[b]);try{Object.defineProperty(a.h,b,e)}catch(q){H(this,this.o,"Cannot redefine property: "+b)}"get"in c&&!c.get&&delete a.ba[b];"set"in c&&!c.set&&delete a.ea[b]}else{if(d===Ka)throw ReferenceError("Value not specified");
for(c=a;!(b in c.h);)if(c=Bc(this,c),!c){c=a;break}if(c.ea&&c.ea[b])return this.Ma=!0,c.ea[b];if(c.ba&&c.ba[b])e&&H(this,this.o,"Cannot set property '"+b+"' of object '"+a+"' which only has a getter");else try{a.h[b]=d}catch(q){e&&H(this,this.o,"Cannot assign to read only property '"+b+"' of object '"+a+"'")}}else e&&H(this,this.o,"Can't add property '"+b+"', object is not extensible")}else e&&H(this,this.o,"Can't create property '"+b+"' on '"+a+"'")};
p.g.Zb=function(){throw Error("Placeholder getter");};p.g.$b=function(){throw Error("Placeholder setter");};function J(a,b,d,c){a.g(b.h.prototype,d,a.i(c,!1),v)}function Gc(a,b,d,c){a.g(b.h.prototype,d,a.ub(c),v)}function bd(a){a=a.j[a.j.length-1].scope;if(!a)throw Error("No scope found");return a}
function ja(a,b,d){var c=!1;if(d&&d.U)c=!0;else{var e=b.body&&b.body[0];e&&e.pa&&"Literal"===e.pa.type&&"use strict"===e.pa.value&&(c=!0)}e=a.s(null);c=new cd(d,c,e);d||Bb(a,c.object);bb(a,b,c);return c}function dd(a,b,d){if(!b)throw Error("parentScope required");a=d||a.s(null);return new cd(b,b.U,a)}
function ed(a,b){for(var d=bd(a);d&&d!==a.M;){if(b in d.object.h)return d.object.h[b];d=d.Xa}if(d===a.M&&ad(a,d.object,b))return a.N(d.object,b);d=a.j[a.j.length-1].node;"UnaryExpression"===d.type&&"typeof"===d.operator||H(a,a.pb,b+" is not defined")}
function fd(a,b,d){for(var c=bd(a),e=c.U;c&&c!==a.M;){if(b in c.object.h){try{c.object.h[b]=d}catch(g){e&&H(a,a.o,"Cannot assign to read only variable '"+b+"'")}return}c=c.Xa}if(c===a.M&&(!e||ad(a,c.object,b)))return a.g(c.object,b,d);H(a,a.pb,b+" is not defined")}
function bb(a,b,d){if(b.lb)var c=b.lb;else{c=Object.create(null);switch(b.type){case "VariableDeclaration":for(var e=0;e<b.ia.length;e++)c[b.ia[e].id.name]=!0;break;case "FunctionDeclaration":c[b.id.name]=b;break;case "BlockStatement":case "CatchClause":case "DoWhileStatement":case "ForInStatement":case "ForStatement":case "IfStatement":case "LabeledStatement":case "Program":case "SwitchCase":case "SwitchStatement":case "TryStatement":case "WithStatement":case "WhileStatement":var g=b.constructor,
k;for(k in b)if(b[k]!==b.O){var q=b[k];if(q&&"object"===typeof q)if(Array.isArray(q))for(e=0;e<q.length;e++){if(q[e]&&q[e].constructor===g){var C=bb(a,q[e],d);for(k in C)c[k]=C[k]}}else if(q.constructor===g)for(k in C=bb(a,q,d),C)c[k]=C[k]}}b.lb=c}for(k in c)!0===c[k]?a.g(d.object,k,void 0,Ha):a.g(d.object,k,Pb(a,c[k],d),Ha);return c}function Ac(a){return a.j[a.j.length-1].isConstructor}function gd(a,b){return b[0]===Ja?ed(a,b[1]):a.N(b[0],b[1])}
function hd(a,b,d){return b[0]===Ja?fd(a,b[1],d):a.g(b[0],b[1],d)}function H(a,b,d){if(!a.M)throw void 0===d?b:d;void 0!==d&&b instanceof D&&(b=a.ga(b),Jc(a,b,d));id(a,4,b);throw Ia;}
function id(a,b,d,c){if(0===b)throw TypeError("Should not unwind for NORMAL completions");var e=a.j;a:for(;0<e.length;e.pop()){var g=e[e.length-1];switch(g.node.type){case "TryStatement":g.ha={type:b,value:d,label:c};return;case "CallExpression":case "NewExpression":if(3===b){g.value=d;return}if(1===b||2===b)throw Error("Unsyntactic break/continue not rejected by Acorn");break;case "Program":if(3===b)return;g.done=!0;break a}if(1===b){if(c?g.labels&&-1!==g.labels.indexOf(c):g.ca||g.Xb){e.pop();return}}else if(2===
b&&(c?g.labels&&-1!==g.labels.indexOf(c):g.ca))return}P(a,d,a.A)?(b={EvalError:EvalError,RangeError:RangeError,ReferenceError:ReferenceError,SyntaxError:SyntaxError,TypeError:TypeError,URIError:URIError},c=String(a.N(d,"name")),e=a.N(d,"message").valueOf(),b=(b[c]||Error)(e),b.stack=String(a.N(d,"stack"))):b=String(d);a.value=b;throw b;}
function Q(a,b){switch(b.type){case "ArrayExpression":return"[...]";case "BinaryExpression":case "LogicalExpression":return Q(a,b.left)+" "+b.operator+" "+Q(a,b.right);case "CallExpression":return Q(a,b.callee)+"(...)";case "ConditionalExpression":return Q(a,b.test)+" ? "+Q(a,b.fa)+" : "+Q(a,b.alternate);case "Identifier":return b.name;case "Literal":return b.raw;case "MemberExpression":var d=Q(a,b.object);a=Q(a,b.Ya);return b.fb?d+"["+a+"]":d+"."+a;case "NewExpression":return"new "+Q(a,b.callee)+
"(...)";case "ObjectExpression":return"{...}";case "ThisExpression":return"this";case "UnaryExpression":return b.operator+" "+Q(a,b.J);case "UpdateExpression":return d=Q(a,b.J),b.prefix?b.operator+d:d+b.operator}return"???"}
function Nb(a,b,d){var c=a.j[a.j.length-1],e=Array.from(d),g=e.shift();d=Math.max(Number(e.shift()||0),0);var k=a.Da();if(g instanceof D&&"Function"===g.H){var q=g;k.type="CallExpression";c=c.scope}else{try{var C=da(String(g),"taskCode"+a.hc++)}catch(R){H(a,a.Y,"Invalid code: "+R.message)}k.type="EvalProgram_";k.body=C.body;c=c.node.arguments[0];ta(k,c?c.start:void 0,c?c.end:void 0);c=a.M;e.length=0}b=new jd(q,e,c,k,b?d:-1);Ab(a,b,d);return b.u}
function Ab(a,b,d){b.time=Date.now()+d;a.$.push(b);a.$.sort(function(c,e){return c.time-e.time})}function Ob(a,b){for(var d=0;d<a.$.length;d++)if(a.$[d].u==b){a.$.splice(d,1);break}}function kd(a,b,d){if(!a.R)throw Error("Unexpected call to createGetter");a.R=!1;d=Array.isArray(d)?d[0]:d;var c=a.Da();c.type="CallExpression";a=new u(c,a.j[a.j.length-1].scope);a.ma=2;a.C=d;a.aa=b;a.Ta=!0;a.G=[];return a}
function ld(a,b,d,c){if(!a.Ma)throw Error("Unexpected call to createSetter");a.Ma=!1;d=Array.isArray(d)?d[0]:a.Qa;var e=a.Da();e.type="CallExpression";a=new u(e,a.j[a.j.length-1].scope);a.ma=2;a.C=d;a.aa=b;a.Ta=!0;a.G=[c];return a}function md(a,b){return void 0===b||null===b?a.Qa:b instanceof D?b:(a=a.s(Bc(a,b)),a.data=b,a)}p.Ub=function(){return this.M};p.cc=function(a){this.M=a;this.j[0].scope=a};p.Vb=function(){return this.j};p.dc=function(a){this.j=a};
function u(a,b){this.node=a;this.scope=b}function cd(a,b,d){this.Xa=a;this.U=b;this.object=d}function D(a){this.ba=Object.create(null);this.ea=Object.create(null);this.h=Object.create(null);this.Ca=a}p=D.prototype;p.Ca=null;p.H="Object";p.data=null;
p.toString=function(){if(!Oa)return"[object Interpreter.Object]";if(!(this instanceof D))return String(this);if("Array"===this.H){var a=Ma;a.push(this);try{var b=[],d=this.h.length,c=!1;1024<d&&(d=1E3,c=!0);for(var e=0;e<d;e++){var g=this.h[e];b[e]=g instanceof D&&-1!==a.indexOf(g)?"...":g}c&&b.push("...")}finally{a.pop()}return b.join(",")}if("Error"===this.H){a=Ma;if(-1!==a.indexOf(this))return"[object Error]";d=this;do if("name"in d.h){b=d.h.name;break}while(d=d.Ca);d=this;do if("message"in d.h){c=
d.h.message;break}while(d=d.Ca);a.push(this);try{b=b&&String(b),c=c&&String(c)}finally{a.pop()}return c?b+": "+c:String(b)}return null!==this.data?String(this.data):"[object "+this.H+"]"};p.valueOf=function(){return!Oa||void 0===this.data||null===this.data||this.data instanceof RegExp?this:this.data instanceof Date?this.data.valueOf():this.data};function jd(a,b,d,c,e){this.o=a;this.A=b;this.scope=d;this.node=c;this.j=e;this.u=++nd;this.time=0}var nd=0;
t.prototype.stepArrayExpression=function(a,b,d){d=d.elements;var c=b.B||0;b.Ra?(this.g(b.Ra,c,b.value),c++):(b.Ra=Cc(this),b.Ra.h.length=d.length);for(;c<d.length;){if(d[c])return b.B=c,new u(d[c],b.scope);c++}a.pop();a[a.length-1].value=b.Ra};
t.prototype.stepAssignmentExpression=function(a,b,d){if(!b.na)return b.na=!0,b=new u(d.left,b.scope),b.xa=!0,b;if(!b.Ga){b.Ia||(b.Ia=b.value);b.Ea&&(b.qa=b.value);if(!b.Ea&&"="!==d.operator&&(a=gd(this,b.Ia),b.qa=a,this.R))return b.Ea=!0,kd(this,a,b.Ia);b.Ga=!0;"="===d.operator&&"Identifier"===d.left.type&&(b.Sa=d.left.name);return new u(d.right,b.scope)}if(b.ya)a.pop(),a[a.length-1].value=b.kb;else{var c=b.qa,e=b.value;switch(d.operator){case "=":c=e;break;case "+=":c+=e;break;case "-=":c-=e;break;
case "*=":c*=e;break;case "/=":c/=e;break;case "%=":c%=e;break;case "<<=":c<<=e;break;case ">>=":c>>=e;break;case ">>>=":c>>>=e;break;case "&=":c&=e;break;case "^=":c^=e;break;case "|=":c|=e;break;default:throw SyntaxError("Unknown assignment expression: "+d.operator);}if(d=hd(this,b.Ia,c))return b.ya=!0,b.kb=c,ld(this,d,b.Ia,c);a.pop();a[a.length-1].value=c}};
t.prototype.stepBinaryExpression=function(a,b,d){if(!b.na)return b.na=!0,new u(d.left,b.scope);if(!b.Ga)return b.Ga=!0,b.qa=b.value,new u(d.right,b.scope);a.pop();var c=b.qa;b=b.value;switch(d.operator){case "==":d=c==b;break;case "!=":d=c!=b;break;case "===":d=c===b;break;case "!==":d=c!==b;break;case ">":d=c>b;break;case ">=":d=c>=b;break;case "<":d=c<b;break;case "<=":d=c<=b;break;case "+":d=c+b;break;case "-":d=c-b;break;case "*":d=c*b;break;case "/":d=c/b;break;case "%":d=c%b;break;case "&":d=
c&b;break;case "|":d=c|b;break;case "^":d=c^b;break;case "<<":d=c<<b;break;case ">>":d=c>>b;break;case ">>>":d=c>>>b;break;case "in":b instanceof D||H(this,this.o,"'in' expects an object, not '"+b+"'");d=ad(this,b,c);break;case "instanceof":P(this,b,this.P)||H(this,this.o,"'instanceof' expects an object, not '"+b+"'");d=c instanceof D?P(this,c,b):!1;break;default:throw SyntaxError("Unknown binary operator: "+d.operator);}a[a.length-1].value=d};
t.prototype.stepBlockStatement=function(a,b,d){var c=b.B||0;if(d=d.body[c])return b.B=c+1,new u(d,b.scope);a.pop()};t.prototype.stepBreakStatement=function(a,b,d){id(this,1,void 0,d.label&&d.label.name)};t.prototype.Fb=0;
t.prototype.stepCallExpression=function(a,b,d){if(!b.ma){b.ma=1;var c=new u(d.callee,b.scope);c.xa=!0;return c}if(1===b.ma){b.ma=2;var e=b.value;if(Array.isArray(e)){if(b.aa=gd(this,e),e[0]===Ja?b.Mb="eval"===e[1]:b.C=e[0],e=b.aa,this.R)return b.ma=1,kd(this,e,b.value)}else b.aa=e;b.G=[];b.B=0}e=b.aa;if(!b.Ta){0!==b.B&&b.G.push(b.value);if(d.arguments[b.B])return new u(d.arguments[b.B++],b.scope);if("NewExpression"===d.type){e instanceof D&&!e.zb||H(this,this.o,Q(this,d.callee)+" is not a constructor");
if(e===this.ua)b.C=Cc(this);else{var g=e.h.prototype;if("object"!==typeof g||null===g)g=this.L;b.C=this.s(g)}b.isConstructor=!0}b.Ta=!0}if(b.hb)a.pop(),a[a.length-1].value=b.isConstructor&&"object"!==typeof b.value?b.C:b.value;else{b.hb=!0;e instanceof D||H(this,this.o,Q(this,d.callee)+" is not a function");if(a=e.node){d=ja(this,a.body,e.Xa);c=Cc(this);for(e=0;e<b.G.length;e++)this.g(c,e,b.G[e]);this.g(d.object,"arguments",c);for(e=0;e<a.sa.length;e++)this.g(d.object,a.sa[e].name,b.G.length>e?b.G[e]:
void 0);d.U||(b.C=md(this,b.C));this.g(d.object,"this",b.C,wa);b.value=void 0;return new u(a.body,d)}if(e.eval)if(e=b.G[0],"string"!==typeof e)b.value=e;else{try{c=da(String(e),"eval"+this.Fb++)}catch(q){H(this,this.Y,"Invalid code: "+q.message)}e=this.Da();e.type="EvalProgram_";e.body=c.body;ta(e,d.start,d.end);d=b.Mb?b.scope:this.M;d.U?d=ja(this,c,d):bb(this,c,d);this.value=void 0;return new u(e,d)}else if(e.Va)b.scope.U||(b.C=md(this,b.C)),b.value=e.Va.apply(b.C,b.G);else if(e.bb){var k=this;c=
e.bb.length-1;c=b.G.concat(Array(c)).slice(0,c);c.push(function(q){b.value=q;k.wa=!1});this.wa=!0;b.scope.U||(b.C=md(this,b.C));e.bb.apply(b.C,c)}else H(this,this.o,Q(this,d.callee)+" is not callable")}};
t.prototype.stepConditionalExpression=function(a,b,d){var c=b.ra||0;if(0===c)return b.ra=1,new u(d.test,b.scope);if(1===c){b.ra=2;if((c=!!b.value)&&d.fa)return new u(d.fa,b.scope);if(!c&&d.alternate)return new u(d.alternate,b.scope);this.value=void 0}a.pop();"ConditionalExpression"===d.type&&(a[a.length-1].value=b.value)};t.prototype.stepContinueStatement=function(a,b,d){id(this,2,void 0,d.label&&d.label.name)};t.prototype.stepDebuggerStatement=function(a){a.pop()};
t.prototype.stepDoWhileStatement=function(a,b,d){"DoWhileStatement"===d.type&&void 0===b.ka&&(b.value=!0,b.ka=!0);if(!b.ka)return b.ka=!0,new u(d.test,b.scope);if(!b.value)a.pop();else if(d.body)return b.ka=!1,b.ca=!0,new u(d.body,b.scope)};t.prototype.stepEmptyStatement=function(a){a.pop()};t.prototype.stepEvalProgram_=function(a,b,d){var c=b.B||0;if(d=d.body[c])return b.B=c+1,new u(d,b.scope);a.pop();a[a.length-1].value=this.value};
t.prototype.stepExpressionStatement=function(a,b,d){if(!b.oa)return this.value=void 0,b.oa=!0,new u(d.pa,b.scope);a.pop();this.value=b.value};
t.prototype.stepForInStatement=function(a,b,d){if(!b.Rb&&(b.Rb=!0,d.left.ia&&d.left.ia[0].za))return b.scope.U&&H(this,this.Y,"for-in loop variable declaration may not have an initializer"),new u(d.left,b.scope);if(!b.Fa)return b.Fa=!0,b.ta||(b.ta=b.value),new u(d.right,b.scope);b.ca||(b.ca=!0,b.v=b.value,b.mb=Object.create(null));if(void 0===b.Ua)a:for(;;){if(b.v instanceof D)for(b.Ba||(b.Ba=Object.getOwnPropertyNames(b.v.h));;){var c=b.Ba.shift();if(void 0===c)break;if(Object.prototype.hasOwnProperty.call(b.v.h,
c)&&!b.mb[c]&&(b.mb[c]=!0,Object.prototype.propertyIsEnumerable.call(b.v.h,c))){b.Ua=c;break a}}else if(null!==b.v&&void 0!==b.v)for(b.Ba||(b.Ba=Object.getOwnPropertyNames(b.v));;){c=b.Ba.shift();if(void 0===c)break;b.mb[c]=!0;if(Object.prototype.propertyIsEnumerable.call(b.v,c)){b.Ua=c;break a}}b.v=Bc(this,b.v);b.Ba=null;if(null===b.v){a.pop();return}}if(!b.wb)if(b.wb=!0,a=d.left,"VariableDeclaration"===a.type)b.ta=[Ja,a.ia[0].id.name];else return b.ta=null,b=new u(a,b.scope),b.xa=!0,b;b.ta||(b.ta=
b.value);if(!b.ya&&(b.ya=!0,a=b.Ua,c=hd(this,b.ta,a)))return ld(this,c,b.ta,a);b.Ua=void 0;b.wb=!1;b.ya=!1;if(d.body)return new u(d.body,b.scope)};t.prototype.stepForStatement=function(a,b,d){switch(b.ra){default:b.ra=1;if(d.za)return new u(d.za,b.scope);break;case 1:b.ra=2;if(d.test)return new u(d.test,b.scope);break;case 2:b.ra=3;if(d.test&&!b.value)a.pop();else return b.ca=!0,new u(d.body,b.scope);break;case 3:if(b.ra=1,d.update)return new u(d.update,b.scope)}};
t.prototype.stepFunctionDeclaration=function(a){a.pop()};t.prototype.stepFunctionExpression=function(a,b,d){a.pop();b=a[a.length-1];a=b.scope;d.id&&(a=dd(this,a));b.value=Pb(this,d,a,b.Sa);d.id&&this.g(a.object,d.id.name,b.value,wa)};t.prototype.stepIdentifier=function(a,b,d){a.pop();if(b.xa)a[a.length-1].value=[Ja,d.name];else{b=ed(this,d.name);if(this.R)return kd(this,b,this.Qa);a[a.length-1].value=b}};t.prototype.stepIfStatement=t.prototype.stepConditionalExpression;
t.prototype.stepLabeledStatement=function(a,b,d){a.pop();a=b.labels||[];a.push(d.label.name);b=new u(d.body,b.scope);b.labels=a;return b};t.prototype.stepLiteral=function(a,b,d){a.pop();b=d.value;b instanceof RegExp&&(d=this.s(this.Pa),Ic(this,d,b),b=d);a[a.length-1].value=b};
t.prototype.stepLogicalExpression=function(a,b,d){if("&&"!==d.operator&&"||"!==d.operator)throw SyntaxError("Unknown logical operator: "+d.operator);if(!b.na)return b.na=!0,new u(d.left,b.scope);if(b.Ga)a.pop(),a[a.length-1].value=b.value;else if("&&"===d.operator&&!b.value||"||"===d.operator&&b.value)a.pop(),a[a.length-1].value=b.value;else return b.Ga=!0,new u(d.right,b.scope)};
t.prototype.stepMemberExpression=function(a,b,d){if(!b.Fa)return b.Fa=!0,new u(d.object,b.scope);if(d.fb)if(b.Sb)d=b.value;else return b.v=b.value,b.Sb=!0,new u(d.Ya,b.scope);else b.v=b.value,d=d.Ya.name;a.pop();if(b.xa)a[a.length-1].value=[b.v,d];else{d=this.N(b.v,d);if(this.R)return kd(this,d,b.v);a[a.length-1].value=d}};t.prototype.stepNewExpression=t.prototype.stepCallExpression;
t.prototype.stepObjectExpression=function(a,b,d){var c=b.B||0,e=d.h[c];if(b.v){var g=b.Sa;b.La[g]||(b.La[g]={});b.La[g][e.kind]=b.value;b.B=++c;e=d.h[c]}else b.v=this.s(this.L),b.La=Object.create(null);if(e){var k=e.key;if("Identifier"===k.type)g=k.name;else if("Literal"===k.type)g=k.value;else throw SyntaxError("Unknown object structure: "+k.type);b.Sa=g;return new u(e.value,b.scope)}for(k in b.La)d=b.La[k],"get"in d||"set"in d?this.g(b.v,k,Ka,{configurable:!0,enumerable:!0,get:d.get,set:d.set}):
this.g(b.v,k,d.init);a.pop();a[a.length-1].value=b.v};t.prototype.stepProgram=function(a,b,d){if(a=d.body.shift())return b.done=!1,new u(a,b.scope);b.done=!0};t.prototype.stepReturnStatement=function(a,b,d){if(d.J&&!b.oa)return b.oa=!0,new u(d.J,b.scope);id(this,3,b.value)};t.prototype.stepSequenceExpression=function(a,b,d){var c=b.B||0;if(d=d.xb[c])return b.B=c+1,new u(d,b.scope);a.pop();a[a.length-1].value=b.value};
t.prototype.stepSwitchStatement=function(a,b,d){if(!b.ka)return b.ka=1,new u(d.Nb,b.scope);1===b.ka&&(b.ka=2,b.fc=b.value,b.gb=-1);for(;;){var c=b.jb||0,e=d.tb[c];if(b.Ka||!e||e.test)if(e||b.Ka||-1===b.gb)if(e){if(!b.Ka&&!b.Db&&e.test)return b.Db=!0,new u(e.test,b.scope);if(b.Ka||b.value===b.fc){b.Ka=!0;var g=b.B||0;if(e.fa[g])return b.Xb=!0,b.B=g+1,new u(e.fa[g],b.scope)}b.Db=!1;b.B=0;b.jb=c+1}else{a.pop();break}else b.Ka=!0,b.jb=b.gb;else b.gb=c,b.jb=c+1}};
t.prototype.stepThisExpression=function(a){a.pop();a[a.length-1].value=ed(this,"this")};t.prototype.stepThrowStatement=function(a,b,d){if(b.oa)H(this,b.value);else return b.oa=!0,new u(d.J,b.scope)};
t.prototype.stepTryStatement=function(a,b,d){if(!b.Ob)return b.Ob=!0,new u(d.block,b.scope);if(b.ha&&4===b.ha.type&&!b.Qb&&d.Ha)return b.Qb=!0,a=dd(this,b.scope),this.g(a.object,d.Ha.Wa.name,b.ha.value),b.ha=void 0,new u(d.Ha.body,a);if(!b.Pb&&d.ib)return b.Pb=!0,new u(d.ib,b.scope);a.pop();b.ha&&id(this,b.ha.type,b.ha.value,b.ha.label)};
t.prototype.stepUnaryExpression=function(a,b,d){if(!b.oa)return b.oa=!0,a=new u(d.J,b.scope),a.xa="delete"===d.operator,a;a.pop();var c=b.value;switch(d.operator){case "-":c=-c;break;case "+":c=+c;break;case "!":c=!c;break;case "~":c=~c;break;case "delete":d=!0;if(Array.isArray(c)){var e=c[0];e===Ja&&(e=b.scope);c=String(c[1]);try{delete e.h[c]}catch(g){b.scope.U?H(this,this.o,"Cannot delete property '"+c+"' of '"+e+"'"):d=!1}}c=d;break;case "typeof":c=c&&"Function"===c.H?"function":typeof c;break;
case "void":c=void 0;break;default:throw SyntaxError("Unknown unary operator: "+d.operator);}a[a.length-1].value=c};
t.prototype.stepUpdateExpression=function(a,b,d){if(!b.na)return b.na=!0,a=new u(d.J,b.scope),a.xa=!0,a;b.Ja||(b.Ja=b.value);b.Ea&&(b.qa=b.value);if(!b.Ea){var c=gd(this,b.Ja);b.qa=c;if(this.R)return b.Ea=!0,kd(this,c,b.Ja)}if(b.ya)a.pop(),a[a.length-1].value=b.kb;else{c=Number(b.qa);if("++"===d.operator)var e=c+1;else if("--"===d.operator)e=c-1;else throw SyntaxError("Unknown update expression: "+d.operator);d=d.prefix?e:c;if(c=hd(this,b.Ja,e))return b.ya=!0,b.kb=d,ld(this,c,b.Ja,e);a.pop();a[a.length-
1].value=d}};t.prototype.stepVariableDeclaration=function(a,b,d){d=d.ia;var c=b.B||0,e=d[c];b.Ab&&e&&(fd(this,e.id.name,b.value),b.Ab=!1,e=d[++c]);for(;e;){if(e.za)return b.B=c,b.Ab=!0,b.Sa=e.id.name,new u(e.za,b.scope);e=d[++c]}a.pop()};t.prototype.stepWithStatement=function(a,b,d){if(!b.Fa)return b.Fa=!0,new u(d.object,b.scope);a.pop();a=dd(this,b.scope,b.value);return new u(d.body,a)};t.prototype.stepWhileStatement=t.prototype.stepDoWhileStatement;Pa.Interpreter=t;t.prototype.step=t.prototype.nb;
t.prototype.run=t.prototype.Cb;t.prototype.getStatus=t.prototype.Wb;t.prototype.appendCode=t.prototype.Hb;t.prototype.createObject=t.prototype.ga;t.prototype.createObjectProto=t.prototype.s;t.prototype.createNativeFunction=t.prototype.i;t.prototype.createAsyncFunction=t.prototype.ub;t.prototype.getProperty=t.prototype.N;t.prototype.setProperty=t.prototype.g;t.prototype.nativeToPseudo=t.prototype.S;t.prototype.pseudoToNative=t.prototype.T;t.prototype.getGlobalScope=t.prototype.Ub;
t.prototype.setGlobalScope=t.prototype.cc;t.prototype.getStateStack=t.prototype.Vb;t.prototype.setStateStack=t.prototype.dc;t.Status=ua;t.VALUE_IN_DESCRIPTOR=Ka;

export default Interpreter