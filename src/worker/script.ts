/**
 * The parser worker's script: src/worker/main.ts and what it imports, bundled
 * as text by `npm run worker`. Generated: run that command after changing
 * anything the worker uses. A test fails while this is behind its sources.
 */
export const WORKER_SCRIPT = `"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/vendor/web-tree-sitter.ts
  var __defProp2 = Object.defineProperty;
  var __name = (target, value) => __defProp2(target, "name", { value, configurable: true });
  var _a;
  var Edit = (_a = class {
    constructor({
      startIndex,
      oldEndIndex,
      newEndIndex,
      startPosition,
      oldEndPosition,
      newEndPosition
    }) {
      /** The start position of the change. */
      __publicField(this, "startPosition");
      /** The end position of the change before the edit. */
      __publicField(this, "oldEndPosition");
      /** The end position of the change after the edit. */
      __publicField(this, "newEndPosition");
      /** The start index of the change. */
      __publicField(this, "startIndex");
      /** The end index of the change before the edit. */
      __publicField(this, "oldEndIndex");
      /** The end index of the change after the edit. */
      __publicField(this, "newEndIndex");
      this.startIndex = startIndex >>> 0;
      this.oldEndIndex = oldEndIndex >>> 0;
      this.newEndIndex = newEndIndex >>> 0;
      this.startPosition = startPosition;
      this.oldEndPosition = oldEndPosition;
      this.newEndPosition = newEndPosition;
    }
    /**
     * Edit a point and index to keep it in-sync with source code that has been edited.
     *
     * This function updates a single point's byte offset and row/column position
     * based on an edit operation. This is useful for editing points without
     * requiring a tree or node instance.
     */
    editPoint(point, index) {
      let newIndex = index;
      const newPoint = { ...point };
      if (index >= this.oldEndIndex) {
        newIndex = this.newEndIndex + (index - this.oldEndIndex);
        const originalRow = point.row;
        newPoint.row = this.newEndPosition.row + (point.row - this.oldEndPosition.row);
        newPoint.column = originalRow === this.oldEndPosition.row ? this.newEndPosition.column + (point.column - this.oldEndPosition.column) : point.column;
      } else if (index > this.startIndex) {
        newIndex = this.newEndIndex;
        newPoint.row = this.newEndPosition.row;
        newPoint.column = this.newEndPosition.column;
      }
      return { point: newPoint, index: newIndex };
    }
    /**
     * Edit a range to keep it in-sync with source code that has been edited.
     *
     * This function updates a range's start and end positions based on an edit
     * operation. This is useful for editing ranges without requiring a tree
     * or node instance.
     */
    editRange(range) {
      const newRange = {
        startIndex: range.startIndex,
        startPosition: { ...range.startPosition },
        endIndex: range.endIndex,
        endPosition: { ...range.endPosition }
      };
      if (range.endIndex >= this.oldEndIndex) {
        if (range.endIndex !== Number.MAX_SAFE_INTEGER) {
          newRange.endIndex = this.newEndIndex + (range.endIndex - this.oldEndIndex);
          newRange.endPosition = {
            row: this.newEndPosition.row + (range.endPosition.row - this.oldEndPosition.row),
            column: range.endPosition.row === this.oldEndPosition.row ? this.newEndPosition.column + (range.endPosition.column - this.oldEndPosition.column) : range.endPosition.column
          };
          if (newRange.endIndex < this.newEndIndex) {
            newRange.endIndex = Number.MAX_SAFE_INTEGER;
            newRange.endPosition = { row: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER };
          }
        }
      } else if (range.endIndex > this.startIndex) {
        newRange.endIndex = this.startIndex;
        newRange.endPosition = { ...this.startPosition };
      }
      if (range.startIndex >= this.oldEndIndex) {
        newRange.startIndex = this.newEndIndex + (range.startIndex - this.oldEndIndex);
        newRange.startPosition = {
          row: this.newEndPosition.row + (range.startPosition.row - this.oldEndPosition.row),
          column: range.startPosition.row === this.oldEndPosition.row ? this.newEndPosition.column + (range.startPosition.column - this.oldEndPosition.column) : range.startPosition.column
        };
        if (newRange.startIndex < this.newEndIndex) {
          newRange.startIndex = Number.MAX_SAFE_INTEGER;
          newRange.startPosition = { row: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER };
        }
      } else if (range.startIndex > this.startIndex) {
        newRange.startIndex = this.startIndex;
        newRange.startPosition = { ...this.startPosition };
      }
      return newRange;
    }
  }, __name(_a, "Edit"), _a);
  var SIZE_OF_SHORT = 2;
  var SIZE_OF_INT = 4;
  var SIZE_OF_CURSOR = 4 * SIZE_OF_INT;
  var SIZE_OF_NODE = 5 * SIZE_OF_INT;
  var SIZE_OF_POINT = 2 * SIZE_OF_INT;
  var SIZE_OF_RANGE = 2 * SIZE_OF_INT + 2 * SIZE_OF_POINT;
  var ZERO_POINT = { row: 0, column: 0 };
  var INTERNAL = /* @__PURE__ */ Symbol("INTERNAL");
  function assertInternal(x2) {
    if (x2 !== INTERNAL) throw new Error("Illegal constructor");
  }
  __name(assertInternal, "assertInternal");
  function isPoint(point) {
    return !!point && typeof point.row === "number" && typeof point.column === "number";
  }
  __name(isPoint, "isPoint");
  function setModule(module2) {
    C = module2;
  }
  __name(setModule, "setModule");
  var C;
  function newFinalizer(handler) {
    try {
      return new FinalizationRegistry(handler);
    } catch (e) {
      console.error("Unsupported FinalizationRegistry:", e);
      return;
    }
  }
  __name(newFinalizer, "newFinalizer");
  var finalizer = newFinalizer((address) => {
    C._ts_lookahead_iterator_delete(address);
  });
  var _a2;
  var LookaheadIterator = (_a2 = class {
    /** @internal */
    constructor(internal, address, language) {
      /** @internal */
      __publicField(this, 0, 0);
      // Internal handle for Wasm
      /** @internal */
      __publicField(this, "language");
      /** @internal */
      __publicField(this, "positioned", false);
      assertInternal(internal);
      this[0] = address;
      this.language = language;
      finalizer?.register(this, address, this);
    }
    /**
     * Get the current symbol of the lookahead iterator.
     *
     * Returns \`null\` if the iterator is not positioned on a symbol:
     *
     * - Before the first iteration step
     * - After the iterator is exhausted
     * - After a {@link reset} or {@link resetState} call
     */
    get currentTypeId() {
      return this.positioned ? C._ts_lookahead_iterator_current_symbol(this[0]) : null;
    }
    /**
     * Get the current symbol name of the lookahead iterator.
     *
     * Returns \`null\` if the iterator is not positioned on a symbol.
     */
    get currentType() {
      const id = this.currentTypeId;
      if (id === null) return null;
      return this.language.types[id] ?? C.UTF8ToString(C._ts_language_symbol_name(this.language[0], id));
    }
    /** Delete the lookahead iterator, freeing its resources. */
    delete() {
      finalizer?.unregister(this);
      C._ts_lookahead_iterator_delete(this[0]);
      this[0] = 0;
    }
    /**
     * Reset the lookahead iterator.
     *
     * This returns \`true\` if the language was set successfully and \`false\`
     * otherwise.
     */
    reset(language, stateId) {
      if (C._ts_lookahead_iterator_reset(this[0], language[0], stateId)) {
        this.language = language;
        this.positioned = false;
        return true;
      }
      return false;
    }
    /**
     * Reset the lookahead iterator to another state.
     *
     * This returns \`true\` if the iterator was reset to the given state and
     * \`false\` otherwise.
     */
    resetState(stateId) {
      if (!C._ts_lookahead_iterator_reset_state(this[0], stateId)) return false;
      this.positioned = false;
      return true;
    }
    /**
     * Returns an iterator that iterates over the symbols of the lookahead iterator.
     *
     * The iterator will yield the current symbol name as a string for each step
     * until there are no more symbols to iterate over.
     */
    [Symbol.iterator]() {
      return {
        next: /* @__PURE__ */ __name(() => {
          this.positioned = Boolean(C._ts_lookahead_iterator_next(this[0]));
          const value = this.currentType;
          return value === null ? { done: true, value: "" } : { done: false, value };
        }, "next")
      };
    }
  }, __name(_a2, "LookaheadIterator"), _a2);
  function getText(tree, startIndex, endIndex, startPosition) {
    const length = endIndex - startIndex;
    let result = tree.textCallback(startIndex, startPosition);
    if (result) {
      startIndex += result.length;
      while (startIndex < endIndex) {
        const string2 = tree.textCallback(startIndex, startPosition);
        if (string2 && string2.length > 0) {
          startIndex += string2.length;
          result += string2;
        } else {
          break;
        }
      }
      if (startIndex > endIndex) {
        result = result.slice(0, length);
      }
    }
    return result ?? "";
  }
  __name(getText, "getText");
  var finalizer2 = newFinalizer((address) => {
    C._ts_tree_delete(address);
  });
  var _a3;
  var Tree = (_a3 = class {
    /** @internal */
    constructor(internal, address, language, textCallback) {
      /** @internal */
      __publicField(this, 0, 0);
      // Internal handle for Wasm
      /** @internal */
      __publicField(this, "textCallback");
      /** The language that was used to parse the syntax tree. */
      __publicField(this, "language");
      assertInternal(internal);
      this[0] = address;
      this.language = language;
      this.textCallback = textCallback;
      finalizer2?.register(this, address, this);
    }
    /** Create a shallow copy of the syntax tree. This is very fast. */
    copy() {
      const address = C._ts_tree_copy(this[0]);
      return new _a3(INTERNAL, address, this.language, this.textCallback);
    }
    /** Delete the syntax tree, freeing its resources. */
    delete() {
      finalizer2?.unregister(this);
      C._ts_tree_delete(this[0]);
      this[0] = 0;
    }
    /** Get the root node of the syntax tree. */
    get rootNode() {
      C._ts_tree_root_node_wasm(this[0]);
      return unmarshalNode(this);
    }
    /**
     * Get the root node of the syntax tree, but with its position shifted
     * forward by the given offset.
     */
    rootNodeWithOffset(offsetBytes, offsetExtent) {
      const address = TRANSFER_BUFFER + SIZE_OF_NODE;
      C.setValue(address, offsetBytes, "i32");
      marshalPoint(address + SIZE_OF_INT, offsetExtent);
      C._ts_tree_root_node_with_offset_wasm(this[0]);
      return unmarshalNode(this);
    }
    /**
     * Edit the syntax tree to keep it in sync with source code that has been
     * edited.
     *
     * You must describe the edit both in terms of byte offsets and in terms of
     * row/column coordinates.
     */
    edit(edit) {
      marshalEdit(edit);
      C._ts_tree_edit_wasm(this[0]);
    }
    /** Create a new {@link TreeCursor} starting from the root of the tree. */
    walk() {
      return this.rootNode.walk();
    }
    /**
     * Compare this old edited syntax tree to a new syntax tree representing
     * the same document, returning a sequence of ranges whose syntactic
     * structure has changed.
     *
     * For this to work correctly, this syntax tree must have been edited such
     * that its ranges match up to the new tree. Generally, you'll want to
     * call this method right after calling one of the [\`Parser::parse\`]
     * functions. Call it on the old tree that was passed to parse, and
     * pass the new tree that was returned from \`parse\`.
     */
    getChangedRanges(other) {
      if (!(other instanceof _a3)) {
        throw new TypeError("Argument must be a Tree");
      }
      C._ts_tree_get_changed_ranges_wasm(this[0], other[0]);
      const count2 = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const result = new Array(count2);
      if (count2 > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count2; i2++) {
          result[i2] = unmarshalRange(address);
          address += SIZE_OF_RANGE;
        }
        C._free(buffer);
      }
      return result;
    }
    /** Get the included ranges that were used to parse the syntax tree. */
    getIncludedRanges() {
      C._ts_tree_included_ranges_wasm(this[0]);
      const count2 = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const result = new Array(count2);
      if (count2 > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count2; i2++) {
          result[i2] = unmarshalRange(address);
          address += SIZE_OF_RANGE;
        }
        C._free(buffer);
      }
      return result;
    }
  }, __name(_a3, "Tree"), _a3);
  var finalizer3 = newFinalizer((address) => {
    C._ts_tree_cursor_delete_wasm(address);
  });
  var _a4;
  var TreeCursor = (_a4 = class {
    /** @internal */
    constructor(internal, tree) {
      /** @internal */
      // @ts-expect-error: never read
      __publicField(this, 0, 0);
      // Internal handle for Wasm
      /** @internal */
      // @ts-expect-error: never read
      __publicField(this, 1, 0);
      // Internal handle for Wasm
      /** @internal */
      // @ts-expect-error: never read
      __publicField(this, 2, 0);
      // Internal handle for Wasm
      /** @internal */
      // @ts-expect-error: never read
      __publicField(this, 3, 0);
      // Internal handle for Wasm
      /** @internal */
      __publicField(this, "tree");
      assertInternal(internal);
      this.tree = tree;
      unmarshalTreeCursor(this);
      finalizer3?.register(this, this.tree[0], this);
    }
    /** Creates a deep copy of the tree cursor. This allocates new memory. */
    copy() {
      const copy = new _a4(INTERNAL, this.tree);
      C._ts_tree_cursor_copy_wasm(this.tree[0]);
      unmarshalTreeCursor(copy);
      return copy;
    }
    /** Delete the tree cursor, freeing its resources. */
    delete() {
      finalizer3?.unregister(this);
      marshalTreeCursor(this);
      C._ts_tree_cursor_delete_wasm(this.tree[0]);
      this[0] = this[1] = this[2] = 0;
    }
    /** Get the tree cursor's current {@link Node}. */
    get currentNode() {
      marshalTreeCursor(this);
      C._ts_tree_cursor_current_node_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /**
     * Get the numerical field id of this tree cursor's current node.
     *
     * See also {@link TreeCursor#currentFieldName}.
     */
    get currentFieldId() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_field_id_wasm(this.tree[0]);
    }
    /** Get the field name of this tree cursor's current node. */
    get currentFieldName() {
      return this.tree.language.fields[this.currentFieldId];
    }
    /**
     * Get the depth of the cursor's current node relative to the original
     * node that the cursor was constructed with.
     */
    get currentDepth() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_depth_wasm(this.tree[0]);
    }
    /**
     * Get the index of the cursor's current node out of all of the
     * descendants of the original node that the cursor was constructed with.
     */
    get currentDescendantIndex() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_descendant_index_wasm(this.tree[0]);
    }
    /** Get the type of the cursor's current node. */
    get nodeType() {
      return this.tree.language.types[this.nodeTypeId] || "ERROR";
    }
    /** Get the type id of the cursor's current node. */
    get nodeTypeId() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_node_type_id_wasm(this.tree[0]);
    }
    /** Get the state id of the cursor's current node. */
    get nodeStateId() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_node_state_id_wasm(this.tree[0]);
    }
    /** Get the id of the cursor's current node. */
    get nodeId() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_node_id_wasm(this.tree[0]);
    }
    /**
     * Check if the cursor's current node is *named*.
     *
     * Named nodes correspond to named rules in the grammar, whereas
     * *anonymous* nodes correspond to string literals in the grammar.
     */
    get nodeIsNamed() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_node_is_named_wasm(this.tree[0]) === 1;
    }
    /**
     * Check if the cursor's current node is *missing*.
     *
     * Missing nodes are inserted by the parser in order to recover from
     * certain kinds of syntax errors.
     */
    get nodeIsMissing() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_current_node_is_missing_wasm(this.tree[0]) === 1;
    }
    /** Get the string content of the cursor's current node. */
    get nodeText() {
      marshalTreeCursor(this);
      const startIndex = C._ts_tree_cursor_start_index_wasm(this.tree[0]);
      const endIndex = C._ts_tree_cursor_end_index_wasm(this.tree[0]);
      C._ts_tree_cursor_start_position_wasm(this.tree[0]);
      const startPosition = unmarshalPoint(TRANSFER_BUFFER);
      return getText(this.tree, startIndex, endIndex, startPosition);
    }
    /** Get the start position of the cursor's current node. */
    get startPosition() {
      marshalTreeCursor(this);
      C._ts_tree_cursor_start_position_wasm(this.tree[0]);
      return unmarshalPoint(TRANSFER_BUFFER);
    }
    /** Get the end position of the cursor's current node. */
    get endPosition() {
      marshalTreeCursor(this);
      C._ts_tree_cursor_end_position_wasm(this.tree[0]);
      return unmarshalPoint(TRANSFER_BUFFER);
    }
    /** Get the start index of the cursor's current node. */
    get startIndex() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_start_index_wasm(this.tree[0]);
    }
    /** Get the end index of the cursor's current node. */
    get endIndex() {
      marshalTreeCursor(this);
      return C._ts_tree_cursor_end_index_wasm(this.tree[0]);
    }
    /**
     * Move this cursor to the first child of its current node.
     *
     * This returns \`true\` if the cursor successfully moved, and returns
     * \`false\` if there were no children.
     */
    gotoFirstChild() {
      marshalTreeCursor(this);
      const result = C._ts_tree_cursor_goto_first_child_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
      return result === 1;
    }
    /**
     * Move this cursor to the last child of its current node.
     *
     * This returns \`true\` if the cursor successfully moved, and returns
     * \`false\` if there were no children.
     *
     * Note that this function may be slower than
     * {@link TreeCursor#gotoFirstChild} because it needs to
     * iterate through all the children to compute the child's position.
     */
    gotoLastChild() {
      marshalTreeCursor(this);
      const result = C._ts_tree_cursor_goto_last_child_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
      return result === 1;
    }
    /**
     * Move this cursor to the parent of its current node.
     *
     * This returns \`true\` if the cursor successfully moved, and returns
     * \`false\` if there was no parent node (the cursor was already on the
     * root node).
     *
     * Note that the node the cursor was constructed with is considered the root
     * of the cursor, and the cursor cannot walk outside this node.
     */
    gotoParent() {
      marshalTreeCursor(this);
      const result = C._ts_tree_cursor_goto_parent_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
      return result === 1;
    }
    /**
     * Move this cursor to the next sibling of its current node.
     *
     * This returns \`true\` if the cursor successfully moved, and returns
     * \`false\` if there was no next sibling node.
     *
     * Note that the node the cursor was constructed with is considered the root
     * of the cursor, and the cursor cannot walk outside this node.
     */
    gotoNextSibling() {
      marshalTreeCursor(this);
      const result = C._ts_tree_cursor_goto_next_sibling_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
      return result === 1;
    }
    /**
     * Move this cursor to the previous sibling of its current node.
     *
     * This returns \`true\` if the cursor successfully moved, and returns
     * \`false\` if there was no previous sibling node.
     *
     * Note that this function may be slower than
     * {@link TreeCursor#gotoNextSibling} due to how node
     * positions are stored. In the worst case, this will need to iterate
     * through all the children up to the previous sibling node to recalculate
     * its position. Also note that the node the cursor was constructed with is
     * considered the root of the cursor, and the cursor cannot walk outside this node.
     */
    gotoPreviousSibling() {
      marshalTreeCursor(this);
      const result = C._ts_tree_cursor_goto_previous_sibling_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
      return result === 1;
    }
    /**
     * Move the cursor to the node that is the nth descendant of
     * the original node that the cursor was constructed with, where
     * zero represents the original node itself.
     */
    gotoDescendant(goalDescendantIndex) {
      marshalTreeCursor(this);
      C._ts_tree_cursor_goto_descendant_wasm(this.tree[0], goalDescendantIndex);
      unmarshalTreeCursor(this);
    }
    /**
     * Move this cursor to the first child of its current node that contains or
     * starts after the given byte offset.
     *
     * This returns \`true\` if the cursor successfully moved to a child node, and returns
     * \`false\` if no such child was found.
     */
    gotoFirstChildForIndex(goalIndex) {
      marshalTreeCursor(this);
      C.setValue(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalIndex, "i32");
      const result = C._ts_tree_cursor_goto_first_child_for_index_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
      return result === 1;
    }
    /**
     * Move this cursor to the first child of its current node that contains or
     * starts after the given byte offset.
     *
     * This returns the index of the child node if one was found, and returns
     * \`null\` if no such child was found.
     */
    gotoFirstChildForPosition(goalPosition) {
      marshalTreeCursor(this);
      marshalPoint(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalPosition);
      const result = C._ts_tree_cursor_goto_first_child_for_position_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
      return result === 1;
    }
    /**
     * Re-initialize this tree cursor to start at the original node that the
     * cursor was constructed with.
     */
    reset(node) {
      marshalNode(node);
      marshalTreeCursor(this, TRANSFER_BUFFER + SIZE_OF_NODE);
      C._ts_tree_cursor_reset_wasm(this.tree[0]);
      unmarshalTreeCursor(this);
    }
    /**
     * Re-initialize a tree cursor to the same position as another cursor.
     *
     * Unlike {@link TreeCursor#reset}, this will not lose parent
     * information and allows reusing already created cursors.
     */
    resetTo(cursor) {
      marshalTreeCursor(this, TRANSFER_BUFFER);
      marshalTreeCursor(cursor, TRANSFER_BUFFER + SIZE_OF_CURSOR);
      C._ts_tree_cursor_reset_to_wasm(this.tree[0], cursor.tree[0]);
      unmarshalTreeCursor(this);
    }
  }, __name(_a4, "TreeCursor"), _a4);
  var _a5;
  var Node = (_a5 = class {
    /** @internal */
    constructor(internal, {
      id,
      tree,
      startIndex,
      startPosition,
      other
    }) {
      /** @internal */
      // @ts-expect-error: never read
      __publicField(this, 0, 0);
      // Internal handle for Wasm
      /** @internal */
      __publicField(this, "_children");
      /** @internal */
      __publicField(this, "_namedChildren");
      /**
       * The numeric id for this node that is unique.
       *
       * Within a given syntax tree, no two nodes have the same id. However:
       *
       * * If a new tree is created based on an older tree, and a node from the old tree is reused in
       *   the process, then that node will have the same id in both trees.
       *
       * * A node not marked as having changes does not guarantee it was reused.
       *
       * * If a node is marked as having changed in the old tree, it will not be reused.
       */
      __publicField(this, "id");
      /** The byte index where this node starts. */
      __publicField(this, "startIndex");
      /** The position where this node starts. */
      __publicField(this, "startPosition");
      /** The tree that this node belongs to. */
      __publicField(this, "tree");
      assertInternal(internal);
      this[0] = other;
      this.id = id;
      this.tree = tree;
      this.startIndex = startIndex;
      this.startPosition = startPosition;
    }
    /** Get this node's type as a numerical id. */
    get typeId() {
      marshalNode(this);
      return C._ts_node_symbol_wasm(this.tree[0]);
    }
    /**
     * Get the node's type as a numerical id as it appears in the grammar,
     * ignoring aliases.
     */
    get grammarId() {
      marshalNode(this);
      return C._ts_node_grammar_symbol_wasm(this.tree[0]);
    }
    /** Get this node's type as a string. */
    get type() {
      return this.tree.language.types[this.typeId] || "ERROR";
    }
    /**
     * Get this node's symbol name as it appears in the grammar, ignoring
     * aliases as a string.
     */
    get grammarType() {
      return this.tree.language.types[this.grammarId] || "ERROR";
    }
    /**
     * Check if this node is *named*.
     *
     * Named nodes correspond to named rules in the grammar, whereas
     * *anonymous* nodes correspond to string literals in the grammar.
     */
    get isNamed() {
      marshalNode(this);
      return C._ts_node_is_named_wasm(this.tree[0]) === 1;
    }
    /**
     * Check if this node is *extra*.
     *
     * Extra nodes represent things like comments, which are not required
     * by the grammar, but can appear anywhere.
     */
    get isExtra() {
      marshalNode(this);
      return C._ts_node_is_extra_wasm(this.tree[0]) === 1;
    }
    /**
     * Check if this node represents a syntax error.
     *
     * Syntax errors represent parts of the code that could not be incorporated
     * into a valid syntax tree.
     */
    get isError() {
      marshalNode(this);
      return C._ts_node_is_error_wasm(this.tree[0]) === 1;
    }
    /**
     * Check if this node is *missing*.
     *
     * Missing nodes are inserted by the parser in order to recover from
     * certain kinds of syntax errors.
     */
    get isMissing() {
      marshalNode(this);
      return C._ts_node_is_missing_wasm(this.tree[0]) === 1;
    }
    /** Check if this node has been edited. */
    get hasChanges() {
      marshalNode(this);
      return C._ts_node_has_changes_wasm(this.tree[0]) === 1;
    }
    /**
     * Check if this node represents a syntax error or contains any syntax
     * errors anywhere within it.
     */
    get hasError() {
      marshalNode(this);
      return C._ts_node_has_error_wasm(this.tree[0]) === 1;
    }
    /** Get the byte index where this node ends. */
    get endIndex() {
      marshalNode(this);
      return C._ts_node_end_index_wasm(this.tree[0]);
    }
    /** Get the position where this node ends. */
    get endPosition() {
      marshalNode(this);
      C._ts_node_end_point_wasm(this.tree[0]);
      return unmarshalPoint(TRANSFER_BUFFER);
    }
    /** Get the string content of this node. */
    get text() {
      return getText(this.tree, this.startIndex, this.endIndex, this.startPosition);
    }
    /** Get this node's parse state. */
    get parseState() {
      marshalNode(this);
      return C._ts_node_parse_state_wasm(this.tree[0]);
    }
    /** Get the parse state after this node. */
    get nextParseState() {
      marshalNode(this);
      return C._ts_node_next_parse_state_wasm(this.tree[0]);
    }
    /** Check if this node is equal to another node. */
    equals(other) {
      return this.tree === other.tree && this.id === other.id;
    }
    /**
     * Get the node's child at the given index, where zero represents the first child.
     *
     * This method is fairly fast, but its cost is technically log(n), so if
     * you might be iterating over a long list of children, you should use
     * {@link Node#children} instead.
     */
    child(index) {
      marshalNode(this);
      C._ts_node_child_wasm(this.tree[0], index);
      return unmarshalNode(this.tree);
    }
    /**
     * Get this node's *named* child at the given index.
     *
     * See also {@link Node#isNamed}.
     * This method is fairly fast, but its cost is technically log(n), so if
     * you might be iterating over a long list of children, you should use
     * {@link Node#namedChildren} instead.
     */
    namedChild(index) {
      marshalNode(this);
      C._ts_node_named_child_wasm(this.tree[0], index);
      return unmarshalNode(this.tree);
    }
    /**
     * Get this node's child with the given numerical field id.
     *
     * See also {@link Node#childForFieldName}. You can
     * convert a field name to an id using {@link Language#fieldIdForName}.
     */
    childForFieldId(fieldId) {
      marshalNode(this);
      C._ts_node_child_by_field_id_wasm(this.tree[0], fieldId);
      return unmarshalNode(this.tree);
    }
    /**
     * Get the first child with the given field name.
     *
     * If multiple children may have the same field name, access them using
     * {@link Node#childrenForFieldName}.
     */
    childForFieldName(fieldName) {
      const fieldId = this.tree.language.fields.indexOf(fieldName);
      if (fieldId !== -1) return this.childForFieldId(fieldId);
      return null;
    }
    /** Get the field name of this node's child at the given index. */
    fieldNameForChild(index) {
      marshalNode(this);
      const address = C._ts_node_field_name_for_child_wasm(this.tree[0], index);
      if (!address) return null;
      return C.AsciiToString(address);
    }
    /** Get the field name of this node's named child at the given index. */
    fieldNameForNamedChild(index) {
      marshalNode(this);
      const address = C._ts_node_field_name_for_named_child_wasm(this.tree[0], index);
      if (!address) return null;
      return C.AsciiToString(address);
    }
    /**
     * Get an array of this node's children with a given field name.
     *
     * See also {@link Node#children}.
     */
    childrenForFieldName(fieldName) {
      const fieldId = this.tree.language.fields.indexOf(fieldName);
      if (fieldId !== -1 && fieldId !== 0) return this.childrenForFieldId(fieldId);
      return [];
    }
    /**
      * Get an array of this node's children with a given field id.
      *
      * See also {@link Node#childrenForFieldName}.
      */
    childrenForFieldId(fieldId) {
      marshalNode(this);
      C._ts_node_children_by_field_id_wasm(this.tree[0], fieldId);
      const count2 = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const result = new Array(count2);
      if (count2 > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count2; i2++) {
          result[i2] = unmarshalNode(this.tree, address);
          address += SIZE_OF_NODE;
        }
        C._free(buffer);
      }
      return result;
    }
    /** Get the node's first child that contains or starts after the given byte offset. */
    firstChildForIndex(index) {
      marshalNode(this);
      const address = TRANSFER_BUFFER + SIZE_OF_NODE;
      C.setValue(address, index, "i32");
      C._ts_node_first_child_for_byte_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get the node's first named child that contains or starts after the given byte offset. */
    firstNamedChildForIndex(index) {
      marshalNode(this);
      const address = TRANSFER_BUFFER + SIZE_OF_NODE;
      C.setValue(address, index, "i32");
      C._ts_node_first_named_child_for_byte_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get this node's number of children. */
    get childCount() {
      marshalNode(this);
      return C._ts_node_child_count_wasm(this.tree[0]);
    }
    /**
     * Get this node's number of *named* children.
     *
     * See also {@link Node#isNamed}.
     */
    get namedChildCount() {
      marshalNode(this);
      return C._ts_node_named_child_count_wasm(this.tree[0]);
    }
    /** Get this node's first child. */
    get firstChild() {
      return this.child(0);
    }
    /**
     * Get this node's first named child.
     *
     * See also {@link Node#isNamed}.
     */
    get firstNamedChild() {
      return this.namedChild(0);
    }
    /** Get this node's last child. */
    get lastChild() {
      return this.child(this.childCount - 1);
    }
    /**
     * Get this node's last named child.
     *
     * See also {@link Node#isNamed}.
     */
    get lastNamedChild() {
      return this.namedChild(this.namedChildCount - 1);
    }
    /**
     * Iterate over this node's children.
     *
     * If you're walking the tree recursively, you may want to use the
     * {@link TreeCursor} APIs directly instead.
     */
    get children() {
      if (!this._children) {
        marshalNode(this);
        C._ts_node_children_wasm(this.tree[0]);
        const count2 = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        this._children = new Array(count2);
        if (count2 > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count2; i2++) {
            this._children[i2] = unmarshalNode(this.tree, address);
            address += SIZE_OF_NODE;
          }
          C._free(buffer);
        }
      }
      return this._children;
    }
    /**
     * Iterate over this node's named children.
     *
     * See also {@link Node#children}.
     */
    get namedChildren() {
      if (!this._namedChildren) {
        marshalNode(this);
        C._ts_node_named_children_wasm(this.tree[0]);
        const count2 = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        this._namedChildren = new Array(count2);
        if (count2 > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count2; i2++) {
            this._namedChildren[i2] = unmarshalNode(this.tree, address);
            address += SIZE_OF_NODE;
          }
          C._free(buffer);
        }
      }
      return this._namedChildren;
    }
    /**
     * Get the descendants of this node that are the given type, or in the given types array.
     *
     * The types array should contain node type strings, which can be retrieved from {@link Language#types}.
     *
     * Additionally, a \`startPosition\` and \`endPosition\` can be passed in to restrict the search to a byte range.
     */
    descendantsOfType(types, startPosition = ZERO_POINT, endPosition = ZERO_POINT) {
      if (!Array.isArray(types)) types = [types];
      const symbols = [];
      const typesBySymbol = this.tree.language.types;
      for (const node_type of types) {
        if (node_type == "ERROR") {
          symbols.push(65535);
        }
      }
      for (let i2 = 0, n = typesBySymbol.length; i2 < n; i2++) {
        if (types.includes(typesBySymbol[i2])) {
          symbols.push(i2);
        }
      }
      const symbolsAddress = C._malloc(SIZE_OF_INT * symbols.length);
      for (let i2 = 0, n = symbols.length; i2 < n; i2++) {
        C.setValue(symbolsAddress + i2 * SIZE_OF_INT, symbols[i2], "i32");
      }
      marshalNode(this);
      C._ts_node_descendants_of_type_wasm(
        this.tree[0],
        symbolsAddress,
        symbols.length,
        startPosition.row,
        startPosition.column,
        endPosition.row,
        endPosition.column
      );
      const descendantCount = C.getValue(TRANSFER_BUFFER, "i32");
      const descendantAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const result = new Array(descendantCount);
      if (descendantCount > 0) {
        let address = descendantAddress;
        for (let i2 = 0; i2 < descendantCount; i2++) {
          result[i2] = unmarshalNode(this.tree, address);
          address += SIZE_OF_NODE;
        }
      }
      C._free(descendantAddress);
      C._free(symbolsAddress);
      return result;
    }
    /** Get this node's next sibling. */
    get nextSibling() {
      marshalNode(this);
      C._ts_node_next_sibling_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get this node's previous sibling. */
    get previousSibling() {
      marshalNode(this);
      C._ts_node_prev_sibling_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /**
     * Get this node's next *named* sibling.
     *
     * See also {@link Node#isNamed}.
     */
    get nextNamedSibling() {
      marshalNode(this);
      C._ts_node_next_named_sibling_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /**
     * Get this node's previous *named* sibling.
     *
     * See also {@link Node#isNamed}.
     */
    get previousNamedSibling() {
      marshalNode(this);
      C._ts_node_prev_named_sibling_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get the node's number of descendants, including one for the node itself. */
    get descendantCount() {
      marshalNode(this);
      return C._ts_node_descendant_count_wasm(this.tree[0]);
    }
    /**
     * Get this node's immediate parent.
     * Prefer {@link Node#childWithDescendant} for iterating over this node's ancestors.
     */
    get parent() {
      marshalNode(this);
      C._ts_node_parent_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /**
     * Get the node that contains \`descendant\`.
     *
     * Note that this can return \`descendant\` itself.
     */
    childWithDescendant(descendant) {
      marshalNode(this);
      marshalNode(descendant, 1);
      C._ts_node_child_with_descendant_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get the smallest node within this node that spans the given byte range. */
    descendantForIndex(start2, end = start2) {
      if (typeof start2 !== "number" || typeof end !== "number") {
        throw new Error("Arguments must be numbers");
      }
      marshalNode(this);
      const address = TRANSFER_BUFFER + SIZE_OF_NODE;
      C.setValue(address, start2, "i32");
      C.setValue(address + SIZE_OF_INT, end, "i32");
      C._ts_node_descendant_for_index_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get the smallest named node within this node that spans the given byte range. */
    namedDescendantForIndex(start2, end = start2) {
      if (typeof start2 !== "number" || typeof end !== "number") {
        throw new Error("Arguments must be numbers");
      }
      marshalNode(this);
      const address = TRANSFER_BUFFER + SIZE_OF_NODE;
      C.setValue(address, start2, "i32");
      C.setValue(address + SIZE_OF_INT, end, "i32");
      C._ts_node_named_descendant_for_index_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get the smallest node within this node that spans the given point range. */
    descendantForPosition(start2, end = start2) {
      if (!isPoint(start2) || !isPoint(end)) {
        throw new Error("Arguments must be {row, column} objects");
      }
      marshalNode(this);
      const address = TRANSFER_BUFFER + SIZE_OF_NODE;
      marshalPoint(address, start2);
      marshalPoint(address + SIZE_OF_POINT, end);
      C._ts_node_descendant_for_position_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /** Get the smallest named node within this node that spans the given point range. */
    namedDescendantForPosition(start2, end = start2) {
      if (!isPoint(start2) || !isPoint(end)) {
        throw new Error("Arguments must be {row, column} objects");
      }
      marshalNode(this);
      const address = TRANSFER_BUFFER + SIZE_OF_NODE;
      marshalPoint(address, start2);
      marshalPoint(address + SIZE_OF_POINT, end);
      C._ts_node_named_descendant_for_position_wasm(this.tree[0]);
      return unmarshalNode(this.tree);
    }
    /**
     * Create a new {@link TreeCursor} starting from this node.
     *
     * Note that the given node is considered the root of the cursor,
     * and the cursor cannot walk outside this node.
     */
    walk() {
      marshalNode(this);
      C._ts_tree_cursor_new_wasm(this.tree[0]);
      return new TreeCursor(INTERNAL, this.tree);
    }
    /**
     * Edit this node to keep it in-sync with source code that has been edited.
     *
     * This function is only rarely needed. When you edit a syntax tree with
     * the {@link Tree#edit} method, all of the nodes that you retrieve from
     * the tree afterward will already reflect the edit. You only need to
     * use {@link Node#edit} when you have a specific {@link Node} instance that
     * you want to keep and continue to use after an edit.
     */
    edit(edit) {
      if (this.startIndex >= edit.oldEndIndex) {
        this.startIndex = edit.newEndIndex + (this.startIndex - edit.oldEndIndex);
        let subbedPointRow;
        let subbedPointColumn;
        if (this.startPosition.row > edit.oldEndPosition.row) {
          subbedPointRow = this.startPosition.row - edit.oldEndPosition.row;
          subbedPointColumn = this.startPosition.column;
        } else {
          subbedPointRow = 0;
          subbedPointColumn = this.startPosition.column;
          if (this.startPosition.column >= edit.oldEndPosition.column) {
            subbedPointColumn = this.startPosition.column - edit.oldEndPosition.column;
          }
        }
        if (subbedPointRow > 0) {
          this.startPosition.row += subbedPointRow;
          this.startPosition.column = subbedPointColumn;
        } else {
          this.startPosition.column += subbedPointColumn;
        }
      } else if (this.startIndex > edit.startIndex) {
        this.startIndex = edit.newEndIndex;
        this.startPosition.row = edit.newEndPosition.row;
        this.startPosition.column = edit.newEndPosition.column;
      }
    }
    /** Get the S-expression representation of this node. */
    toString() {
      marshalNode(this);
      const address = C._ts_node_to_string_wasm(this.tree[0]);
      const result = C.AsciiToString(address);
      C._free(address);
      return result;
    }
  }, __name(_a5, "Node"), _a5);
  function unmarshalCaptures(query, tree, address, patternIndex, result) {
    for (let i2 = 0, n = result.length; i2 < n; i2++) {
      const captureIndex = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const node = unmarshalNode(tree, address);
      address += SIZE_OF_NODE;
      result[i2] = { patternIndex, name: query.captureNames[captureIndex], node };
    }
    return address;
  }
  __name(unmarshalCaptures, "unmarshalCaptures");
  function marshalNode(node, index = 0) {
    let address = TRANSFER_BUFFER + index * SIZE_OF_NODE;
    C.setValue(address, node.id, "i32");
    address += SIZE_OF_INT;
    C.setValue(address, node.startIndex, "i32");
    address += SIZE_OF_INT;
    C.setValue(address, node.startPosition.row, "i32");
    address += SIZE_OF_INT;
    C.setValue(address, node.startPosition.column, "i32");
    address += SIZE_OF_INT;
    C.setValue(address, node[0], "i32");
  }
  __name(marshalNode, "marshalNode");
  function unmarshalNode(tree, address = TRANSFER_BUFFER) {
    const id = C.getValue(address, "i32");
    address += SIZE_OF_INT;
    if (id === 0) return null;
    const index = C.getValue(address, "i32");
    address += SIZE_OF_INT;
    const row = C.getValue(address, "i32");
    address += SIZE_OF_INT;
    const column = C.getValue(address, "i32");
    address += SIZE_OF_INT;
    const other = C.getValue(address, "i32");
    const result = new Node(INTERNAL, {
      id,
      tree,
      startIndex: index,
      startPosition: { row, column },
      other
    });
    return result;
  }
  __name(unmarshalNode, "unmarshalNode");
  function marshalTreeCursor(cursor, address = TRANSFER_BUFFER) {
    C.setValue(address + 0 * SIZE_OF_INT, cursor[0], "i32");
    C.setValue(address + 1 * SIZE_OF_INT, cursor[1], "i32");
    C.setValue(address + 2 * SIZE_OF_INT, cursor[2], "i32");
    C.setValue(address + 3 * SIZE_OF_INT, cursor[3], "i32");
  }
  __name(marshalTreeCursor, "marshalTreeCursor");
  function unmarshalTreeCursor(cursor) {
    cursor[0] = C.getValue(TRANSFER_BUFFER + 0 * SIZE_OF_INT, "i32");
    cursor[1] = C.getValue(TRANSFER_BUFFER + 1 * SIZE_OF_INT, "i32");
    cursor[2] = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
    cursor[3] = C.getValue(TRANSFER_BUFFER + 3 * SIZE_OF_INT, "i32");
  }
  __name(unmarshalTreeCursor, "unmarshalTreeCursor");
  function marshalPoint(address, point) {
    C.setValue(address, point.row, "i32");
    C.setValue(address + SIZE_OF_INT, point.column, "i32");
  }
  __name(marshalPoint, "marshalPoint");
  function unmarshalPoint(address) {
    const result = {
      row: C.getValue(address, "i32") >>> 0,
      column: C.getValue(address + SIZE_OF_INT, "i32") >>> 0
    };
    return result;
  }
  __name(unmarshalPoint, "unmarshalPoint");
  function marshalRange(address, range) {
    marshalPoint(address, range.startPosition);
    address += SIZE_OF_POINT;
    marshalPoint(address, range.endPosition);
    address += SIZE_OF_POINT;
    C.setValue(address, range.startIndex, "i32");
    address += SIZE_OF_INT;
    C.setValue(address, range.endIndex, "i32");
    address += SIZE_OF_INT;
  }
  __name(marshalRange, "marshalRange");
  function unmarshalRange(address) {
    const result = {};
    result.startPosition = unmarshalPoint(address);
    address += SIZE_OF_POINT;
    result.endPosition = unmarshalPoint(address);
    address += SIZE_OF_POINT;
    result.startIndex = C.getValue(address, "i32") >>> 0;
    address += SIZE_OF_INT;
    result.endIndex = C.getValue(address, "i32") >>> 0;
    return result;
  }
  __name(unmarshalRange, "unmarshalRange");
  function marshalEdit(edit, address = TRANSFER_BUFFER) {
    marshalPoint(address, edit.startPosition);
    address += SIZE_OF_POINT;
    marshalPoint(address, edit.oldEndPosition);
    address += SIZE_OF_POINT;
    marshalPoint(address, edit.newEndPosition);
    address += SIZE_OF_POINT;
    C.setValue(address, edit.startIndex, "i32");
    address += SIZE_OF_INT;
    C.setValue(address, edit.oldEndIndex, "i32");
    address += SIZE_OF_INT;
    C.setValue(address, edit.newEndIndex, "i32");
    address += SIZE_OF_INT;
  }
  __name(marshalEdit, "marshalEdit");
  function unmarshalLanguageMetadata(address) {
    const major_version = C.getValue(address, "i32");
    const minor_version = C.getValue(address += SIZE_OF_INT, "i32");
    const patch_version = C.getValue(address += SIZE_OF_INT, "i32");
    return { major_version, minor_version, patch_version };
  }
  __name(unmarshalLanguageMetadata, "unmarshalLanguageMetadata");
  var LANGUAGE_FUNCTION_REGEX = /^tree_sitter_\\w+$/;
  var _a6;
  var Language = (_a6 = class {
    /** @internal */
    constructor(internal, address) {
      /** @internal */
      __publicField(this, 0, 0);
      // Internal handle for Wasm
      /**
       * A list of all node types in the language. The index of each type in this
       * array is its node type id.
       */
      __publicField(this, "types");
      /**
       * A list of all field names in the language. The index of each field name in
       * this array is its field id.
       */
      __publicField(this, "fields");
      assertInternal(internal);
      this[0] = address;
      this.types = new Array(C._ts_language_symbol_count(this[0]));
      for (let i2 = 0, n = this.types.length; i2 < n; i2++) {
        if (C._ts_language_symbol_type(this[0], i2) < 2) {
          this.types[i2] = C.UTF8ToString(C._ts_language_symbol_name(this[0], i2));
        }
      }
      this.fields = new Array(C._ts_language_field_count(this[0]) + 1);
      for (let i2 = 0, n = this.fields.length; i2 < n; i2++) {
        const fieldName = C._ts_language_field_name_for_id(this[0], i2);
        if (fieldName !== 0) {
          this.fields[i2] = C.UTF8ToString(fieldName);
        } else {
          this.fields[i2] = null;
        }
      }
    }
    /**
     * Gets the name of the language.
     */
    get name() {
      const ptr = C._ts_language_name(this[0]);
      if (ptr === 0) return null;
      return C.UTF8ToString(ptr);
    }
    /**
     * Gets the ABI version of the language.
     */
    get abiVersion() {
      return C._ts_language_abi_version(this[0]);
    }
    /**
    * Get the metadata for this language. This information is generated by the
    * CLI, and relies on the language author providing the correct metadata in
    * the language's \`tree-sitter.json\` file.
    */
    get metadata() {
      C._ts_language_metadata_wasm(this[0]);
      const length = C.getValue(TRANSFER_BUFFER, "i32");
      if (length === 0) return null;
      return unmarshalLanguageMetadata(TRANSFER_BUFFER + SIZE_OF_INT);
    }
    /**
     * Gets the number of fields in the language.
     */
    get fieldCount() {
      return this.fields.length - 1;
    }
    /**
     * Gets the number of states in the language.
     */
    get stateCount() {
      return C._ts_language_state_count(this[0]);
    }
    /**
     * Get the field id for a field name.
     */
    fieldIdForName(fieldName) {
      const result = this.fields.indexOf(fieldName);
      return result !== -1 ? result : null;
    }
    /**
     * Get the field name for a field id.
     */
    fieldNameForId(fieldId) {
      return this.fields[fieldId] ?? null;
    }
    /**
     * Get the node type id for a node type name.
     */
    idForNodeType(type, named) {
      const typeLength = C.lengthBytesUTF8(type);
      const typeAddress = C._malloc(typeLength + 1);
      C.stringToUTF8(type, typeAddress, typeLength + 1);
      const result = C._ts_language_symbol_for_name(this[0], typeAddress, typeLength, named ? 1 : 0);
      C._free(typeAddress);
      return result || null;
    }
    /**
     * Gets the number of node types in the language.
     */
    get nodeTypeCount() {
      return C._ts_language_symbol_count(this[0]);
    }
    /**
     * Get the node type name for a node type id.
     */
    nodeTypeForId(typeId) {
      const name2 = C._ts_language_symbol_name(this[0], typeId);
      return name2 ? C.UTF8ToString(name2) : null;
    }
    /**
     * Check if a node type is named.
     *
     * @see {@link https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html#named-vs-anonymous-nodes}
     */
    nodeTypeIsNamed(typeId) {
      return C._ts_language_type_is_named_wasm(this[0], typeId) ? true : false;
    }
    /**
     * Check if a node type is visible.
     */
    nodeTypeIsVisible(typeId) {
      return C._ts_language_type_is_visible_wasm(this[0], typeId) ? true : false;
    }
    /**
     * Get the supertypes ids of this language.
     *
     * @see {@link https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types.html?highlight=supertype#supertype-nodes}
     */
    get supertypes() {
      C._ts_language_supertypes_wasm(this[0]);
      const count2 = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const result = new Array(count2);
      if (count2 > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count2; i2++) {
          result[i2] = C.getValue(address, "i16");
          address += SIZE_OF_SHORT;
        }
      }
      return result;
    }
    /**
     * Get the subtype ids for a given supertype node id.
     */
    subtypes(supertype) {
      C._ts_language_subtypes_wasm(this[0], supertype);
      const count2 = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const result = new Array(count2);
      if (count2 > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count2; i2++) {
          result[i2] = C.getValue(address, "i16");
          address += SIZE_OF_SHORT;
        }
      }
      return result;
    }
    /**
     * Get the next state id for a given state id and node type id.
     */
    nextState(stateId, typeId) {
      return C._ts_language_next_state(this[0], stateId, typeId);
    }
    /**
     * Create a new lookahead iterator for this language and parse state.
     *
     * This returns \`null\` if state is invalid for this language.
     *
     * Iterating {@link LookaheadIterator} will yield valid symbols in the given
     * parse state. A newly created iterator is not positioned on a symbol, so
     * {@link LookaheadIterator#currentType} returns \`null\` until the first
     * iteration step.
     *
     * Lookahead iterators can be useful for generating suggestions and improving
     * syntax error diagnostics. To get symbols valid in an \`ERROR\` node, use the
     * lookahead iterator on its first leaf node state. For \`MISSING\` nodes, a
     * lookahead iterator created on the previous non-extra leaf node may be
     * appropriate.
     */
    lookaheadIterator(stateId) {
      const address = C._ts_lookahead_iterator_new(this[0], stateId);
      if (address) return new LookaheadIterator(INTERNAL, address, this);
      return null;
    }
    /**
     * Load a language from a WebAssembly module.
     * The module can be provided as a path to a file, a \`URL\` to a file, or as a
     * buffer.
     */
    static async load(input) {
      let binary2;
      if (input instanceof Uint8Array) {
        binary2 = input;
      } else {
        const response = await fetch(input);
        if (!response.ok) {
          const body2 = await response.text();
          throw new Error(\`Language.load failed with status \${response.status}.

\${body2}\`);
        }
        const retryResp = response.clone();
        try {
          binary2 = await WebAssembly.compileStreaming(response);
        } catch (reason) {
          console.error("wasm streaming compile failed:", reason);
          console.error("falling back to ArrayBuffer instantiation");
          binary2 = new Uint8Array(await retryResp.arrayBuffer());
        }
      }
      const mod = await C.loadWebAssemblyModule(binary2, { loadAsync: true });
      return _a6.loadFromWasmExports(mod, { sync: false });
    }
    static loadFromWasmExports(mod, { sync }) {
      const symbolNames = Object.keys(mod);
      const functionName = symbolNames.find((key) => LANGUAGE_FUNCTION_REGEX.test(key) && !key.includes("external_scanner_"));
      if (!functionName) {
        console.log(\`Couldn't find language function in Wasm file. Symbols:
\${JSON.stringify(symbolNames, null, 2)}\`);
        throw new Error(\`Language.\${sync ? "loadSync" : "load"} failed: no language function found in Wasm file\`);
      }
      const languageAddress = mod[functionName]();
      return new _a6(INTERNAL, languageAddress);
    }
    /**
     * Load a language synchronously from a pre-compiled WebAssembly module.
     * Use this when the host environment provides a \`WebAssembly.Module\` directly.
     */
    static loadSync(wasmModule) {
      const mod = C.loadWebAssemblyModule(wasmModule, { loadAsync: false });
      return _a6.loadFromWasmExports(mod, { sync: true });
    }
  }, __name(_a6, "Language"), _a6);
  async function Module2(moduleArg = {}) {
    var moduleRtn;
    var Module = moduleArg;
    var ENVIRONMENT_IS_WEB = typeof window == "object";
    var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != "undefined";
    var ENVIRONMENT_IS_NODE = typeof process == "object" && process.versions?.node && process.type != "renderer";
    Module.currentQueryProgressCallback = null;
    Module.currentProgressCallback = null;
    Module.currentLogCallback = null;
    Module.currentParseCallback = null;
    var arguments_ = [];
    var thisProgram = "./this.program";
    var quit_ = /* @__PURE__ */ __name((status, toThrow) => {
      throw toThrow;
    }, "quit_");
    var _scriptName = void 0;
    var scriptDirectory = "";
    function locateFile(path) {
      if (Module["locateFile"]) {
        return Module["locateFile"](path, scriptDirectory);
      }
      return scriptDirectory + path;
    }
    __name(locateFile, "locateFile");
    var readAsync, readBinary;
    if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      try {
        scriptDirectory = new URL(".", _scriptName).href;
      } catch {
      }
      {
        if (ENVIRONMENT_IS_WORKER) {
          readBinary = /* @__PURE__ */ __name((url) => {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(
              /** @type{!ArrayBuffer} */
              xhr.response
            );
          }, "readBinary");
        }
        readAsync = /* @__PURE__ */ __name(async (url) => {
          if (isFileURI(url)) {
            return new Promise((resolve, reject) => {
              var xhr = new XMLHttpRequest();
              xhr.open("GET", url, true);
              xhr.responseType = "arraybuffer";
              xhr.onload = () => {
                if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                  resolve(xhr.response);
                  return;
                }
                reject(xhr.status);
              };
              xhr.onerror = reject;
              xhr.send(null);
            });
          }
          var response = await fetch(url, {
            credentials: "same-origin"
          });
          if (response.ok) {
            return response.arrayBuffer();
          }
          throw new Error(response.status + " : " + response.url);
        }, "readAsync");
      }
    } else {
    }
    var out = console.log.bind(console);
    var err = console.error.bind(console);
    var dynamicLibraries = [];
    var wasmBinary;
    var ABORT = false;
    var EXITSTATUS;
    var isFileURI = /* @__PURE__ */ __name((filename) => filename.startsWith("file://"), "isFileURI");
    var readyPromiseResolve, readyPromiseReject;
    var wasmMemory;
    var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
    var HEAP64, HEAPU64;
    var HEAP_DATA_VIEW;
    var runtimeInitialized = false;
    function updateMemoryViews() {
      var b2 = wasmMemory.buffer;
      Module["HEAP8"] = HEAP8 = new Int8Array(b2);
      Module["HEAP16"] = HEAP16 = new Int16Array(b2);
      Module["HEAPU8"] = HEAPU8 = new Uint8Array(b2);
      Module["HEAPU16"] = HEAPU16 = new Uint16Array(b2);
      Module["HEAP32"] = HEAP32 = new Int32Array(b2);
      Module["HEAPU32"] = HEAPU32 = new Uint32Array(b2);
      Module["HEAPF32"] = HEAPF32 = new Float32Array(b2);
      Module["HEAPF64"] = HEAPF64 = new Float64Array(b2);
      Module["HEAP64"] = HEAP64 = new BigInt64Array(b2);
      Module["HEAPU64"] = HEAPU64 = new BigUint64Array(b2);
      Module["HEAP_DATA_VIEW"] = HEAP_DATA_VIEW = new DataView(b2);
      LE_HEAP_UPDATE();
    }
    __name(updateMemoryViews, "updateMemoryViews");
    function initMemory() {
      if (Module["wasmMemory"]) {
        wasmMemory = Module["wasmMemory"];
      } else {
        var INITIAL_MEMORY = Module["INITIAL_MEMORY"] || 33554432;
        wasmMemory = new WebAssembly.Memory({
          "initial": INITIAL_MEMORY / 65536,
          // In theory we should not need to emit the maximum if we want "unlimited"
          // or 4GB of memory, but VMs error on that atm, see
          // https://github.com/emscripten-core/emscripten/issues/14130
          // And in the pthreads case we definitely need to emit a maximum. So
          // always emit one.
          "maximum": 32768
        });
      }
      updateMemoryViews();
    }
    __name(initMemory, "initMemory");
    var __RELOC_FUNCS__ = [];
    function preRun() {
      if (Module["preRun"]) {
        if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
        while (Module["preRun"].length) {
          addOnPreRun(Module["preRun"].shift());
        }
      }
      callRuntimeCallbacks(onPreRuns);
    }
    __name(preRun, "preRun");
    function initRuntime() {
      runtimeInitialized = true;
      callRuntimeCallbacks(__RELOC_FUNCS__);
      wasmExports["__wasm_call_ctors"]();
      callRuntimeCallbacks(onPostCtors);
    }
    __name(initRuntime, "initRuntime");
    function preMain() {
    }
    __name(preMain, "preMain");
    function postRun() {
      if (Module["postRun"]) {
        if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
        while (Module["postRun"].length) {
          addOnPostRun(Module["postRun"].shift());
        }
      }
      callRuntimeCallbacks(onPostRuns);
    }
    __name(postRun, "postRun");
    function abort(what) {
      Module["onAbort"]?.(what);
      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
      what += ". Build with -sASSERTIONS for more info.";
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject?.(e);
      throw e;
    }
    __name(abort, "abort");
    var wasmBinaryFile;
    function findWasmBinary() {
      if (Module["locateFile"]) {
        return locateFile("web-tree-sitter.wasm");
      }
      return new URL("web-tree-sitter.wasm", void 0).href;
    }
    __name(findWasmBinary, "findWasmBinary");
    function getBinarySync(file) {
      if (file == wasmBinaryFile && wasmBinary) {
        return new Uint8Array(wasmBinary);
      }
      if (readBinary) {
        return readBinary(file);
      }
      throw "both async and sync fetching of the wasm failed";
    }
    __name(getBinarySync, "getBinarySync");
    async function getWasmBinary(binaryFile) {
      if (!wasmBinary) {
        try {
          var response = await readAsync(binaryFile);
          return new Uint8Array(response);
        } catch {
        }
      }
      return getBinarySync(binaryFile);
    }
    __name(getWasmBinary, "getWasmBinary");
    async function instantiateArrayBuffer(binaryFile, imports) {
      try {
        var binary2 = await getWasmBinary(binaryFile);
        var instance2 = await WebAssembly.instantiate(binary2, imports);
        return instance2;
      } catch (reason) {
        err(\`failed to asynchronously prepare wasm: \${reason}\`);
        abort(reason);
      }
    }
    __name(instantiateArrayBuffer, "instantiateArrayBuffer");
    async function instantiateAsync(binary2, binaryFile, imports) {
      if (!binary2 && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE) {
        try {
          var response = fetch(binaryFile, {
            credentials: "same-origin"
          });
          var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
          return instantiationResult;
        } catch (reason) {
          err(\`wasm streaming compile failed: \${reason}\`);
          err("falling back to ArrayBuffer instantiation");
        }
      }
      return instantiateArrayBuffer(binaryFile, imports);
    }
    __name(instantiateAsync, "instantiateAsync");
    function getWasmImports() {
      return {
        "env": wasmImports,
        "wasi_snapshot_preview1": wasmImports,
        "GOT.mem": new Proxy(wasmImports, GOTHandler),
        "GOT.func": new Proxy(wasmImports, GOTHandler)
      };
    }
    __name(getWasmImports, "getWasmImports");
    async function createWasm() {
      function receiveInstance(instance2, module2) {
        wasmExports = instance2.exports;
        wasmExports = relocateExports(wasmExports, 1024);
        var metadata2 = getDylinkMetadata(module2);
        if (metadata2.neededDynlibs) {
          dynamicLibraries = metadata2.neededDynlibs.concat(dynamicLibraries);
        }
        mergeLibSymbols(wasmExports, "main");
        LDSO.init();
        loadDylibs();
        __RELOC_FUNCS__.push(wasmExports["__wasm_apply_data_relocs"]);
        assignWasmExports(wasmExports);
        return wasmExports;
      }
      __name(receiveInstance, "receiveInstance");
      function receiveInstantiationResult(result2) {
        return receiveInstance(result2["instance"], result2["module"]);
      }
      __name(receiveInstantiationResult, "receiveInstantiationResult");
      var info2 = getWasmImports();
      if (Module["instantiateWasm"]) {
        return new Promise((resolve, reject) => {
          Module["instantiateWasm"](info2, (mod, inst) => {
            resolve(receiveInstance(mod, inst));
          });
        });
      }
      wasmBinaryFile ?? (wasmBinaryFile = findWasmBinary());
      var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info2);
      var exports = receiveInstantiationResult(result);
      return exports;
    }
    __name(createWasm, "createWasm");
    const _ExitStatus = class _ExitStatus {
      constructor(status) {
        __publicField(this, "name", "ExitStatus");
        this.message = \`Program terminated with exit(\${status})\`;
        this.status = status;
      }
    };
    __name(_ExitStatus, "ExitStatus");
    let ExitStatus = _ExitStatus;
    var GOT = {};
    var currentModuleWeakSymbols = /* @__PURE__ */ new Set([]);
    var GOTHandler = {
      get(obj, symName) {
        var rtn = GOT[symName];
        if (!rtn) {
          rtn = GOT[symName] = new WebAssembly.Global({
            "value": "i32",
            "mutable": true
          });
        }
        if (!currentModuleWeakSymbols.has(symName)) {
          rtn.required = true;
        }
        return rtn;
      }
    };
    var LE_ATOMICS_NATIVE_BYTE_ORDER = [];
    var LE_HEAP_LOAD_F32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat32(byteOffset, true), "LE_HEAP_LOAD_F32");
    var LE_HEAP_LOAD_F64 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat64(byteOffset, true), "LE_HEAP_LOAD_F64");
    var LE_HEAP_LOAD_I16 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt16(byteOffset, true), "LE_HEAP_LOAD_I16");
    var LE_HEAP_LOAD_I32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt32(byteOffset, true), "LE_HEAP_LOAD_I32");
    var LE_HEAP_LOAD_I64 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getBigInt64(byteOffset, true), "LE_HEAP_LOAD_I64");
    var LE_HEAP_LOAD_U32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getUint32(byteOffset, true), "LE_HEAP_LOAD_U32");
    var LE_HEAP_STORE_F32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat32(byteOffset, value, true), "LE_HEAP_STORE_F32");
    var LE_HEAP_STORE_F64 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat64(byteOffset, value, true), "LE_HEAP_STORE_F64");
    var LE_HEAP_STORE_I16 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt16(byteOffset, value, true), "LE_HEAP_STORE_I16");
    var LE_HEAP_STORE_I32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt32(byteOffset, value, true), "LE_HEAP_STORE_I32");
    var LE_HEAP_STORE_I64 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setBigInt64(byteOffset, value, true), "LE_HEAP_STORE_I64");
    var LE_HEAP_STORE_U32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setUint32(byteOffset, value, true), "LE_HEAP_STORE_U32");
    var callRuntimeCallbacks = /* @__PURE__ */ __name((callbacks) => {
      while (callbacks.length > 0) {
        callbacks.shift()(Module);
      }
    }, "callRuntimeCallbacks");
    var onPostRuns = [];
    var addOnPostRun = /* @__PURE__ */ __name((cb) => onPostRuns.push(cb), "addOnPostRun");
    var onPreRuns = [];
    var addOnPreRun = /* @__PURE__ */ __name((cb) => onPreRuns.push(cb), "addOnPreRun");
    var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder() : void 0;
    var findStringEnd = /* @__PURE__ */ __name((heapOrArray, idx, maxBytesToRead, ignoreNul) => {
      var maxIdx = idx + maxBytesToRead;
      if (ignoreNul) return maxIdx;
      while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
      return idx;
    }, "findStringEnd");
    var UTF8ArrayToString = /* @__PURE__ */ __name((heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
      var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = "";
      while (idx < endPtr) {
        var u0 = heapOrArray[idx++];
        if (!(u0 & 128)) {
          str += String.fromCharCode(u0);
          continue;
        }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 224) == 192) {
          str += String.fromCharCode((u0 & 31) << 6 | u1);
          continue;
        }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 240) == 224) {
          u0 = (u0 & 15) << 12 | u1 << 6 | u2;
        } else {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
        }
        if (u0 < 65536) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 65536;
          str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
        }
      }
      return str;
    }, "UTF8ArrayToString");
    var getDylinkMetadata = /* @__PURE__ */ __name((binary2) => {
      var offset = 0;
      var end = 0;
      function getU8() {
        return binary2[offset++];
      }
      __name(getU8, "getU8");
      function getLEB() {
        var ret = 0;
        var mul = 1;
        while (1) {
          var byte = binary2[offset++];
          ret += (byte & 127) * mul;
          mul *= 128;
          if (!(byte & 128)) break;
        }
        return ret;
      }
      __name(getLEB, "getLEB");
      function getString() {
        var len = getLEB();
        offset += len;
        return UTF8ArrayToString(binary2, offset - len, len);
      }
      __name(getString, "getString");
      function getStringList() {
        var count22 = getLEB();
        var rtn = [];
        while (count22--) rtn.push(getString());
        return rtn;
      }
      __name(getStringList, "getStringList");
      function failIf(condition, message) {
        if (condition) throw new Error(message);
      }
      __name(failIf, "failIf");
      if (binary2 instanceof WebAssembly.Module) {
        var dylinkSection = WebAssembly.Module.customSections(binary2, "dylink.0");
        failIf(dylinkSection.length === 0, "need dylink section");
        binary2 = new Uint8Array(dylinkSection[0]);
        end = binary2.length;
      } else {
        var int32View = new Uint32Array(new Uint8Array(binary2.subarray(0, 24)).buffer);
        var magicNumberFound = int32View[0] == 1836278016 || int32View[0] == 6386541;
        failIf(!magicNumberFound, "need to see wasm magic number");
        failIf(binary2[8] !== 0, "need the dylink section to be first");
        offset = 9;
        var section_size = getLEB();
        end = offset + section_size;
        var name2 = getString();
        failIf(name2 !== "dylink.0");
      }
      var customSection = {
        neededDynlibs: [],
        tlsExports: /* @__PURE__ */ new Set(),
        weakImports: /* @__PURE__ */ new Set(),
        runtimePaths: []
      };
      var WASM_DYLINK_MEM_INFO = 1;
      var WASM_DYLINK_NEEDED = 2;
      var WASM_DYLINK_EXPORT_INFO = 3;
      var WASM_DYLINK_IMPORT_INFO = 4;
      var WASM_DYLINK_RUNTIME_PATH = 5;
      var WASM_SYMBOL_TLS = 256;
      var WASM_SYMBOL_BINDING_MASK = 3;
      var WASM_SYMBOL_BINDING_WEAK = 1;
      while (offset < end) {
        var subsectionType = getU8();
        var subsectionSize = getLEB();
        if (subsectionType === WASM_DYLINK_MEM_INFO) {
          customSection.memorySize = getLEB();
          customSection.memoryAlign = getLEB();
          customSection.tableSize = getLEB();
          customSection.tableAlign = getLEB();
        } else if (subsectionType === WASM_DYLINK_NEEDED) {
          customSection.neededDynlibs = getStringList();
        } else if (subsectionType === WASM_DYLINK_EXPORT_INFO) {
          var count2 = getLEB();
          while (count2--) {
            var symname = getString();
            var flags2 = getLEB();
            if (flags2 & WASM_SYMBOL_TLS) {
              customSection.tlsExports.add(symname);
            }
          }
        } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
          var count2 = getLEB();
          while (count2--) {
            var modname = getString();
            var symname = getString();
            var flags2 = getLEB();
            if ((flags2 & WASM_SYMBOL_BINDING_MASK) == WASM_SYMBOL_BINDING_WEAK) {
              customSection.weakImports.add(symname);
            }
          }
        } else if (subsectionType === WASM_DYLINK_RUNTIME_PATH) {
          customSection.runtimePaths = getStringList();
        } else {
          offset += subsectionSize;
        }
      }
      return customSection;
    }, "getDylinkMetadata");
    function getValue(ptr, type = "i8") {
      if (type.endsWith("*")) type = "*";
      switch (type) {
        case "i1":
          return HEAP8[ptr];
        case "i8":
          return HEAP8[ptr];
        case "i16":
          return LE_HEAP_LOAD_I16((ptr >> 1) * 2);
        case "i32":
          return LE_HEAP_LOAD_I32((ptr >> 2) * 4);
        case "i64":
          return LE_HEAP_LOAD_I64((ptr >> 3) * 8);
        case "float":
          return LE_HEAP_LOAD_F32((ptr >> 2) * 4);
        case "double":
          return LE_HEAP_LOAD_F64((ptr >> 3) * 8);
        case "*":
          return LE_HEAP_LOAD_U32((ptr >> 2) * 4);
        default:
          abort(\`invalid type for getValue: \${type}\`);
      }
    }
    __name(getValue, "getValue");
    var newDSO = /* @__PURE__ */ __name((name2, handle2, syms) => {
      var dso = {
        refcount: Infinity,
        name: name2,
        exports: syms,
        global: true
      };
      LDSO.loadedLibsByName[name2] = dso;
      if (handle2 != void 0) {
        LDSO.loadedLibsByHandle[handle2] = dso;
      }
      return dso;
    }, "newDSO");
    var LDSO = {
      loadedLibsByName: {},
      loadedLibsByHandle: {},
      init() {
        newDSO("__main__", 0, wasmImports);
      }
    };
    var ___heap_base = 82240;
    var alignMemory = /* @__PURE__ */ __name((size, alignment) => Math.ceil(size / alignment) * alignment, "alignMemory");
    var getMemory = /* @__PURE__ */ __name((size) => {
      if (runtimeInitialized) {
        return _calloc(size, 1);
      }
      var ret = ___heap_base;
      var end = ret + alignMemory(size, 16);
      ___heap_base = end;
      GOT["__heap_base"].value = end;
      return ret;
    }, "getMemory");
    var isInternalSym = /* @__PURE__ */ __name((symName) => ["__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js"].includes(symName) || symName.startsWith("__em_js__"), "isInternalSym");
    var uleb128EncodeWithLen = /* @__PURE__ */ __name((arr) => {
      const n = arr.length;
      return [n % 128 | 128, n >> 7, ...arr];
    }, "uleb128EncodeWithLen");
    var wasmTypeCodes = {
      "i": 127,
      // i32
      "p": 127,
      // i32
      "j": 126,
      // i64
      "f": 125,
      // f32
      "d": 124,
      // f64
      "e": 111
    };
    var generateTypePack = /* @__PURE__ */ __name((types) => uleb128EncodeWithLen(Array.from(types, (type) => {
      var code = wasmTypeCodes[type];
      return code;
    })), "generateTypePack");
    var convertJsFunctionToWasm = /* @__PURE__ */ __name((func2, sig) => {
      var bytes = Uint8Array.of(
        0,
        97,
        115,
        109,
        // magic ("\\0asm")
        1,
        0,
        0,
        0,
        // version: 1
        1,
        ...uleb128EncodeWithLen([
          1,
          // count: 1
          96,
          // param types
          ...generateTypePack(sig.slice(1)),
          // return types (for now only supporting [] if \`void\` and single [T] otherwise)
          ...generateTypePack(sig[0] === "v" ? "" : sig[0])
        ]),
        // The rest of the module is static
        2,
        7,
        // import section
        // (import "e" "f" (func 0 (type 0)))
        1,
        1,
        101,
        1,
        102,
        0,
        0,
        7,
        5,
        // export section
        // (export "f" (func 0 (type 0)))
        1,
        1,
        102,
        0,
        0
      );
      var module2 = new WebAssembly.Module(bytes);
      var instance2 = new WebAssembly.Instance(module2, {
        "e": {
          "f": func2
        }
      });
      var wrappedFunc = instance2.exports["f"];
      return wrappedFunc;
    }, "convertJsFunctionToWasm");
    var wasmTableMirror = [];
    var wasmTable = new WebAssembly.Table({
      "initial": 31,
      "element": "anyfunc"
    });
    var getWasmTableEntry = /* @__PURE__ */ __name((funcPtr) => {
      var func2 = wasmTableMirror[funcPtr];
      if (!func2) {
        wasmTableMirror[funcPtr] = func2 = wasmTable.get(funcPtr);
      }
      return func2;
    }, "getWasmTableEntry");
    var updateTableMap = /* @__PURE__ */ __name((offset, count2) => {
      if (functionsInTableMap) {
        for (var i2 = offset; i2 < offset + count2; i2++) {
          var item = getWasmTableEntry(i2);
          if (item) {
            functionsInTableMap.set(item, i2);
          }
        }
      }
    }, "updateTableMap");
    var functionsInTableMap;
    var getFunctionAddress = /* @__PURE__ */ __name((func2) => {
      if (!functionsInTableMap) {
        functionsInTableMap = /* @__PURE__ */ new WeakMap();
        updateTableMap(0, wasmTable.length);
      }
      return functionsInTableMap.get(func2) || 0;
    }, "getFunctionAddress");
    var freeTableIndexes = [];
    var getEmptyTableSlot = /* @__PURE__ */ __name(() => {
      if (freeTableIndexes.length) {
        return freeTableIndexes.pop();
      }
      return wasmTable["grow"](1);
    }, "getEmptyTableSlot");
    var setWasmTableEntry = /* @__PURE__ */ __name((idx, func2) => {
      wasmTable.set(idx, func2);
      wasmTableMirror[idx] = wasmTable.get(idx);
    }, "setWasmTableEntry");
    var addFunction = /* @__PURE__ */ __name((func2, sig) => {
      var rtn = getFunctionAddress(func2);
      if (rtn) {
        return rtn;
      }
      var ret = getEmptyTableSlot();
      try {
        setWasmTableEntry(ret, func2);
      } catch (err2) {
        if (!(err2 instanceof TypeError)) {
          throw err2;
        }
        var wrapped = convertJsFunctionToWasm(func2, sig);
        setWasmTableEntry(ret, wrapped);
      }
      functionsInTableMap.set(func2, ret);
      return ret;
    }, "addFunction");
    var updateGOT = /* @__PURE__ */ __name((exports, replace) => {
      for (var symName in exports) {
        if (isInternalSym(symName)) {
          continue;
        }
        var value = exports[symName];
        GOT[symName] || (GOT[symName] = new WebAssembly.Global({
          "value": "i32",
          "mutable": true
        }));
        if (replace || GOT[symName].value == 0) {
          if (typeof value == "function") {
            GOT[symName].value = addFunction(value);
          } else if (typeof value == "number") {
            GOT[symName].value = value;
          } else {
            err(\`unhandled export type for '\${symName}': \${typeof value}\`);
          }
        }
      }
    }, "updateGOT");
    var relocateExports = /* @__PURE__ */ __name((exports, memoryBase2, replace) => {
      var relocated = {};
      for (var e in exports) {
        var value = exports[e];
        if (typeof value == "object") {
          value = value.value;
        }
        if (typeof value == "number") {
          value += memoryBase2;
        }
        relocated[e] = value;
      }
      updateGOT(relocated, replace);
      return relocated;
    }, "relocateExports");
    var isSymbolDefined = /* @__PURE__ */ __name((symName) => {
      var existing = wasmImports[symName];
      if (!existing || existing.stub) {
        return false;
      }
      return true;
    }, "isSymbolDefined");
    var dynCall = /* @__PURE__ */ __name((sig, ptr, args2 = [], promising = false) => {
      var func2 = getWasmTableEntry(ptr);
      var rtn = func2(...args2);
      function convert(rtn2) {
        return rtn2;
      }
      __name(convert, "convert");
      return convert(rtn);
    }, "dynCall");
    var stackSave = /* @__PURE__ */ __name(() => _emscripten_stack_get_current(), "stackSave");
    var stackRestore = /* @__PURE__ */ __name((val) => __emscripten_stack_restore(val), "stackRestore");
    var createInvokeFunction = /* @__PURE__ */ __name((sig) => (ptr, ...args2) => {
      var sp = stackSave();
      try {
        return dynCall(sig, ptr, args2);
      } catch (e) {
        stackRestore(sp);
        if (e !== e + 0) throw e;
        _setThrew(1, 0);
        if (sig[0] == "j") return 0n;
      }
    }, "createInvokeFunction");
    var resolveGlobalSymbol = /* @__PURE__ */ __name((symName, direct = false) => {
      var sym;
      if (isSymbolDefined(symName)) {
        sym = wasmImports[symName];
      } else if (symName.startsWith("invoke_")) {
        sym = wasmImports[symName] = createInvokeFunction(symName.split("_")[1]);
      }
      return {
        sym,
        name: symName
      };
    }, "resolveGlobalSymbol");
    var onPostCtors = [];
    var addOnPostCtor = /* @__PURE__ */ __name((cb) => onPostCtors.push(cb), "addOnPostCtor");
    var UTF8ToString = /* @__PURE__ */ __name((ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "", "UTF8ToString");
    var loadWebAssemblyModule = /* @__PURE__ */ __name((binary, flags, libName, localScope, handle) => {
      var metadata = getDylinkMetadata(binary);
      function loadModule() {
        var memAlign = Math.pow(2, metadata.memoryAlign);
        var memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0;
        var tableBase = metadata.tableSize ? wasmTable.length : 0;
        if (handle) {
          HEAP8[handle + 8] = 1;
          LE_HEAP_STORE_U32((handle + 12 >> 2) * 4, memoryBase);
          LE_HEAP_STORE_I32((handle + 16 >> 2) * 4, metadata.memorySize);
          LE_HEAP_STORE_U32((handle + 20 >> 2) * 4, tableBase);
          LE_HEAP_STORE_I32((handle + 24 >> 2) * 4, metadata.tableSize);
        }
        if (metadata.tableSize) {
          wasmTable.grow(metadata.tableSize);
        }
        var moduleExports;
        function resolveSymbol(sym) {
          var resolved = resolveGlobalSymbol(sym).sym;
          if (!resolved && localScope) {
            resolved = localScope[sym];
          }
          if (!resolved) {
            resolved = moduleExports[sym];
          }
          return resolved;
        }
        __name(resolveSymbol, "resolveSymbol");
        var proxyHandler = {
          get(stubs, prop) {
            switch (prop) {
              case "__memory_base":
                return memoryBase;
              case "__table_base":
                return tableBase;
            }
            if (prop in wasmImports && !wasmImports[prop].stub) {
              var res = wasmImports[prop];
              return res;
            }
            if (!(prop in stubs)) {
              var resolved;
              stubs[prop] = (...args2) => {
                resolved || (resolved = resolveSymbol(prop));
                return resolved(...args2);
              };
            }
            return stubs[prop];
          }
        };
        var proxy = new Proxy({}, proxyHandler);
        currentModuleWeakSymbols = metadata.weakImports;
        var info = {
          "GOT.mem": new Proxy({}, GOTHandler),
          "GOT.func": new Proxy({}, GOTHandler),
          "env": proxy,
          "wasi_snapshot_preview1": proxy
        };
        function postInstantiation(module, instance) {
          updateTableMap(tableBase, metadata.tableSize);
          moduleExports = relocateExports(instance.exports, memoryBase);
          if (!flags.allowUndefined) {
            reportUndefinedSymbols();
          }
          function addEmAsm(addr, body) {
            var args = [];
            var arity = 0;
            for (; arity < 16; arity++) {
              if (body.indexOf("$" + arity) != -1) {
                args.push("$" + arity);
              } else {
                break;
              }
            }
            args = args.join(",");
            var func = \`(\${args}) => { \${body} };\`;
            ASM_CONSTS[start] = eval(func);
          }
          __name(addEmAsm, "addEmAsm");
          if ("__start_em_asm" in moduleExports) {
            var start = moduleExports["__start_em_asm"];
            var stop = moduleExports["__stop_em_asm"];
            while (start < stop) {
              var jsString = UTF8ToString(start);
              addEmAsm(start, jsString);
              start = HEAPU8.indexOf(0, start) + 1;
            }
          }
          function addEmJs(name, cSig, body) {
            var jsArgs = [];
            cSig = cSig.slice(1, -1);
            if (cSig != "void") {
              cSig = cSig.split(",");
              for (var i in cSig) {
                var jsArg = cSig[i].split(" ").pop();
                jsArgs.push(jsArg.replace("*", ""));
              }
            }
            var func = \`(\${jsArgs}) => \${body};\`;
            moduleExports[name] = eval(func);
          }
          __name(addEmJs, "addEmJs");
          for (var name in moduleExports) {
            if (name.startsWith("__em_js__")) {
              var start = moduleExports[name];
              var jsString = UTF8ToString(start);
              var parts = jsString.split("<::>");
              addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]);
              delete moduleExports[name];
            }
          }
          var applyRelocs = moduleExports["__wasm_apply_data_relocs"];
          if (applyRelocs) {
            if (runtimeInitialized) {
              applyRelocs();
            } else {
              __RELOC_FUNCS__.push(applyRelocs);
            }
          }
          var init = moduleExports["__wasm_call_ctors"];
          if (init) {
            if (runtimeInitialized) {
              init();
            } else {
              addOnPostCtor(init);
            }
          }
          return moduleExports;
        }
        __name(postInstantiation, "postInstantiation");
        if (flags.loadAsync) {
          return (async () => {
            var instance2;
            if (binary instanceof WebAssembly.Module) {
              instance2 = new WebAssembly.Instance(binary, info);
            } else {
              ({ module: binary, instance: instance2 } = await WebAssembly.instantiate(binary, info));
            }
            return postInstantiation(binary, instance2);
          })();
        }
        var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
        var instance = new WebAssembly.Instance(module, info);
        return postInstantiation(module, instance);
      }
      __name(loadModule, "loadModule");
      flags = {
        ...flags,
        rpath: {
          parentLibPath: libName,
          paths: metadata.runtimePaths
        }
      };
      if (flags.loadAsync) {
        return metadata.neededDynlibs.reduce((chain, dynNeeded) => chain.then(() => loadDynamicLibrary(dynNeeded, flags, localScope)), Promise.resolve()).then(loadModule);
      }
      metadata.neededDynlibs.forEach((needed) => loadDynamicLibrary(needed, flags, localScope));
      return loadModule();
    }, "loadWebAssemblyModule");
    var mergeLibSymbols = /* @__PURE__ */ __name((exports, libName2) => {
      for (var [sym, exp] of Object.entries(exports)) {
        const setImport = /* @__PURE__ */ __name((target) => {
          if (!isSymbolDefined(target)) {
            wasmImports[target] = exp;
          }
        }, "setImport");
        setImport(sym);
        const main_alias = "__main_argc_argv";
        if (sym == "main") {
          setImport(main_alias);
        }
        if (sym == main_alias) {
          setImport("main");
        }
      }
    }, "mergeLibSymbols");
    var asyncLoad = /* @__PURE__ */ __name(async (url) => {
      var arrayBuffer = await readAsync(url);
      return new Uint8Array(arrayBuffer);
    }, "asyncLoad");
    function loadDynamicLibrary(libName2, flags2 = {
      global: true,
      nodelete: true
    }, localScope2, handle2) {
      var dso = LDSO.loadedLibsByName[libName2];
      if (dso) {
        if (!flags2.global) {
          if (localScope2) {
            Object.assign(localScope2, dso.exports);
          }
        } else if (!dso.global) {
          dso.global = true;
          mergeLibSymbols(dso.exports, libName2);
        }
        if (flags2.nodelete && dso.refcount !== Infinity) {
          dso.refcount = Infinity;
        }
        dso.refcount++;
        if (handle2) {
          LDSO.loadedLibsByHandle[handle2] = dso;
        }
        return flags2.loadAsync ? Promise.resolve(true) : true;
      }
      dso = newDSO(libName2, handle2, "loading");
      dso.refcount = flags2.nodelete ? Infinity : 1;
      dso.global = flags2.global;
      function loadLibData() {
        if (handle2) {
          var data = LE_HEAP_LOAD_U32((handle2 + 28 >> 2) * 4);
          var dataSize = LE_HEAP_LOAD_U32((handle2 + 32 >> 2) * 4);
          if (data && dataSize) {
            var libData = HEAP8.slice(data, data + dataSize);
            return flags2.loadAsync ? Promise.resolve(libData) : libData;
          }
        }
        var libFile = locateFile(libName2);
        if (flags2.loadAsync) {
          return asyncLoad(libFile);
        }
        if (!readBinary) {
          throw new Error(\`\${libFile}: file not found, and synchronous loading of external files is not available\`);
        }
        return readBinary(libFile);
      }
      __name(loadLibData, "loadLibData");
      function getExports() {
        if (flags2.loadAsync) {
          return loadLibData().then((libData) => loadWebAssemblyModule(libData, flags2, libName2, localScope2, handle2));
        }
        return loadWebAssemblyModule(loadLibData(), flags2, libName2, localScope2, handle2);
      }
      __name(getExports, "getExports");
      function moduleLoaded(exports) {
        if (dso.global) {
          mergeLibSymbols(exports, libName2);
        } else if (localScope2) {
          Object.assign(localScope2, exports);
        }
        dso.exports = exports;
      }
      __name(moduleLoaded, "moduleLoaded");
      if (flags2.loadAsync) {
        return getExports().then((exports) => {
          moduleLoaded(exports);
          return true;
        });
      }
      moduleLoaded(getExports());
      return true;
    }
    __name(loadDynamicLibrary, "loadDynamicLibrary");
    var reportUndefinedSymbols = /* @__PURE__ */ __name(() => {
      for (var [symName, entry] of Object.entries(GOT)) {
        if (entry.value == 0) {
          var value = resolveGlobalSymbol(symName, true).sym;
          if (!value && !entry.required) {
            continue;
          }
          if (typeof value == "function") {
            entry.value = addFunction(value, value.sig);
          } else if (typeof value == "number") {
            entry.value = value;
          } else {
            throw new Error(\`bad export type for '\${symName}': \${typeof value}\`);
          }
        }
      }
    }, "reportUndefinedSymbols");
    var runDependencies = 0;
    var dependenciesFulfilled = null;
    var removeRunDependency = /* @__PURE__ */ __name((id) => {
      runDependencies--;
      Module["monitorRunDependencies"]?.(runDependencies);
      if (runDependencies == 0) {
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback();
        }
      }
    }, "removeRunDependency");
    var addRunDependency = /* @__PURE__ */ __name((id) => {
      runDependencies++;
      Module["monitorRunDependencies"]?.(runDependencies);
    }, "addRunDependency");
    var loadDylibs = /* @__PURE__ */ __name(async () => {
      if (!dynamicLibraries.length) {
        reportUndefinedSymbols();
        return;
      }
      addRunDependency("loadDylibs");
      for (var lib of dynamicLibraries) {
        await loadDynamicLibrary(lib, {
          loadAsync: true,
          global: true,
          nodelete: true,
          allowUndefined: true
        });
      }
      reportUndefinedSymbols();
      removeRunDependency("loadDylibs");
    }, "loadDylibs");
    var noExitRuntime = true;
    function setValue(ptr, value, type = "i8") {
      if (type.endsWith("*")) type = "*";
      switch (type) {
        case "i1":
          HEAP8[ptr] = value;
          break;
        case "i8":
          HEAP8[ptr] = value;
          break;
        case "i16":
          LE_HEAP_STORE_I16((ptr >> 1) * 2, value);
          break;
        case "i32":
          LE_HEAP_STORE_I32((ptr >> 2) * 4, value);
          break;
        case "i64":
          LE_HEAP_STORE_I64((ptr >> 3) * 8, BigInt(value));
          break;
        case "float":
          LE_HEAP_STORE_F32((ptr >> 2) * 4, value);
          break;
        case "double":
          LE_HEAP_STORE_F64((ptr >> 3) * 8, value);
          break;
        case "*":
          LE_HEAP_STORE_U32((ptr >> 2) * 4, value);
          break;
        default:
          abort(\`invalid type for setValue: \${type}\`);
      }
    }
    __name(setValue, "setValue");
    var ___memory_base = new WebAssembly.Global({
      "value": "i32",
      "mutable": false
    }, 1024);
    var ___stack_high = 82240;
    var ___stack_low = 16704;
    var ___stack_pointer = new WebAssembly.Global({
      "value": "i32",
      "mutable": true
    }, 82240);
    var ___table_base = new WebAssembly.Global({
      "value": "i32",
      "mutable": false
    }, 1);
    var __abort_js = /* @__PURE__ */ __name(() => abort(""), "__abort_js");
    __abort_js.sig = "v";
    var getHeapMax = /* @__PURE__ */ __name(() => (
      // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
      // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
      // for any code that deals with heap sizes, which would require special
      // casing all heap size related code to treat 0 specially.
      2147483648
    ), "getHeapMax");
    var growMemory = /* @__PURE__ */ __name((size) => {
      var oldHeapSize = wasmMemory.buffer.byteLength;
      var pages = (size - oldHeapSize + 65535) / 65536 | 0;
      try {
        wasmMemory.grow(pages);
        updateMemoryViews();
        return 1;
      } catch (e) {
      }
    }, "growMemory");
    var _emscripten_resize_heap = /* @__PURE__ */ __name((requestedSize) => {
      var oldSize = HEAPU8.length;
      requestedSize >>>= 0;
      var maxHeapSize = getHeapMax();
      if (requestedSize > maxHeapSize) {
        return false;
      }
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
        var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
        var replacement = growMemory(newSize);
        if (replacement) {
          return true;
        }
      }
      return false;
    }, "_emscripten_resize_heap");
    _emscripten_resize_heap.sig = "ip";
    var _fd_close = /* @__PURE__ */ __name((fd) => 52, "_fd_close");
    _fd_close.sig = "ii";
    var INT53_MAX = 9007199254740992;
    var INT53_MIN = -9007199254740992;
    var bigintToI53Checked = /* @__PURE__ */ __name((num) => num < INT53_MIN || num > INT53_MAX ? NaN : Number(num), "bigintToI53Checked");
    function _fd_seek(fd, offset, whence, newOffset) {
      offset = bigintToI53Checked(offset);
      return 70;
    }
    __name(_fd_seek, "_fd_seek");
    _fd_seek.sig = "iijip";
    var printCharBuffers = [null, [], []];
    var printChar = /* @__PURE__ */ __name((stream, curr) => {
      var buffer = printCharBuffers[stream];
      if (curr === 0 || curr === 10) {
        (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
        buffer.length = 0;
      } else {
        buffer.push(curr);
      }
    }, "printChar");
    var _fd_write = /* @__PURE__ */ __name((fd, iov, iovcnt, pnum) => {
      var num = 0;
      for (var i2 = 0; i2 < iovcnt; i2++) {
        var ptr = LE_HEAP_LOAD_U32((iov >> 2) * 4);
        var len = LE_HEAP_LOAD_U32((iov + 4 >> 2) * 4);
        iov += 8;
        for (var j2 = 0; j2 < len; j2++) {
          printChar(fd, HEAPU8[ptr + j2]);
        }
        num += len;
      }
      LE_HEAP_STORE_U32((pnum >> 2) * 4, num);
      return 0;
    }, "_fd_write");
    _fd_write.sig = "iippp";
    function _tree_sitter_log_callback(isLexMessage, messageAddress) {
      if (Module.currentLogCallback) {
        const message = UTF8ToString(messageAddress);
        Module.currentLogCallback(message, isLexMessage !== 0);
      }
    }
    __name(_tree_sitter_log_callback, "_tree_sitter_log_callback");
    function _tree_sitter_parse_callback(inputBufferAddress, index, row, column, lengthAddress) {
      const INPUT_BUFFER_SIZE = 10 * 1024;
      const string2 = Module.currentParseCallback(index, {
        row,
        column
      });
      if (typeof string2 === "string") {
        setValue(lengthAddress, string2.length, "i32");
        stringToUTF16(string2, inputBufferAddress, INPUT_BUFFER_SIZE);
      } else {
        setValue(lengthAddress, 0, "i32");
      }
    }
    __name(_tree_sitter_parse_callback, "_tree_sitter_parse_callback");
    function _tree_sitter_progress_callback(currentOffset, hasError) {
      if (Module.currentProgressCallback) {
        return Module.currentProgressCallback({
          currentOffset,
          hasError
        });
      }
      return false;
    }
    __name(_tree_sitter_progress_callback, "_tree_sitter_progress_callback");
    function _tree_sitter_query_progress_callback(currentOffset) {
      if (Module.currentQueryProgressCallback) {
        return Module.currentQueryProgressCallback({
          currentOffset
        });
      }
      return false;
    }
    __name(_tree_sitter_query_progress_callback, "_tree_sitter_query_progress_callback");
    var runtimeKeepaliveCounter = 0;
    var keepRuntimeAlive = /* @__PURE__ */ __name(() => noExitRuntime || runtimeKeepaliveCounter > 0, "keepRuntimeAlive");
    var _proc_exit = /* @__PURE__ */ __name((code) => {
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        Module["onExit"]?.(code);
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    }, "_proc_exit");
    _proc_exit.sig = "vi";
    var exitJS = /* @__PURE__ */ __name((status, implicit) => {
      EXITSTATUS = status;
      _proc_exit(status);
    }, "exitJS");
    var handleException = /* @__PURE__ */ __name((e) => {
      if (e instanceof ExitStatus || e == "unwind") {
        return EXITSTATUS;
      }
      quit_(1, e);
    }, "handleException");
    var lengthBytesUTF8 = /* @__PURE__ */ __name((str) => {
      var len = 0;
      for (var i2 = 0; i2 < str.length; ++i2) {
        var c = str.charCodeAt(i2);
        if (c <= 127) {
          len++;
        } else if (c <= 2047) {
          len += 2;
        } else if (c >= 55296 && c <= 57343) {
          len += 4;
          ++i2;
        } else {
          len += 3;
        }
      }
      return len;
    }, "lengthBytesUTF8");
    var stringToUTF8Array = /* @__PURE__ */ __name((str, heap, outIdx, maxBytesToWrite) => {
      if (!(maxBytesToWrite > 0)) return 0;
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1;
      for (var i2 = 0; i2 < str.length; ++i2) {
        var u = str.codePointAt(i2);
        if (u <= 127) {
          if (outIdx >= endIdx) break;
          heap[outIdx++] = u;
        } else if (u <= 2047) {
          if (outIdx + 1 >= endIdx) break;
          heap[outIdx++] = 192 | u >> 6;
          heap[outIdx++] = 128 | u & 63;
        } else if (u <= 65535) {
          if (outIdx + 2 >= endIdx) break;
          heap[outIdx++] = 224 | u >> 12;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        } else {
          if (outIdx + 3 >= endIdx) break;
          heap[outIdx++] = 240 | u >> 18;
          heap[outIdx++] = 128 | u >> 12 & 63;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
          i2++;
        }
      }
      heap[outIdx] = 0;
      return outIdx - startIdx;
    }, "stringToUTF8Array");
    var stringToUTF8 = /* @__PURE__ */ __name((str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite), "stringToUTF8");
    var stackAlloc = /* @__PURE__ */ __name((sz) => __emscripten_stack_alloc(sz), "stackAlloc");
    var stringToUTF8OnStack = /* @__PURE__ */ __name((str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    }, "stringToUTF8OnStack");
    var AsciiToString = /* @__PURE__ */ __name((ptr) => {
      var str = "";
      while (1) {
        var ch = HEAPU8[ptr++];
        if (!ch) return str;
        str += String.fromCharCode(ch);
      }
    }, "AsciiToString");
    var stringToUTF16 = /* @__PURE__ */ __name((str, outPtr, maxBytesToWrite) => {
      maxBytesToWrite ?? (maxBytesToWrite = 2147483647);
      if (maxBytesToWrite < 2) return 0;
      maxBytesToWrite -= 2;
      var startPtr = outPtr;
      var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
      for (var i2 = 0; i2 < numCharsToWrite; ++i2) {
        var codeUnit = str.charCodeAt(i2);
        LE_HEAP_STORE_I16((outPtr >> 1) * 2, codeUnit);
        outPtr += 2;
      }
      LE_HEAP_STORE_I16((outPtr >> 1) * 2, 0);
      return outPtr - startPtr;
    }, "stringToUTF16");
    LE_ATOMICS_NATIVE_BYTE_ORDER = new Int8Array(new Int16Array([1]).buffer)[0] === 1 ? [
      /* little endian */
      ((x2) => x2),
      ((x2) => x2),
      void 0,
      ((x2) => x2)
    ] : [
      /* big endian */
      ((x2) => x2),
      ((x2) => ((x2 & 65280) << 8 | (x2 & 255) << 24) >> 16),
      void 0,
      ((x2) => x2 >> 24 & 255 | x2 >> 8 & 65280 | (x2 & 65280) << 8 | (x2 & 255) << 24)
    ];
    function LE_HEAP_UPDATE() {
      HEAPU16.unsigned = ((x2) => x2 & 65535);
      HEAPU32.unsigned = ((x2) => x2 >>> 0);
    }
    __name(LE_HEAP_UPDATE, "LE_HEAP_UPDATE");
    {
      initMemory();
      if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
      if (Module["print"]) out = Module["print"];
      if (Module["printErr"]) err = Module["printErr"];
      if (Module["dynamicLibraries"]) dynamicLibraries = Module["dynamicLibraries"];
      if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
      if (Module["arguments"]) arguments_ = Module["arguments"];
      if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
      if (Module["preInit"]) {
        if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
        while (Module["preInit"].length > 0) {
          Module["preInit"].shift()();
        }
      }
    }
    Module["setValue"] = setValue;
    Module["getValue"] = getValue;
    Module["UTF8ToString"] = UTF8ToString;
    Module["stringToUTF8"] = stringToUTF8;
    Module["lengthBytesUTF8"] = lengthBytesUTF8;
    Module["AsciiToString"] = AsciiToString;
    Module["stringToUTF16"] = stringToUTF16;
    Module["loadWebAssemblyModule"] = loadWebAssemblyModule;
    Module["LE_HEAP_STORE_I64"] = LE_HEAP_STORE_I64;
    var ASM_CONSTS = {};
    var _malloc, _calloc, _realloc, _free, _ts_range_edit, _memcmp, _ts_language_symbol_count, _ts_language_state_count, _ts_language_abi_version, _ts_language_name, _ts_language_field_count, _ts_language_next_state, _ts_language_symbol_name, _ts_language_symbol_for_name, _strncmp, _ts_language_symbol_type, _ts_language_field_name_for_id, _ts_lookahead_iterator_new, _ts_lookahead_iterator_delete, _ts_lookahead_iterator_reset_state, _ts_lookahead_iterator_reset, _ts_lookahead_iterator_next, _ts_lookahead_iterator_current_symbol, _ts_point_edit, _ts_parser_delete, _ts_parser_reset, _ts_parser_set_language, _ts_parser_set_included_ranges, _ts_query_new, _ts_query_delete, _iswspace, _iswalnum, _ts_query_copy, _ts_query_pattern_count, _ts_query_capture_count, _ts_query_string_count, _ts_query_capture_name_for_id, _ts_query_capture_quantifier_for_id, _ts_query_string_value_for_id, _ts_query_predicates_for_pattern, _ts_query_start_byte_for_pattern, _ts_query_end_byte_for_pattern, _ts_query_is_pattern_rooted, _ts_query_is_pattern_non_local, _ts_query_is_pattern_guaranteed_at_step, _ts_query_disable_capture, _ts_query_disable_pattern, _ts_tree_copy, _ts_tree_delete, _ts_init, _ts_parser_new_wasm, _ts_parser_enable_logger_wasm, _ts_parser_parse_wasm, _ts_parser_included_ranges_wasm, _ts_language_type_is_named_wasm, _ts_language_type_is_visible_wasm, _ts_language_metadata_wasm, _ts_language_supertypes_wasm, _ts_language_subtypes_wasm, _ts_tree_root_node_wasm, _ts_tree_root_node_with_offset_wasm, _ts_tree_edit_wasm, _ts_tree_included_ranges_wasm, _ts_tree_get_changed_ranges_wasm, _ts_tree_cursor_new_wasm, _ts_tree_cursor_copy_wasm, _ts_tree_cursor_delete_wasm, _ts_tree_cursor_reset_wasm, _ts_tree_cursor_reset_to_wasm, _ts_tree_cursor_goto_first_child_wasm, _ts_tree_cursor_goto_last_child_wasm, _ts_tree_cursor_goto_first_child_for_index_wasm, _ts_tree_cursor_goto_first_child_for_position_wasm, _ts_tree_cursor_goto_next_sibling_wasm, _ts_tree_cursor_goto_previous_sibling_wasm, _ts_tree_cursor_goto_descendant_wasm, _ts_tree_cursor_goto_parent_wasm, _ts_tree_cursor_current_node_type_id_wasm, _ts_tree_cursor_current_node_state_id_wasm, _ts_tree_cursor_current_node_is_named_wasm, _ts_tree_cursor_current_node_is_missing_wasm, _ts_tree_cursor_current_node_id_wasm, _ts_tree_cursor_start_position_wasm, _ts_tree_cursor_end_position_wasm, _ts_tree_cursor_start_index_wasm, _ts_tree_cursor_end_index_wasm, _ts_tree_cursor_current_field_id_wasm, _ts_tree_cursor_current_depth_wasm, _ts_tree_cursor_current_descendant_index_wasm, _ts_tree_cursor_current_node_wasm, _ts_node_symbol_wasm, _ts_node_field_name_for_child_wasm, _ts_node_field_name_for_named_child_wasm, _ts_node_children_by_field_id_wasm, _ts_node_first_child_for_byte_wasm, _ts_node_first_named_child_for_byte_wasm, _ts_node_grammar_symbol_wasm, _ts_node_child_count_wasm, _ts_node_named_child_count_wasm, _ts_node_child_wasm, _ts_node_named_child_wasm, _ts_node_child_by_field_id_wasm, _ts_node_next_sibling_wasm, _ts_node_prev_sibling_wasm, _ts_node_next_named_sibling_wasm, _ts_node_prev_named_sibling_wasm, _ts_node_descendant_count_wasm, _ts_node_parent_wasm, _ts_node_child_with_descendant_wasm, _ts_node_descendant_for_index_wasm, _ts_node_named_descendant_for_index_wasm, _ts_node_descendant_for_position_wasm, _ts_node_named_descendant_for_position_wasm, _ts_node_start_point_wasm, _ts_node_end_point_wasm, _ts_node_start_index_wasm, _ts_node_end_index_wasm, _ts_node_to_string_wasm, _ts_node_children_wasm, _ts_node_named_children_wasm, _ts_node_descendants_of_type_wasm, _ts_node_is_named_wasm, _ts_node_has_changes_wasm, _ts_node_has_error_wasm, _ts_node_is_error_wasm, _ts_node_is_missing_wasm, _ts_node_is_extra_wasm, _ts_node_parse_state_wasm, _ts_node_next_parse_state_wasm, _ts_query_matches_wasm, _ts_query_captures_wasm, _memset, _memcpy, _memmove, _iswalpha, _iswblank, _iswdigit, _iswlower, _iswpunct, _iswupper, _iswxdigit, _memchr, _strlen, _strcmp, _strncat, _strncpy, _towlower, _towupper, _setThrew, __emscripten_stack_restore, __emscripten_stack_alloc, _emscripten_stack_get_current, ___wasm_apply_data_relocs;
    function assignWasmExports(wasmExports2) {
      Module["_malloc"] = _malloc = wasmExports2["malloc"];
      Module["_calloc"] = _calloc = wasmExports2["calloc"];
      Module["_realloc"] = _realloc = wasmExports2["realloc"];
      Module["_free"] = _free = wasmExports2["free"];
      Module["_ts_range_edit"] = _ts_range_edit = wasmExports2["ts_range_edit"];
      Module["_memcmp"] = _memcmp = wasmExports2["memcmp"];
      Module["_ts_language_symbol_count"] = _ts_language_symbol_count = wasmExports2["ts_language_symbol_count"];
      Module["_ts_language_state_count"] = _ts_language_state_count = wasmExports2["ts_language_state_count"];
      Module["_ts_language_abi_version"] = _ts_language_abi_version = wasmExports2["ts_language_abi_version"];
      Module["_ts_language_name"] = _ts_language_name = wasmExports2["ts_language_name"];
      Module["_ts_language_field_count"] = _ts_language_field_count = wasmExports2["ts_language_field_count"];
      Module["_ts_language_next_state"] = _ts_language_next_state = wasmExports2["ts_language_next_state"];
      Module["_ts_language_symbol_name"] = _ts_language_symbol_name = wasmExports2["ts_language_symbol_name"];
      Module["_ts_language_symbol_for_name"] = _ts_language_symbol_for_name = wasmExports2["ts_language_symbol_for_name"];
      Module["_strncmp"] = _strncmp = wasmExports2["strncmp"];
      Module["_ts_language_symbol_type"] = _ts_language_symbol_type = wasmExports2["ts_language_symbol_type"];
      Module["_ts_language_field_name_for_id"] = _ts_language_field_name_for_id = wasmExports2["ts_language_field_name_for_id"];
      Module["_ts_lookahead_iterator_new"] = _ts_lookahead_iterator_new = wasmExports2["ts_lookahead_iterator_new"];
      Module["_ts_lookahead_iterator_delete"] = _ts_lookahead_iterator_delete = wasmExports2["ts_lookahead_iterator_delete"];
      Module["_ts_lookahead_iterator_reset_state"] = _ts_lookahead_iterator_reset_state = wasmExports2["ts_lookahead_iterator_reset_state"];
      Module["_ts_lookahead_iterator_reset"] = _ts_lookahead_iterator_reset = wasmExports2["ts_lookahead_iterator_reset"];
      Module["_ts_lookahead_iterator_next"] = _ts_lookahead_iterator_next = wasmExports2["ts_lookahead_iterator_next"];
      Module["_ts_lookahead_iterator_current_symbol"] = _ts_lookahead_iterator_current_symbol = wasmExports2["ts_lookahead_iterator_current_symbol"];
      Module["_ts_point_edit"] = _ts_point_edit = wasmExports2["ts_point_edit"];
      Module["_ts_parser_delete"] = _ts_parser_delete = wasmExports2["ts_parser_delete"];
      Module["_ts_parser_reset"] = _ts_parser_reset = wasmExports2["ts_parser_reset"];
      Module["_ts_parser_set_language"] = _ts_parser_set_language = wasmExports2["ts_parser_set_language"];
      Module["_ts_parser_set_included_ranges"] = _ts_parser_set_included_ranges = wasmExports2["ts_parser_set_included_ranges"];
      Module["_ts_query_new"] = _ts_query_new = wasmExports2["ts_query_new"];
      Module["_ts_query_delete"] = _ts_query_delete = wasmExports2["ts_query_delete"];
      Module["_iswspace"] = _iswspace = wasmExports2["iswspace"];
      Module["_iswalnum"] = _iswalnum = wasmExports2["iswalnum"];
      Module["_ts_query_copy"] = _ts_query_copy = wasmExports2["ts_query_copy"];
      Module["_ts_query_pattern_count"] = _ts_query_pattern_count = wasmExports2["ts_query_pattern_count"];
      Module["_ts_query_capture_count"] = _ts_query_capture_count = wasmExports2["ts_query_capture_count"];
      Module["_ts_query_string_count"] = _ts_query_string_count = wasmExports2["ts_query_string_count"];
      Module["_ts_query_capture_name_for_id"] = _ts_query_capture_name_for_id = wasmExports2["ts_query_capture_name_for_id"];
      Module["_ts_query_capture_quantifier_for_id"] = _ts_query_capture_quantifier_for_id = wasmExports2["ts_query_capture_quantifier_for_id"];
      Module["_ts_query_string_value_for_id"] = _ts_query_string_value_for_id = wasmExports2["ts_query_string_value_for_id"];
      Module["_ts_query_predicates_for_pattern"] = _ts_query_predicates_for_pattern = wasmExports2["ts_query_predicates_for_pattern"];
      Module["_ts_query_start_byte_for_pattern"] = _ts_query_start_byte_for_pattern = wasmExports2["ts_query_start_byte_for_pattern"];
      Module["_ts_query_end_byte_for_pattern"] = _ts_query_end_byte_for_pattern = wasmExports2["ts_query_end_byte_for_pattern"];
      Module["_ts_query_is_pattern_rooted"] = _ts_query_is_pattern_rooted = wasmExports2["ts_query_is_pattern_rooted"];
      Module["_ts_query_is_pattern_non_local"] = _ts_query_is_pattern_non_local = wasmExports2["ts_query_is_pattern_non_local"];
      Module["_ts_query_is_pattern_guaranteed_at_step"] = _ts_query_is_pattern_guaranteed_at_step = wasmExports2["ts_query_is_pattern_guaranteed_at_step"];
      Module["_ts_query_disable_capture"] = _ts_query_disable_capture = wasmExports2["ts_query_disable_capture"];
      Module["_ts_query_disable_pattern"] = _ts_query_disable_pattern = wasmExports2["ts_query_disable_pattern"];
      Module["_ts_tree_copy"] = _ts_tree_copy = wasmExports2["ts_tree_copy"];
      Module["_ts_tree_delete"] = _ts_tree_delete = wasmExports2["ts_tree_delete"];
      Module["_ts_init"] = _ts_init = wasmExports2["ts_init"];
      Module["_ts_parser_new_wasm"] = _ts_parser_new_wasm = wasmExports2["ts_parser_new_wasm"];
      Module["_ts_parser_enable_logger_wasm"] = _ts_parser_enable_logger_wasm = wasmExports2["ts_parser_enable_logger_wasm"];
      Module["_ts_parser_parse_wasm"] = _ts_parser_parse_wasm = wasmExports2["ts_parser_parse_wasm"];
      Module["_ts_parser_included_ranges_wasm"] = _ts_parser_included_ranges_wasm = wasmExports2["ts_parser_included_ranges_wasm"];
      Module["_ts_language_type_is_named_wasm"] = _ts_language_type_is_named_wasm = wasmExports2["ts_language_type_is_named_wasm"];
      Module["_ts_language_type_is_visible_wasm"] = _ts_language_type_is_visible_wasm = wasmExports2["ts_language_type_is_visible_wasm"];
      Module["_ts_language_metadata_wasm"] = _ts_language_metadata_wasm = wasmExports2["ts_language_metadata_wasm"];
      Module["_ts_language_supertypes_wasm"] = _ts_language_supertypes_wasm = wasmExports2["ts_language_supertypes_wasm"];
      Module["_ts_language_subtypes_wasm"] = _ts_language_subtypes_wasm = wasmExports2["ts_language_subtypes_wasm"];
      Module["_ts_tree_root_node_wasm"] = _ts_tree_root_node_wasm = wasmExports2["ts_tree_root_node_wasm"];
      Module["_ts_tree_root_node_with_offset_wasm"] = _ts_tree_root_node_with_offset_wasm = wasmExports2["ts_tree_root_node_with_offset_wasm"];
      Module["_ts_tree_edit_wasm"] = _ts_tree_edit_wasm = wasmExports2["ts_tree_edit_wasm"];
      Module["_ts_tree_included_ranges_wasm"] = _ts_tree_included_ranges_wasm = wasmExports2["ts_tree_included_ranges_wasm"];
      Module["_ts_tree_get_changed_ranges_wasm"] = _ts_tree_get_changed_ranges_wasm = wasmExports2["ts_tree_get_changed_ranges_wasm"];
      Module["_ts_tree_cursor_new_wasm"] = _ts_tree_cursor_new_wasm = wasmExports2["ts_tree_cursor_new_wasm"];
      Module["_ts_tree_cursor_copy_wasm"] = _ts_tree_cursor_copy_wasm = wasmExports2["ts_tree_cursor_copy_wasm"];
      Module["_ts_tree_cursor_delete_wasm"] = _ts_tree_cursor_delete_wasm = wasmExports2["ts_tree_cursor_delete_wasm"];
      Module["_ts_tree_cursor_reset_wasm"] = _ts_tree_cursor_reset_wasm = wasmExports2["ts_tree_cursor_reset_wasm"];
      Module["_ts_tree_cursor_reset_to_wasm"] = _ts_tree_cursor_reset_to_wasm = wasmExports2["ts_tree_cursor_reset_to_wasm"];
      Module["_ts_tree_cursor_goto_first_child_wasm"] = _ts_tree_cursor_goto_first_child_wasm = wasmExports2["ts_tree_cursor_goto_first_child_wasm"];
      Module["_ts_tree_cursor_goto_last_child_wasm"] = _ts_tree_cursor_goto_last_child_wasm = wasmExports2["ts_tree_cursor_goto_last_child_wasm"];
      Module["_ts_tree_cursor_goto_first_child_for_index_wasm"] = _ts_tree_cursor_goto_first_child_for_index_wasm = wasmExports2["ts_tree_cursor_goto_first_child_for_index_wasm"];
      Module["_ts_tree_cursor_goto_first_child_for_position_wasm"] = _ts_tree_cursor_goto_first_child_for_position_wasm = wasmExports2["ts_tree_cursor_goto_first_child_for_position_wasm"];
      Module["_ts_tree_cursor_goto_next_sibling_wasm"] = _ts_tree_cursor_goto_next_sibling_wasm = wasmExports2["ts_tree_cursor_goto_next_sibling_wasm"];
      Module["_ts_tree_cursor_goto_previous_sibling_wasm"] = _ts_tree_cursor_goto_previous_sibling_wasm = wasmExports2["ts_tree_cursor_goto_previous_sibling_wasm"];
      Module["_ts_tree_cursor_goto_descendant_wasm"] = _ts_tree_cursor_goto_descendant_wasm = wasmExports2["ts_tree_cursor_goto_descendant_wasm"];
      Module["_ts_tree_cursor_goto_parent_wasm"] = _ts_tree_cursor_goto_parent_wasm = wasmExports2["ts_tree_cursor_goto_parent_wasm"];
      Module["_ts_tree_cursor_current_node_type_id_wasm"] = _ts_tree_cursor_current_node_type_id_wasm = wasmExports2["ts_tree_cursor_current_node_type_id_wasm"];
      Module["_ts_tree_cursor_current_node_state_id_wasm"] = _ts_tree_cursor_current_node_state_id_wasm = wasmExports2["ts_tree_cursor_current_node_state_id_wasm"];
      Module["_ts_tree_cursor_current_node_is_named_wasm"] = _ts_tree_cursor_current_node_is_named_wasm = wasmExports2["ts_tree_cursor_current_node_is_named_wasm"];
      Module["_ts_tree_cursor_current_node_is_missing_wasm"] = _ts_tree_cursor_current_node_is_missing_wasm = wasmExports2["ts_tree_cursor_current_node_is_missing_wasm"];
      Module["_ts_tree_cursor_current_node_id_wasm"] = _ts_tree_cursor_current_node_id_wasm = wasmExports2["ts_tree_cursor_current_node_id_wasm"];
      Module["_ts_tree_cursor_start_position_wasm"] = _ts_tree_cursor_start_position_wasm = wasmExports2["ts_tree_cursor_start_position_wasm"];
      Module["_ts_tree_cursor_end_position_wasm"] = _ts_tree_cursor_end_position_wasm = wasmExports2["ts_tree_cursor_end_position_wasm"];
      Module["_ts_tree_cursor_start_index_wasm"] = _ts_tree_cursor_start_index_wasm = wasmExports2["ts_tree_cursor_start_index_wasm"];
      Module["_ts_tree_cursor_end_index_wasm"] = _ts_tree_cursor_end_index_wasm = wasmExports2["ts_tree_cursor_end_index_wasm"];
      Module["_ts_tree_cursor_current_field_id_wasm"] = _ts_tree_cursor_current_field_id_wasm = wasmExports2["ts_tree_cursor_current_field_id_wasm"];
      Module["_ts_tree_cursor_current_depth_wasm"] = _ts_tree_cursor_current_depth_wasm = wasmExports2["ts_tree_cursor_current_depth_wasm"];
      Module["_ts_tree_cursor_current_descendant_index_wasm"] = _ts_tree_cursor_current_descendant_index_wasm = wasmExports2["ts_tree_cursor_current_descendant_index_wasm"];
      Module["_ts_tree_cursor_current_node_wasm"] = _ts_tree_cursor_current_node_wasm = wasmExports2["ts_tree_cursor_current_node_wasm"];
      Module["_ts_node_symbol_wasm"] = _ts_node_symbol_wasm = wasmExports2["ts_node_symbol_wasm"];
      Module["_ts_node_field_name_for_child_wasm"] = _ts_node_field_name_for_child_wasm = wasmExports2["ts_node_field_name_for_child_wasm"];
      Module["_ts_node_field_name_for_named_child_wasm"] = _ts_node_field_name_for_named_child_wasm = wasmExports2["ts_node_field_name_for_named_child_wasm"];
      Module["_ts_node_children_by_field_id_wasm"] = _ts_node_children_by_field_id_wasm = wasmExports2["ts_node_children_by_field_id_wasm"];
      Module["_ts_node_first_child_for_byte_wasm"] = _ts_node_first_child_for_byte_wasm = wasmExports2["ts_node_first_child_for_byte_wasm"];
      Module["_ts_node_first_named_child_for_byte_wasm"] = _ts_node_first_named_child_for_byte_wasm = wasmExports2["ts_node_first_named_child_for_byte_wasm"];
      Module["_ts_node_grammar_symbol_wasm"] = _ts_node_grammar_symbol_wasm = wasmExports2["ts_node_grammar_symbol_wasm"];
      Module["_ts_node_child_count_wasm"] = _ts_node_child_count_wasm = wasmExports2["ts_node_child_count_wasm"];
      Module["_ts_node_named_child_count_wasm"] = _ts_node_named_child_count_wasm = wasmExports2["ts_node_named_child_count_wasm"];
      Module["_ts_node_child_wasm"] = _ts_node_child_wasm = wasmExports2["ts_node_child_wasm"];
      Module["_ts_node_named_child_wasm"] = _ts_node_named_child_wasm = wasmExports2["ts_node_named_child_wasm"];
      Module["_ts_node_child_by_field_id_wasm"] = _ts_node_child_by_field_id_wasm = wasmExports2["ts_node_child_by_field_id_wasm"];
      Module["_ts_node_next_sibling_wasm"] = _ts_node_next_sibling_wasm = wasmExports2["ts_node_next_sibling_wasm"];
      Module["_ts_node_prev_sibling_wasm"] = _ts_node_prev_sibling_wasm = wasmExports2["ts_node_prev_sibling_wasm"];
      Module["_ts_node_next_named_sibling_wasm"] = _ts_node_next_named_sibling_wasm = wasmExports2["ts_node_next_named_sibling_wasm"];
      Module["_ts_node_prev_named_sibling_wasm"] = _ts_node_prev_named_sibling_wasm = wasmExports2["ts_node_prev_named_sibling_wasm"];
      Module["_ts_node_descendant_count_wasm"] = _ts_node_descendant_count_wasm = wasmExports2["ts_node_descendant_count_wasm"];
      Module["_ts_node_parent_wasm"] = _ts_node_parent_wasm = wasmExports2["ts_node_parent_wasm"];
      Module["_ts_node_child_with_descendant_wasm"] = _ts_node_child_with_descendant_wasm = wasmExports2["ts_node_child_with_descendant_wasm"];
      Module["_ts_node_descendant_for_index_wasm"] = _ts_node_descendant_for_index_wasm = wasmExports2["ts_node_descendant_for_index_wasm"];
      Module["_ts_node_named_descendant_for_index_wasm"] = _ts_node_named_descendant_for_index_wasm = wasmExports2["ts_node_named_descendant_for_index_wasm"];
      Module["_ts_node_descendant_for_position_wasm"] = _ts_node_descendant_for_position_wasm = wasmExports2["ts_node_descendant_for_position_wasm"];
      Module["_ts_node_named_descendant_for_position_wasm"] = _ts_node_named_descendant_for_position_wasm = wasmExports2["ts_node_named_descendant_for_position_wasm"];
      Module["_ts_node_start_point_wasm"] = _ts_node_start_point_wasm = wasmExports2["ts_node_start_point_wasm"];
      Module["_ts_node_end_point_wasm"] = _ts_node_end_point_wasm = wasmExports2["ts_node_end_point_wasm"];
      Module["_ts_node_start_index_wasm"] = _ts_node_start_index_wasm = wasmExports2["ts_node_start_index_wasm"];
      Module["_ts_node_end_index_wasm"] = _ts_node_end_index_wasm = wasmExports2["ts_node_end_index_wasm"];
      Module["_ts_node_to_string_wasm"] = _ts_node_to_string_wasm = wasmExports2["ts_node_to_string_wasm"];
      Module["_ts_node_children_wasm"] = _ts_node_children_wasm = wasmExports2["ts_node_children_wasm"];
      Module["_ts_node_named_children_wasm"] = _ts_node_named_children_wasm = wasmExports2["ts_node_named_children_wasm"];
      Module["_ts_node_descendants_of_type_wasm"] = _ts_node_descendants_of_type_wasm = wasmExports2["ts_node_descendants_of_type_wasm"];
      Module["_ts_node_is_named_wasm"] = _ts_node_is_named_wasm = wasmExports2["ts_node_is_named_wasm"];
      Module["_ts_node_has_changes_wasm"] = _ts_node_has_changes_wasm = wasmExports2["ts_node_has_changes_wasm"];
      Module["_ts_node_has_error_wasm"] = _ts_node_has_error_wasm = wasmExports2["ts_node_has_error_wasm"];
      Module["_ts_node_is_error_wasm"] = _ts_node_is_error_wasm = wasmExports2["ts_node_is_error_wasm"];
      Module["_ts_node_is_missing_wasm"] = _ts_node_is_missing_wasm = wasmExports2["ts_node_is_missing_wasm"];
      Module["_ts_node_is_extra_wasm"] = _ts_node_is_extra_wasm = wasmExports2["ts_node_is_extra_wasm"];
      Module["_ts_node_parse_state_wasm"] = _ts_node_parse_state_wasm = wasmExports2["ts_node_parse_state_wasm"];
      Module["_ts_node_next_parse_state_wasm"] = _ts_node_next_parse_state_wasm = wasmExports2["ts_node_next_parse_state_wasm"];
      Module["_ts_query_matches_wasm"] = _ts_query_matches_wasm = wasmExports2["ts_query_matches_wasm"];
      Module["_ts_query_captures_wasm"] = _ts_query_captures_wasm = wasmExports2["ts_query_captures_wasm"];
      Module["_memset"] = _memset = wasmExports2["memset"];
      Module["_memcpy"] = _memcpy = wasmExports2["memcpy"];
      Module["_memmove"] = _memmove = wasmExports2["memmove"];
      Module["_iswalpha"] = _iswalpha = wasmExports2["iswalpha"];
      Module["_iswblank"] = _iswblank = wasmExports2["iswblank"];
      Module["_iswdigit"] = _iswdigit = wasmExports2["iswdigit"];
      Module["_iswlower"] = _iswlower = wasmExports2["iswlower"];
      Module["_iswpunct"] = _iswpunct = wasmExports2["iswpunct"];
      Module["_iswupper"] = _iswupper = wasmExports2["iswupper"];
      Module["_iswxdigit"] = _iswxdigit = wasmExports2["iswxdigit"];
      Module["_memchr"] = _memchr = wasmExports2["memchr"];
      Module["_strlen"] = _strlen = wasmExports2["strlen"];
      Module["_strcmp"] = _strcmp = wasmExports2["strcmp"];
      Module["_strncat"] = _strncat = wasmExports2["strncat"];
      Module["_strncpy"] = _strncpy = wasmExports2["strncpy"];
      Module["_towlower"] = _towlower = wasmExports2["towlower"];
      Module["_towupper"] = _towupper = wasmExports2["towupper"];
      _setThrew = wasmExports2["setThrew"];
      __emscripten_stack_restore = wasmExports2["_emscripten_stack_restore"];
      __emscripten_stack_alloc = wasmExports2["_emscripten_stack_alloc"];
      _emscripten_stack_get_current = wasmExports2["emscripten_stack_get_current"];
      ___wasm_apply_data_relocs = wasmExports2["__wasm_apply_data_relocs"];
    }
    __name(assignWasmExports, "assignWasmExports");
    var wasmImports = {
      /** @export */
      __heap_base: ___heap_base,
      /** @export */
      __indirect_function_table: wasmTable,
      /** @export */
      __memory_base: ___memory_base,
      /** @export */
      __stack_high: ___stack_high,
      /** @export */
      __stack_low: ___stack_low,
      /** @export */
      __stack_pointer: ___stack_pointer,
      /** @export */
      __table_base: ___table_base,
      /** @export */
      _abort_js: __abort_js,
      /** @export */
      emscripten_resize_heap: _emscripten_resize_heap,
      /** @export */
      fd_close: _fd_close,
      /** @export */
      fd_seek: _fd_seek,
      /** @export */
      fd_write: _fd_write,
      /** @export */
      memory: wasmMemory,
      /** @export */
      tree_sitter_log_callback: _tree_sitter_log_callback,
      /** @export */
      tree_sitter_parse_callback: _tree_sitter_parse_callback,
      /** @export */
      tree_sitter_progress_callback: _tree_sitter_progress_callback,
      /** @export */
      tree_sitter_query_progress_callback: _tree_sitter_query_progress_callback
    };
    function callMain(args2 = []) {
      var entryFunction = resolveGlobalSymbol("main").sym;
      if (!entryFunction) return;
      args2.unshift(thisProgram);
      var argc = args2.length;
      var argv = stackAlloc((argc + 1) * 4);
      var argv_ptr = argv;
      args2.forEach((arg) => {
        LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, stringToUTF8OnStack(arg));
        argv_ptr += 4;
      });
      LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, 0);
      try {
        var ret = entryFunction(argc, argv);
        exitJS(
          ret,
          /* implicit = */
          true
        );
        return ret;
      } catch (e) {
        return handleException(e);
      }
    }
    __name(callMain, "callMain");
    function run(args2 = arguments_) {
      if (runDependencies > 0) {
        dependenciesFulfilled = run;
        return;
      }
      preRun();
      if (runDependencies > 0) {
        dependenciesFulfilled = run;
        return;
      }
      function doRun() {
        Module["calledRun"] = true;
        if (ABORT) return;
        initRuntime();
        preMain();
        readyPromiseResolve?.(Module);
        Module["onRuntimeInitialized"]?.();
        var noInitialRun = Module["noInitialRun"] || false;
        if (!noInitialRun) callMain(args2);
        postRun();
      }
      __name(doRun, "doRun");
      if (Module["setStatus"]) {
        Module["setStatus"]("Running...");
        setTimeout(() => {
          setTimeout(() => Module["setStatus"](""), 1);
          doRun();
        }, 1);
      } else {
        doRun();
      }
    }
    __name(run, "run");
    var wasmExports;
    wasmExports = await createWasm();
    run();
    if (runtimeInitialized) {
      moduleRtn = Module;
    } else {
      moduleRtn = new Promise((resolve, reject) => {
        readyPromiseResolve = resolve;
        readyPromiseReject = reject;
      });
    }
    return moduleRtn;
  }
  __name(Module2, "Module");
  var web_tree_sitter_default = Module2;
  var Module3 = null;
  async function initializeBinding(moduleOptions) {
    return Module3 ?? (Module3 = await web_tree_sitter_default(moduleOptions));
  }
  __name(initializeBinding, "initializeBinding");
  function checkModule() {
    return !!Module3;
  }
  __name(checkModule, "checkModule");
  var TRANSFER_BUFFER;
  var LANGUAGE_VERSION;
  var MIN_COMPATIBLE_VERSION;
  var finalizer4 = newFinalizer((addresses) => {
    C._ts_parser_delete(addresses[0]);
    C._free(addresses[1]);
  });
  var _a7;
  var Parser = (_a7 = class {
    /**
     * Create a new parser.
     */
    constructor() {
      /** @internal */
      __publicField(this, 0, 0);
      // Internal handle for Wasm
      /** @internal */
      __publicField(this, 1, 0);
      // Internal handle for Wasm
      /** @internal */
      __publicField(this, "logCallback", null);
      /** The parser's current language. */
      __publicField(this, "language", null);
      this.initialize();
      finalizer4?.register(this, [this[0], this[1]], this);
    }
    /**
     * This must always be called before creating a Parser.
     *
     * You can optionally pass in options to configure the Wasm module, the most common
     * one being \`locateFile\` to help the module find the \`.wasm\` file.
     */
    static async init(moduleOptions) {
      setModule(await initializeBinding(moduleOptions));
      TRANSFER_BUFFER = C._ts_init();
      LANGUAGE_VERSION = C.getValue(TRANSFER_BUFFER, "i32");
      MIN_COMPATIBLE_VERSION = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    }
    /** @internal */
    initialize() {
      if (!checkModule()) {
        throw new Error("cannot construct a Parser before calling \`init()\`");
      }
      C._ts_parser_new_wasm();
      this[0] = C.getValue(TRANSFER_BUFFER, "i32");
      this[1] = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    }
    /** Delete the parser, freeing its resources. */
    delete() {
      finalizer4?.unregister(this);
      C._ts_parser_delete(this[0]);
      C._free(this[1]);
      this[0] = 0;
      this[1] = 0;
    }
    /**
     * Set the language that the parser should use for parsing.
     *
     * If the language was not successfully assigned, an error will be thrown.
     * This happens if the language was generated with an incompatible
     * version of the Tree-sitter CLI. Check the language's version using
     * {@link Language#version} and compare it to this library's
     * {@link LANGUAGE_VERSION} and {@link MIN_COMPATIBLE_VERSION} constants.
     */
    setLanguage(language) {
      let address;
      if (!language) {
        address = 0;
        this.language = null;
      } else if (language.constructor === Language) {
        address = language[0];
        const version = C._ts_language_abi_version(address);
        if (version < MIN_COMPATIBLE_VERSION || LANGUAGE_VERSION < version) {
          throw new Error(
            \`Incompatible language version \${version}. Compatibility range \${MIN_COMPATIBLE_VERSION} through \${LANGUAGE_VERSION}.\`
          );
        }
        this.language = language;
      } else {
        throw new Error("Argument must be a Language");
      }
      C._ts_parser_set_language(this[0], address);
      return this;
    }
    /**
     * Parse a slice of UTF8 text.
     *
     * @param {string | ParseCallback} callback - The UTF8-encoded text to parse or a callback function.
     *
     * @param {Tree | null} [oldTree] - A previous syntax tree parsed from the same document. If the text of the
     *   document has changed since \`oldTree\` was created, then you must edit \`oldTree\` to match
     *   the new text using {@link Tree#edit}.
     *
     * @param {ParseOptions} [options] - Options for parsing the text.
     *  This can be used to set the included ranges, or a progress callback.
     *
     * @returns {Tree | null} A {@link Tree} if parsing succeeded, or \`null\` if:
     *  - The parser has not yet had a language assigned with {@link Parser#setLanguage}.
     *  - The progress callback returned true.
     */
    parse(callback, oldTree, options) {
      if (typeof callback === "string") {
        C.currentParseCallback = (index) => callback.slice(index);
      } else if (typeof callback === "function") {
        C.currentParseCallback = callback;
      } else {
        throw new Error("Argument must be a string or a function");
      }
      if (options?.progressCallback) {
        C.currentProgressCallback = options.progressCallback;
      } else {
        C.currentProgressCallback = null;
      }
      if (this.logCallback) {
        C.currentLogCallback = this.logCallback;
        C._ts_parser_enable_logger_wasm(this[0], 1);
      } else {
        C.currentLogCallback = null;
        C._ts_parser_enable_logger_wasm(this[0], 0);
      }
      let rangeCount = 0;
      let rangeAddress = 0;
      if (options?.includedRanges) {
        rangeCount = options.includedRanges.length;
        rangeAddress = C._calloc(rangeCount, SIZE_OF_RANGE);
        let address = rangeAddress;
        for (let i2 = 0; i2 < rangeCount; i2++) {
          marshalRange(address, options.includedRanges[i2]);
          address += SIZE_OF_RANGE;
        }
      }
      const treeAddress = C._ts_parser_parse_wasm(
        this[0],
        this[1],
        oldTree ? oldTree[0] : 0,
        rangeAddress,
        rangeCount
      );
      if (!treeAddress) {
        C.currentParseCallback = null;
        C.currentLogCallback = null;
        C.currentProgressCallback = null;
        return null;
      }
      if (!this.language) {
        throw new Error("Parser must have a language to parse");
      }
      const result = new Tree(INTERNAL, treeAddress, this.language, C.currentParseCallback);
      C.currentParseCallback = null;
      C.currentLogCallback = null;
      C.currentProgressCallback = null;
      return result;
    }
    /**
     * Instruct the parser to start the next parse from the beginning.
     *
     * If the parser previously failed because of a callback, 
     * then by default, it will resume where it left off on the
     * next call to {@link Parser#parse} or other parsing functions.
     * If you don't want to resume, and instead intend to use this parser to
     * parse some other document, you must call \`reset\` first.
     */
    reset() {
      C._ts_parser_reset(this[0]);
    }
    /** Get the ranges of text that the parser will include when parsing. */
    getIncludedRanges() {
      C._ts_parser_included_ranges_wasm(this[0]);
      const count2 = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const result = new Array(count2);
      if (count2 > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count2; i2++) {
          result[i2] = unmarshalRange(address);
          address += SIZE_OF_RANGE;
        }
        C._free(buffer);
      }
      return result;
    }
    /** Set the logging callback that a parser should use during parsing. */
    setLogger(callback) {
      if (!callback) {
        this.logCallback = null;
      } else if (typeof callback !== "function") {
        throw new Error("Logger callback must be a function");
      } else {
        this.logCallback = callback;
      }
      return this;
    }
    /** Get the parser's current logger. */
    getLogger() {
      return this.logCallback;
    }
  }, __name(_a7, "Parser"), _a7);
  var PREDICATE_STEP_TYPE_CAPTURE = 1;
  var PREDICATE_STEP_TYPE_STRING = 2;
  var QUERY_WORD_REGEX = /[\\w-]+/g;
  var CaptureQuantifier = {
    Zero: 0,
    ZeroOrOne: 1,
    ZeroOrMore: 2,
    One: 3,
    OneOrMore: 4
  };
  var isCaptureStep = /* @__PURE__ */ __name((step) => step.type === "capture", "isCaptureStep");
  var isStringStep = /* @__PURE__ */ __name((step) => step.type === "string", "isStringStep");
  var QueryErrorKind = {
    Syntax: 1,
    NodeName: 2,
    FieldName: 3,
    CaptureName: 4,
    PatternStructure: 5
  };
  var _a8;
  var QueryError = (_a8 = class extends Error {
    constructor(kind, info2, index, length) {
      super(_a8.formatMessage(kind, info2));
      __publicField(this, "kind");
      __publicField(this, "info");
      __publicField(this, "index");
      __publicField(this, "length");
      this.kind = kind;
      this.info = info2;
      this.index = index;
      this.length = length;
      this.name = "QueryError";
    }
    /** Formats an error message based on the error kind and info */
    static formatMessage(kind, info2) {
      switch (kind) {
        case QueryErrorKind.NodeName:
          return \`Bad node name '\${info2.word}'\`;
        case QueryErrorKind.FieldName:
          return \`Bad field name '\${info2.word}'\`;
        case QueryErrorKind.CaptureName:
          return \`Bad capture name @\${info2.word}\`;
        case QueryErrorKind.PatternStructure:
          return \`Bad pattern structure at offset \${info2.suffix}\`;
        case QueryErrorKind.Syntax:
          return \`Bad syntax at offset \${info2.suffix}\`;
      }
    }
  }, __name(_a8, "QueryError"), _a8);
  function parseAnyPredicate(steps, index, operator, textPredicates) {
    if (steps.length !== 3) {
      throw new Error(
        \`Wrong number of arguments to \\\`#\${operator}\\\` predicate. Expected 2, got \${steps.length - 1}\`
      );
    }
    if (!isCaptureStep(steps[1])) {
      throw new Error(
        \`First argument of \\\`#\${operator}\\\` predicate must be a capture. Got "\${steps[1].value}"\`
      );
    }
    const isPositive = operator === "eq?" || operator === "any-eq?";
    const matchAll = !operator.startsWith("any-");
    if (isCaptureStep(steps[2])) {
      const captureName1 = steps[1].name;
      const captureName2 = steps[2].name;
      textPredicates[index].push((captures) => {
        const nodes1 = [];
        const nodes2 = [];
        for (const c of captures) {
          if (c.name === captureName1) nodes1.push(c.node);
          if (c.name === captureName2) nodes2.push(c.node);
        }
        const compare = /* @__PURE__ */ __name((n1, n2, positive) => {
          return positive ? n1.text === n2.text : n1.text !== n2.text;
        }, "compare");
        return matchAll ? nodes1.every((n1) => nodes2.some((n2) => compare(n1, n2, isPositive))) : nodes1.some((n1) => nodes2.some((n2) => compare(n1, n2, isPositive)));
      });
    } else {
      const captureName = steps[1].name;
      const stringValue2 = steps[2].value;
      const matches = /* @__PURE__ */ __name((n) => n.text === stringValue2, "matches");
      const doesNotMatch = /* @__PURE__ */ __name((n) => n.text !== stringValue2, "doesNotMatch");
      textPredicates[index].push((captures) => {
        const nodes = [];
        for (const c of captures) {
          if (c.name === captureName) nodes.push(c.node);
        }
        const test = isPositive ? matches : doesNotMatch;
        return matchAll ? nodes.every(test) : nodes.some(test);
      });
    }
  }
  __name(parseAnyPredicate, "parseAnyPredicate");
  function parseMatchPredicate(steps, index, operator, textPredicates) {
    if (steps.length !== 3) {
      throw new Error(
        \`Wrong number of arguments to \\\`#\${operator}\\\` predicate. Expected 2, got \${steps.length - 1}.\`
      );
    }
    if (steps[1].type !== "capture") {
      throw new Error(
        \`First argument of \\\`#\${operator}\\\` predicate must be a capture. Got "\${steps[1].value}".\`
      );
    }
    if (steps[2].type !== "string") {
      throw new Error(
        \`Second argument of \\\`#\${operator}\\\` predicate must be a string. Got @\${steps[2].name}.\`
      );
    }
    const isPositive = operator === "match?" || operator === "any-match?";
    const matchAll = !operator.startsWith("any-");
    const captureName = steps[1].name;
    const regex = new RegExp(steps[2].value);
    textPredicates[index].push((captures) => {
      const nodes = [];
      for (const c of captures) {
        if (c.name === captureName) nodes.push(c.node.text);
      }
      const test = /* @__PURE__ */ __name((text, positive) => {
        return positive ? regex.test(text) : !regex.test(text);
      }, "test");
      if (nodes.length === 0) return !isPositive;
      return matchAll ? nodes.every((text) => test(text, isPositive)) : nodes.some((text) => test(text, isPositive));
    });
  }
  __name(parseMatchPredicate, "parseMatchPredicate");
  function parseAnyOfPredicate(steps, index, operator, textPredicates) {
    if (steps.length < 2) {
      throw new Error(
        \`Wrong number of arguments to \\\`#\${operator}\\\` predicate. Expected at least 1. Got \${steps.length - 1}.\`
      );
    }
    if (steps[1].type !== "capture") {
      throw new Error(
        \`First argument of \\\`#\${operator}\\\` predicate must be a capture. Got "\${steps[1].value}".\`
      );
    }
    const isPositive = operator === "any-of?";
    const captureName = steps[1].name;
    const stringSteps = steps.slice(2);
    if (!stringSteps.every(isStringStep)) {
      throw new Error(
        \`Arguments to \\\`#\${operator}\\\` predicate must be strings.".\`
      );
    }
    const values = stringSteps.map((s) => s.value);
    textPredicates[index].push((captures) => {
      const nodes = [];
      for (const c of captures) {
        if (c.name === captureName) nodes.push(c.node.text);
      }
      if (nodes.length === 0) return !isPositive;
      return nodes.every((text) => values.includes(text)) === isPositive;
    });
  }
  __name(parseAnyOfPredicate, "parseAnyOfPredicate");
  function parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties) {
    if (steps.length < 2 || steps.length > 3) {
      throw new Error(
        \`Wrong number of arguments to \\\`#\${operator}\\\` predicate. Expected 1 or 2. Got \${steps.length - 1}.\`
      );
    }
    if (!steps.every(isStringStep)) {
      throw new Error(
        \`Arguments to \\\`#\${operator}\\\` predicate must be strings.".\`
      );
    }
    const properties = operator === "is?" ? assertedProperties : refutedProperties;
    if (!properties[index]) properties[index] = {};
    properties[index][steps[1].value] = steps[2]?.value ?? null;
  }
  __name(parseIsPredicate, "parseIsPredicate");
  function parseSetDirective(steps, index, setProperties) {
    if (steps.length < 2 || steps.length > 3) {
      throw new Error(\`Wrong number of arguments to \\\`#set!\\\` predicate. Expected 1 or 2. Got \${steps.length - 1}.\`);
    }
    if (!steps.every(isStringStep)) {
      throw new Error(\`Arguments to \\\`#set!\\\` predicate must be strings.".\`);
    }
    if (!setProperties[index]) setProperties[index] = {};
    setProperties[index][steps[1].value] = steps[2]?.value ?? null;
  }
  __name(parseSetDirective, "parseSetDirective");
  function parsePattern(index, stepType, stepValueId, captureNames, stringValues, steps, textPredicates, predicates, setProperties, assertedProperties, refutedProperties) {
    if (stepType === PREDICATE_STEP_TYPE_CAPTURE) {
      const name2 = captureNames[stepValueId];
      steps.push({ type: "capture", name: name2 });
    } else if (stepType === PREDICATE_STEP_TYPE_STRING) {
      steps.push({ type: "string", value: stringValues[stepValueId] });
    } else if (steps.length > 0) {
      if (steps[0].type !== "string") {
        throw new Error("Predicates must begin with a literal value");
      }
      const operator = steps[0].value;
      switch (operator) {
        case "any-not-eq?":
        case "not-eq?":
        case "any-eq?":
        case "eq?":
          parseAnyPredicate(steps, index, operator, textPredicates);
          break;
        case "any-not-match?":
        case "not-match?":
        case "any-match?":
        case "match?":
          parseMatchPredicate(steps, index, operator, textPredicates);
          break;
        case "not-any-of?":
        case "any-of?":
          parseAnyOfPredicate(steps, index, operator, textPredicates);
          break;
        case "is?":
        case "is-not?":
          parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties);
          break;
        case "set!":
          parseSetDirective(steps, index, setProperties);
          break;
        default:
          predicates[index].push({ operator, operands: steps.slice(1) });
      }
      steps.length = 0;
    }
  }
  __name(parsePattern, "parsePattern");
  var finalizer5 = newFinalizer((address) => {
    C._ts_query_delete(address);
  });
  var _a9;
  var Query = (_a9 = class {
    /**
     * Create a new query from a string containing one or more S-expression
     * patterns.
     *
     * The query is associated with a particular language, and can only be run
     * on syntax nodes parsed with that language. References to Queries can be
     * shared between multiple threads.
     *
     * @link {@see https://tree-sitter.github.io/tree-sitter/using-parsers/queries}
     */
    constructor(language, source) {
      /** @internal */
      __publicField(this, 0, 0);
      // Internal handle for Wasm
      /** @internal */
      __publicField(this, "exceededMatchLimit");
      /** @internal */
      __publicField(this, "textPredicates");
      /** The names of the captures used in the query. */
      __publicField(this, "captureNames");
      /** The quantifiers of the captures used in the query. */
      __publicField(this, "captureQuantifiers");
      /**
       * The other user-defined predicates associated with the given index.
       *
       * This includes predicates with operators other than:
       * - \`match?\`
       * - \`eq?\` and \`not-eq?\`
       * - \`any-of?\` and \`not-any-of?\`
       * - \`is?\` and \`is-not?\`
       * - \`set!\`
       */
      __publicField(this, "predicates");
      /** The properties for predicates with the operator \`set!\`. */
      __publicField(this, "setProperties");
      /** The properties for predicates with the operator \`is?\`. */
      __publicField(this, "assertedProperties");
      /** The properties for predicates with the operator \`is-not?\`. */
      __publicField(this, "refutedProperties");
      /** The maximum number of in-progress matches for this cursor. */
      __publicField(this, "matchLimit");
      const sourceLength = C.lengthBytesUTF8(source);
      const sourceAddress = C._malloc(sourceLength + 1);
      C.stringToUTF8(source, sourceAddress, sourceLength + 1);
      const address = C._ts_query_new(
        language[0],
        sourceAddress,
        sourceLength,
        TRANSFER_BUFFER,
        TRANSFER_BUFFER + SIZE_OF_INT
      );
      if (!address) {
        const errorId = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const errorByte = C.getValue(TRANSFER_BUFFER, "i32");
        const errorIndex = C.UTF8ToString(sourceAddress, errorByte).length;
        const suffix = source.slice(errorIndex, errorIndex + 100).split("\\n")[0];
        const word = suffix.match(QUERY_WORD_REGEX)?.[0] ?? "";
        C._free(sourceAddress);
        switch (errorId) {
          case QueryErrorKind.Syntax:
            throw new QueryError(QueryErrorKind.Syntax, { suffix: \`\${errorIndex}: '\${suffix}'...\` }, errorIndex, 0);
          case QueryErrorKind.NodeName:
            throw new QueryError(errorId, { word }, errorIndex, word.length);
          case QueryErrorKind.FieldName:
            throw new QueryError(errorId, { word }, errorIndex, word.length);
          case QueryErrorKind.CaptureName:
            throw new QueryError(errorId, { word }, errorIndex, word.length);
          case QueryErrorKind.PatternStructure:
            throw new QueryError(errorId, { suffix: \`\${errorIndex}: '\${suffix}'...\` }, errorIndex, 0);
        }
      }
      const stringCount = C._ts_query_string_count(address);
      const captureCount = C._ts_query_capture_count(address);
      const patternCount = C._ts_query_pattern_count(address);
      const captureNames = new Array(captureCount);
      const captureQuantifiers = new Array(patternCount);
      const stringValues = new Array(stringCount);
      for (let i2 = 0; i2 < captureCount; i2++) {
        const nameAddress = C._ts_query_capture_name_for_id(
          address,
          i2,
          TRANSFER_BUFFER
        );
        const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
        captureNames[i2] = C.UTF8ToString(nameAddress, nameLength);
      }
      for (let i2 = 0; i2 < patternCount; i2++) {
        const captureQuantifiersArray = new Array(captureCount);
        for (let j2 = 0; j2 < captureCount; j2++) {
          const quantifier = C._ts_query_capture_quantifier_for_id(address, i2, j2);
          captureQuantifiersArray[j2] = quantifier;
        }
        captureQuantifiers[i2] = captureQuantifiersArray;
      }
      for (let i2 = 0; i2 < stringCount; i2++) {
        const valueAddress = C._ts_query_string_value_for_id(
          address,
          i2,
          TRANSFER_BUFFER
        );
        const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
        stringValues[i2] = C.UTF8ToString(valueAddress, nameLength);
      }
      const setProperties = new Array(patternCount);
      const assertedProperties = new Array(patternCount);
      const refutedProperties = new Array(patternCount);
      const predicates = new Array(patternCount);
      const textPredicates = new Array(patternCount);
      for (let i2 = 0; i2 < patternCount; i2++) {
        const predicatesAddress = C._ts_query_predicates_for_pattern(address, i2, TRANSFER_BUFFER);
        const stepCount = C.getValue(TRANSFER_BUFFER, "i32");
        predicates[i2] = [];
        textPredicates[i2] = [];
        const steps = new Array();
        let stepAddress = predicatesAddress;
        for (let j2 = 0; j2 < stepCount; j2++) {
          const stepType = C.getValue(stepAddress, "i32");
          stepAddress += SIZE_OF_INT;
          const stepValueId = C.getValue(stepAddress, "i32");
          stepAddress += SIZE_OF_INT;
          parsePattern(
            i2,
            stepType,
            stepValueId,
            captureNames,
            stringValues,
            steps,
            textPredicates,
            predicates,
            setProperties,
            assertedProperties,
            refutedProperties
          );
        }
        Object.freeze(textPredicates[i2]);
        Object.freeze(predicates[i2]);
        Object.freeze(setProperties[i2]);
        Object.freeze(assertedProperties[i2]);
        Object.freeze(refutedProperties[i2]);
      }
      C._free(sourceAddress);
      this[0] = address;
      this.captureNames = captureNames;
      this.captureQuantifiers = captureQuantifiers;
      this.textPredicates = textPredicates;
      this.predicates = predicates;
      this.setProperties = setProperties;
      this.assertedProperties = assertedProperties;
      this.refutedProperties = refutedProperties;
      this.exceededMatchLimit = false;
      finalizer5?.register(this, address, this);
    }
    /** Delete the query, freeing its resources. */
    delete() {
      finalizer5?.unregister(this);
      C._ts_query_delete(this[0]);
      this[0] = 0;
    }
    /**
     * Iterate over all of the matches in the order that they were found.
     *
     * Each match contains the index of the pattern that matched, and a list of
     * captures. Because multiple patterns can match the same set of nodes,
     * one match may contain captures that appear *before* some of the
     * captures from a previous match.
     *
     * @param {Node} node - The node to execute the query on.
     *
     * @param {QueryOptions} options - Options for query execution.
     */
    matches(node, options = {}) {
      const startPosition = options.startPosition ?? ZERO_POINT;
      const endPosition = options.endPosition ?? ZERO_POINT;
      const startIndex = options.startIndex ?? 0;
      const endIndex = options.endIndex ?? 0;
      const startContainingPosition = options.startContainingPosition ?? ZERO_POINT;
      const endContainingPosition = options.endContainingPosition ?? ZERO_POINT;
      const startContainingIndex = options.startContainingIndex ?? 0;
      const endContainingIndex = options.endContainingIndex ?? 0;
      const matchLimit = options.matchLimit ?? 4294967295;
      const maxStartDepth = options.maxStartDepth ?? 4294967295;
      const progressCallback = options.progressCallback;
      if (typeof matchLimit !== "number") {
        throw new Error("Arguments must be numbers");
      }
      this.matchLimit = matchLimit;
      if (endIndex !== 0 && startIndex > endIndex) {
        throw new Error("\`startIndex\` cannot be greater than \`endIndex\`");
      }
      if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
        throw new Error("\`startPosition\` cannot be greater than \`endPosition\`");
      }
      if (endContainingIndex !== 0 && startContainingIndex > endContainingIndex) {
        throw new Error("\`startContainingIndex\` cannot be greater than \`endContainingIndex\`");
      }
      if (endContainingPosition !== ZERO_POINT && (startContainingPosition.row > endContainingPosition.row || startContainingPosition.row === endContainingPosition.row && startContainingPosition.column > endContainingPosition.column)) {
        throw new Error("\`startContainingPosition\` cannot be greater than \`endContainingPosition\`");
      }
      if (progressCallback) {
        C.currentQueryProgressCallback = progressCallback;
      }
      marshalNode(node);
      C._ts_query_matches_wasm(
        this[0],
        node.tree[0],
        startPosition.row,
        startPosition.column,
        endPosition.row,
        endPosition.column,
        startIndex,
        endIndex,
        startContainingPosition.row,
        startContainingPosition.column,
        endContainingPosition.row,
        endContainingPosition.column,
        startContainingIndex,
        endContainingIndex,
        matchLimit,
        maxStartDepth
      );
      const rawCount = C.getValue(TRANSFER_BUFFER, "i32");
      const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
      const result = new Array(rawCount);
      this.exceededMatchLimit = Boolean(didExceedMatchLimit);
      let filteredCount = 0;
      let address = startAddress;
      for (let i2 = 0; i2 < rawCount; i2++) {
        const patternIndex = C.getValue(address, "i32");
        address += SIZE_OF_INT;
        const captureCount = C.getValue(address, "i32");
        address += SIZE_OF_INT;
        const captures = new Array(captureCount);
        address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
        if (this.textPredicates[patternIndex].every((p) => p(captures))) {
          result[filteredCount] = { patternIndex, captures };
          const setProperties = this.setProperties[patternIndex];
          result[filteredCount].setProperties = setProperties;
          const assertedProperties = this.assertedProperties[patternIndex];
          result[filteredCount].assertedProperties = assertedProperties;
          const refutedProperties = this.refutedProperties[patternIndex];
          result[filteredCount].refutedProperties = refutedProperties;
          filteredCount++;
        }
      }
      result.length = filteredCount;
      C._free(startAddress);
      C.currentQueryProgressCallback = null;
      return result;
    }
    /**
     * Iterate over all of the individual captures in the order that they
     * appear.
     *
     * This is useful if you don't care about which pattern matched, and just
     * want a single, ordered sequence of captures.
     *
     * @param {Node} node - The node to execute the query on.
     *
     * @param {QueryOptions} options - Options for query execution.
     */
    captures(node, options = {}) {
      const startPosition = options.startPosition ?? ZERO_POINT;
      const endPosition = options.endPosition ?? ZERO_POINT;
      const startIndex = options.startIndex ?? 0;
      const endIndex = options.endIndex ?? 0;
      const startContainingPosition = options.startContainingPosition ?? ZERO_POINT;
      const endContainingPosition = options.endContainingPosition ?? ZERO_POINT;
      const startContainingIndex = options.startContainingIndex ?? 0;
      const endContainingIndex = options.endContainingIndex ?? 0;
      const matchLimit = options.matchLimit ?? 4294967295;
      const maxStartDepth = options.maxStartDepth ?? 4294967295;
      const progressCallback = options.progressCallback;
      if (typeof matchLimit !== "number") {
        throw new Error("Arguments must be numbers");
      }
      this.matchLimit = matchLimit;
      if (endIndex !== 0 && startIndex > endIndex) {
        throw new Error("\`startIndex\` cannot be greater than \`endIndex\`");
      }
      if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
        throw new Error("\`startPosition\` cannot be greater than \`endPosition\`");
      }
      if (endContainingIndex !== 0 && startContainingIndex > endContainingIndex) {
        throw new Error("\`startContainingIndex\` cannot be greater than \`endContainingIndex\`");
      }
      if (endContainingPosition !== ZERO_POINT && (startContainingPosition.row > endContainingPosition.row || startContainingPosition.row === endContainingPosition.row && startContainingPosition.column > endContainingPosition.column)) {
        throw new Error("\`startContainingPosition\` cannot be greater than \`endContainingPosition\`");
      }
      if (progressCallback) {
        C.currentQueryProgressCallback = progressCallback;
      }
      marshalNode(node);
      C._ts_query_captures_wasm(
        this[0],
        node.tree[0],
        startPosition.row,
        startPosition.column,
        endPosition.row,
        endPosition.column,
        startIndex,
        endIndex,
        startContainingPosition.row,
        startContainingPosition.column,
        endContainingPosition.row,
        endContainingPosition.column,
        startContainingIndex,
        endContainingIndex,
        matchLimit,
        maxStartDepth
      );
      const count2 = C.getValue(TRANSFER_BUFFER, "i32");
      const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
      const result = new Array();
      this.exceededMatchLimit = Boolean(didExceedMatchLimit);
      const captures = new Array();
      let address = startAddress;
      for (let i2 = 0; i2 < count2; i2++) {
        const patternIndex = C.getValue(address, "i32");
        address += SIZE_OF_INT;
        const captureCount = C.getValue(address, "i32");
        address += SIZE_OF_INT;
        const captureIndex = C.getValue(address, "i32");
        address += SIZE_OF_INT;
        captures.length = captureCount;
        address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
        if (this.textPredicates[patternIndex].every((p) => p(captures))) {
          const capture = captures[captureIndex];
          const setProperties = this.setProperties[patternIndex];
          capture.setProperties = setProperties;
          const assertedProperties = this.assertedProperties[patternIndex];
          capture.assertedProperties = assertedProperties;
          const refutedProperties = this.refutedProperties[patternIndex];
          capture.refutedProperties = refutedProperties;
          result.push(capture);
        }
      }
      C._free(startAddress);
      C.currentQueryProgressCallback = null;
      return result;
    }
    /** Get the predicates for a given pattern. */
    predicatesForPattern(patternIndex) {
      return this.predicates[patternIndex];
    }
    /**
     * Disable a certain capture within a query.
     *
     * This prevents the capture from being returned in matches, and also
     * avoids any resource usage associated with recording the capture.
     */
    disableCapture(captureName) {
      const captureNameLength = C.lengthBytesUTF8(captureName);
      const captureNameAddress = C._malloc(captureNameLength + 1);
      C.stringToUTF8(captureName, captureNameAddress, captureNameLength + 1);
      C._ts_query_disable_capture(this[0], captureNameAddress, captureNameLength);
      C._free(captureNameAddress);
    }
    /**
     * Disable a certain pattern within a query.
     *
     * This prevents the pattern from matching, and also avoids any resource
     * usage associated with the pattern. This throws an error if the pattern
     * index is out of bounds.
     */
    disablePattern(patternIndex) {
      if (patternIndex >= this.predicates.length) {
        throw new Error(
          \`Pattern index is \${patternIndex} but the pattern count is \${this.predicates.length}\`
        );
      }
      C._ts_query_disable_pattern(this[0], patternIndex);
    }
    /**
     * Check if, on its last execution, this cursor exceeded its maximum number
     * of in-progress matches.
     */
    didExceedMatchLimit() {
      return this.exceededMatchLimit;
    }
    /** Get the byte offset where the given pattern starts in the query's source. */
    startIndexForPattern(patternIndex) {
      if (patternIndex >= this.predicates.length) {
        throw new Error(
          \`Pattern index is \${patternIndex} but the pattern count is \${this.predicates.length}\`
        );
      }
      return C._ts_query_start_byte_for_pattern(this[0], patternIndex);
    }
    /** Get the byte offset where the given pattern ends in the query's source. */
    endIndexForPattern(patternIndex) {
      if (patternIndex >= this.predicates.length) {
        throw new Error(
          \`Pattern index is \${patternIndex} but the pattern count is \${this.predicates.length}\`
        );
      }
      return C._ts_query_end_byte_for_pattern(this[0], patternIndex);
    }
    /** Get the number of patterns in the query. */
    patternCount() {
      return C._ts_query_pattern_count(this[0]);
    }
    /** Get the index for a given capture name. */
    captureIndexForName(captureName) {
      return this.captureNames.indexOf(captureName);
    }
    /** Check if a given pattern within a query has a single root node. */
    isPatternRooted(patternIndex) {
      return C._ts_query_is_pattern_rooted(this[0], patternIndex) === 1;
    }
    /** Check if a given pattern within a query has a single root node. */
    isPatternNonLocal(patternIndex) {
      return C._ts_query_is_pattern_non_local(this[0], patternIndex) === 1;
    }
    /**
     * Check if a given step in a query is 'definite'.
     *
     * A query step is 'definite' if its parent pattern will be guaranteed to
     * match successfully once it reaches the step.
     */
    isPatternGuaranteedAtStep(byteIndex) {
      return C._ts_query_is_pattern_guaranteed_at_step(this[0], byteIndex) === 1;
    }
  }, __name(_a9, "Query"), _a9);

  // src/lib/syntax.ts
  var grammarOf = (path) => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "tsx") return "tsx";
    if (ext === "ts" || ext === "mts" || ext === "cts") return "typescript";
    if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "javascript";
    return null;
  };
  var MAX_ERROR_SHARE = 0.02;
  var LEADING_COMMENTS = /^(?:\\s*(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/))*/;
  var readable = (t) => !/@flow\\b/.test(LEADING_COMMENTS.exec(t.text)[0]) && t.errors <= t.text.length * MAX_ERROR_SHARE;
  var runtime = null;
  var createSyntax = async (runtimeBytes) => {
    runtime ?? (runtime = Parser.init({ wasmBinary: runtimeBytes, locateFile: (name2) => name2 }).catch((err2) => {
      runtime = null;
      throw err2;
    }));
    await runtime;
    const languages = /* @__PURE__ */ new Map();
    const parser = new Parser();
    return {
      add: async (grammar, bytes) => {
        if (!languages.has(grammar)) languages.set(grammar, await Language.load(bytes));
      },
      parse: (path, text) => {
        const g = grammarOf(path);
        const lang = g ? languages.get(g) : void 0;
        if (!g || !lang) return null;
        parser.setLanguage(lang);
        const tree = parser.parse(g === "typescript" ? repairCallSignatures(text) : text, null, void 0);
        if (!tree) return null;
        try {
          const flat = flatten(tree, text, lang);
          return readable(flat) ? flat : null;
        } finally {
          tree.delete();
        }
      }
    };
  };
  var repairCallSignatures = (text) => {
    if (!/\\n[ \\t]+<([A-Za-z_$]|[ \\t]*\\r?\\n)/.test(text)) return text;
    const lines = text.split("\\n");
    let previous = "";
    for (let i2 = 0; i2 < lines.length; i2++) {
      const line = lines[i2];
      const m2 = /^([ \\t]*)[ \\t]<(\\s*$|[A-Za-z_$][\\w$]*\\s*(extends\\b|,|=|>))/.exec(line);
      if (m2 && previous && !/[;{(,[=|&:]\\s*$|=>\\s*$/.test(previous)) lines[i2] = \`\${m2[1]};\${line.slice(m2[1].length + 1)}\`;
      if (line.trim() !== "") previous = line;
    }
    return lines.join("\\n");
  };
  var flatten = (tree, text, lang) => {
    const fieldNames = lang.fields;
    const types = lang.types;
    let cap = 1024;
    const type = [];
    const field = [];
    let named = new Uint8Array(cap);
    let start2 = new Uint32Array(cap);
    let end = new Uint32Array(cap);
    let parent = new Int32Array(cap);
    let first = new Int32Array(cap);
    let next = new Int32Array(cap);
    let inError = new Uint8Array(cap);
    let errors = 0;
    const grow = () => {
      cap *= 2;
      const g8 = (a) => {
        const b2 = new Uint8Array(cap);
        b2.set(a);
        return b2;
      };
      const g32 = (a) => {
        const b2 = new Uint32Array(cap);
        b2.set(a);
        return b2;
      };
      const gi = (a) => {
        const b2 = new Int32Array(cap);
        b2.set(a);
        return b2;
      };
      named = g8(named);
      inError = g8(inError);
      start2 = g32(start2);
      end = g32(end);
      parent = gi(parent);
      first = gi(first);
      next = gi(next);
    };
    const c = tree.walk();
    let count2 = 0;
    const stack = [];
    const lastChild = [];
    const add = () => {
      if (count2 >= cap) grow();
      const id = count2++;
      type[id] = types[c.nodeTypeId] ?? c.nodeType;
      const f2 = c.currentFieldId;
      field[id] = f2 ? fieldNames[f2] ?? "" : "";
      named[id] = c.nodeIsNamed ? 1 : 0;
      start2[id] = c.startIndex;
      end[id] = c.endIndex;
      first[id] = -1;
      next[id] = -1;
      const p = stack.length > 0 ? stack[stack.length - 1] : -1;
      parent[id] = p;
      const outer = p >= 0 && inError[p] === 1;
      inError[id] = outer || type[id] === "ERROR" ? 1 : 0;
      if (!outer && type[id] === "ERROR") errors += c.endIndex - c.startIndex;
      if (c.nodeIsMissing) errors++;
      if (p >= 0) {
        const last = lastChild[lastChild.length - 1];
        if (last < 0) first[p] = id;
        else next[last] = id;
        lastChild[lastChild.length - 1] = id;
      }
      return id;
    };
    add();
    let current = 0;
    for (; ; ) {
      if (c.gotoFirstChild()) {
        stack.push(current);
        lastChild.push(-1);
        current = add();
        continue;
      }
      for (; ; ) {
        if (c.gotoNextSibling()) {
          current = add();
          break;
        }
        if (!c.gotoParent()) {
          current = -1;
          break;
        }
        current = stack.pop();
        lastChild.pop();
      }
      if (current < 0) break;
    }
    c.delete();
    const lineStarts = [0];
    for (let i2 = 0; i2 < text.length; i2++) if (text.charCodeAt(i2) === 10) lineStarts.push(i2 + 1);
    return { text, count: count2, type, field, named, start: start2, end, parent, first, next, lineStarts, errors };
  };
  var children = (t, n) => {
    const out2 = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) out2.push(c);
    return out2;
  };
  var namedChildren = (t, n) => {
    const out2 = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.named[c] && t.type[c] !== "comment") out2.push(c);
    return out2;
  };
  var child = (t, n, field) => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.field[c] === field) return c;
    return -1;
  };
  var childOfType = (t, n, ...types) => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (types.includes(t.type[c])) return c;
    return -1;
  };
  var hasToken = (t, n, token) => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c] && t.type[c] === token) return true;
    return false;
  };
  var tokensOf = (t, n) => {
    const out2 = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c]) out2.push(t.type[c]);
    return out2;
  };
  var textOf = (t, n) => t.text.slice(t.start[n], t.end[n]);
  var lineOf = (t, offset) => {
    let lo = 0;
    let hi = t.lineStarts.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (t.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  var prevSibling = (t, n) => {
    const p = t.parent[n];
    if (p < 0) return -1;
    let prev = -1;
    for (let c = t.first[p]; c >= 0 && c !== n; c = t.next[c]) prev = c;
    return prev;
  };

  // src/lib/facts.ts
  var VALUE = 1;
  var TYPE = 2;
  var NS = 4;
  var FN = /* @__PURE__ */ new Set(["function_expression", "arrow_function", "generator_function", "function"]);
  var WRAPPERS = /* @__PURE__ */ new Set(["parenthesized_expression", "as_expression", "satisfies_expression", "non_null_expression", "type_assertion"]);
  var unwrap = (t, n) => {
    while (n >= 0 && WRAPPERS.has(t.type[n])) {
      const inner = t.type[n] === "type_assertion" ? namedChildren(t, n).filter((c) => t.type[c] !== "type_arguments").pop() : namedChildren(t, n)[0];
      if (inner === void 0) break;
      n = inner;
    }
    return n;
  };
  var isFn = (t, n) => n >= 0 && FN.has(t.type[n]);
  var objectOf = (t, e) => {
    e = unwrap(t, e);
    if (e < 0) return -1;
    if (t.type[e] === "object") return e;
    if (t.type[e] === "call_expression") {
      const args2 = child(t, e, "arguments");
      if (args2 >= 0) {
        for (const a of namedChildren(t, args2)) if (t.type[unwrap(t, a)] === "object") return unwrap(t, a);
      }
    }
    return -1;
  };
  var propName = (t, n) => {
    if (n < 0) return "?";
    const ty = t.type[n];
    if (ty === "string") {
      const frag = childOfType(t, n, "string_fragment");
      return frag >= 0 ? textOf(t, frag) : "";
    }
    return textOf(t, n);
  };
  var stringValue = (t, n) => {
    if (n < 0) return null;
    if (t.type[n] === "string") return propName(t, n);
    if (t.type[n] === "template_string" && !namedChildren(t, n).some((c) => t.type[c] === "template_substitution")) return textOf(t, n).slice(1, -1);
    return null;
  };
  var analyzeFile = (path, t) => {
    const units = unitsOf(path, t);
    const scopes = scopesOf(t, units);
    const mods = modulesOf(t);
    const sites = sitesOf(t, scopes, mods);
    const facts = {
      path,
      flat: t,
      units,
      module: scopes.module,
      scopes: scopes.all,
      scopeOfNode: scopes.scopeOfNode,
      bindingOfName: scopes.bindingOfName,
      sites,
      imports: mods.imports,
      exports: mods.exports,
      moduleExports: mods.moduleExports,
      specifiers: mods.specifiers,
      shapes: /* @__PURE__ */ new Map(),
      protoAliases: /* @__PURE__ */ new Map(),
      assignments: []
    };
    shapesOf(facts, units);
    return facts;
  };
  var unitsOf = (path, t) => {
    const units = [];
    const docStartOf = (n) => {
      let first = t.start[n];
      for (let p = prevSibling(t, n); p >= 0 && t.type[p] === "comment"; p = prevSibling(t, p)) {
        const between = t.text.slice(t.end[p], first);
        if ((between.match(/\\n/g) ?? []).length > 1) break;
        first = t.start[p];
      }
      return first;
    };
    const memberStart = (n) => {
      let first = n;
      for (let p = prevSibling(t, n); p >= 0 && t.type[p] === "decorator"; p = prevSibling(t, p)) first = p;
      return first;
    };
    const overloadable = (n) => ["function_declaration", "generator_function_declaration", "function_signature", "method_definition", "method_signature", "abstract_method_signature"].includes(t.type[n]) && !hasToken(t, n, "get") && !hasToken(t, n, "set");
    const make = (node, outer, nameNode, name2, qname, kind, parent, valueNode = -1) => {
      const start2 = t.start[outer];
      const end = Math.max(t.end[outer], t.end[node]);
      const nameStart = nameNode >= 0 ? t.start[nameNode] : start2;
      const last = units[units.length - 1];
      if (last && last.name === name2 && last.parent === parent?.id && last.kind === kind && (kind === "function" || kind === "method") && overloadable(last.node) && overloadable(node)) {
        last.end = end;
        last.endLine = lineOf(t, Math.max(last.start, end - 1));
        last.node = node;
        if (valueNode >= 0) last.valueNode = valueNode;
        return last;
      }
      const u = {
        id: "",
        path,
        name: name2,
        qname,
        kind,
        start: start2,
        end,
        startLine: lineOf(t, start2),
        endLine: lineOf(t, Math.max(start2, end - 1)),
        nameLine: lineOf(t, nameStart),
        docLine: lineOf(t, docStartOf(outer)),
        nameStart,
        ...parent ? { parent: parent.id } : {},
        node,
        valueNode
      };
      u.id = \`\${path}:\${u.nameLine}\`;
      if (units.some((x2) => x2.id === u.id)) u.id = \`\${path}:\${u.nameLine}:\${name2}\`;
      units.push(u);
      return u;
    };
    const objectMembers = (obj, parent) => {
      for (const p of namedChildren(t, obj)) {
        const ty = t.type[p];
        if (ty === "method_definition") {
          const nm = child(t, p, "name");
          make(p, p, nm, propName(t, nm), \`\${parent.qname}.\${propName(t, nm)}\`, "method", parent, p);
        } else if (ty === "pair") {
          const v2 = unwrap(t, child(t, p, "value"));
          const k2 = child(t, p, "key");
          if (isFn(t, v2)) make(p, p, k2, propName(t, k2), \`\${parent.qname}.\${propName(t, k2)}\`, "method", parent, v2);
        }
      }
    };
    const classMembers = (cls, parent) => {
      const body2 = child(t, cls, "body");
      if (body2 < 0) return;
      for (const m2 of namedChildren(t, body2)) {
        const ty = t.type[m2];
        if (ty === "method_definition" || ty === "method_signature" || ty === "abstract_method_signature") {
          const nm = child(t, m2, "name");
          const name2 = propName(t, nm);
          make(m2, memberStart(m2), nm, name2, \`\${parent.qname}.\${name2}\`, "method", parent, m2);
        } else if (ty === "public_field_definition" || ty === "field_definition") {
          const nm = child(t, m2, ty === "field_definition" ? "property" : "name");
          const v2 = unwrap(t, child(t, m2, "value"));
          if (isFn(t, v2)) make(m2, memberStart(m2), nm, propName(t, nm), \`\${parent.qname}.\${propName(t, nm)}\`, "method", parent, v2);
        }
      }
    };
    const statements = (container, parent) => {
      const q2 = (name2) => parent ? \`\${parent.qname}.\${name2}\` : name2;
      for (const s of namedChildren(t, container)) {
        let decl = s;
        const outer = s;
        if (t.type[s] === "export_statement") {
          const d = child(t, s, "declaration");
          const v2 = child(t, s, "value");
          if (d >= 0) decl = d;
          else if (v2 >= 0) {
            const e = unwrap(t, v2);
            if (t.type[e] === "identifier") continue;
            const kw = children(t, s).find((c) => !t.named[c] && t.type[c] === "default") ?? s;
            if (t.type[e] === "class") {
              classMembers(e, make(s, s, kw, "default", q2("default"), "class", parent, e));
              continue;
            }
            const u = make(s, s, kw, "default", "default", isFn(t, e) ? "function" : "value", parent, e);
            const obj = objectOf(t, v2);
            if (obj >= 0) objectMembers(obj, u);
            continue;
          } else {
            const e = namedChildren(t, s).find((c) => t.type[c] !== "export_clause" && t.type[c] !== "namespace_export" && t.type[c] !== "string" && t.type[c] !== "decorator");
            if (e === void 0 || !hasToken(t, s, "=")) continue;
            const x2 = unwrap(t, e);
            if (t.type[x2] === "identifier") continue;
            const u = make(s, s, s, "default", "default", isFn(t, x2) ? "function" : "value", parent, x2);
            const obj = objectOf(t, e);
            if (obj >= 0) objectMembers(obj, u);
            continue;
          }
        }
        if (t.type[decl] === "ambient_declaration") {
          const block = childOfType(t, decl, "statement_block");
          if (hasToken(t, decl, "global") && block >= 0) {
            const kw = children(t, decl).find((c) => !t.named[c] && t.type[c] === "global") ?? decl;
            statements(block, make(decl, outer, kw, "global", q2("global"), "namespace", parent, decl));
            continue;
          }
          const inner = namedChildren(t, decl).find((c) => t.type[c] !== "comment");
          if (inner === void 0) continue;
          decl = inner;
        }
        const ty = t.type[decl];
        if (ty === "function_declaration" || ty === "generator_function_declaration" || ty === "function_signature") {
          const nm = child(t, decl, "name");
          const name2 = nm >= 0 ? textOf(t, nm) : "default";
          make(decl, outer, nm >= 0 ? nm : outer, name2, q2(name2), "function", parent, decl);
        } else if (ty === "class_declaration" || ty === "abstract_class_declaration") {
          const nm = child(t, decl, "name");
          const name2 = nm >= 0 ? textOf(t, nm) : "default";
          classMembers(decl, make(decl, outer, nm >= 0 ? nm : outer, name2, q2(name2), "class", parent, decl));
        } else if (ty === "interface_declaration" || ty === "type_alias_declaration" || ty === "enum_declaration") {
          const nm = child(t, decl, "name");
          make(decl, outer, nm, textOf(t, nm), q2(textOf(t, nm)), "type", parent, decl);
        } else if (ty === "internal_module" || ty === "module") {
          const nm = child(t, decl, "name");
          const name2 = propName(t, nm);
          const u = make(decl, outer, nm, name2, q2(name2), "namespace", parent, decl);
          const body2 = child(t, decl, "body");
          if (body2 >= 0) statements(body2, u);
        } else if (ty === "lexical_declaration" || ty === "variable_declaration") {
          const decls = namedChildren(t, decl).filter((c) => t.type[c] === "variable_declarator");
          for (const d of decls) {
            const nm = child(t, d, "name");
            if (nm < 0 || t.type[nm] !== "identifier") continue;
            const value = child(t, d, "value");
            const init2 = unwrap(t, value);
            const node = decls.length === 1 ? outer : d;
            const name2 = textOf(t, nm);
            if (init2 >= 0 && t.type[init2] === "class") classMembers(init2, make(d, node, nm, name2, q2(name2), "class", parent, init2));
            else if (isFn(t, init2)) make(d, node, nm, name2, q2(name2), "function", parent, init2);
            else {
              const obj = value >= 0 ? objectOf(t, value) : -1;
              const u = make(d, node, nm, name2, q2(name2), "value", parent, obj);
              if (obj >= 0) objectMembers(obj, u);
            }
          }
        } else if (ty === "expression_statement") {
          const e = namedChildren(t, decl)[0];
          if (e === void 0 || t.type[e] !== "assignment_expression") continue;
          const lhs = child(t, e, "left");
          const rhsRaw = child(t, e, "right");
          const rhs = unwrap(t, rhsRaw);
          if (t.type[lhs] !== "member_expression" && t.type[lhs] !== "subscript_expression") continue;
          const lhsText = textOf(t, lhs);
          const nameNode = t.type[lhs] === "member_expression" ? child(t, lhs, "property") : child(t, lhs, "index");
          const name2 = propName(t, nameNode);
          if (isFn(t, rhs)) make(decl, outer, nameNode, name2, lhsText, /^(module\\.)?exports\\./.test(lhsText) ? "function" : "method", parent, rhs);
          else if (rhs >= 0 && t.type[rhs] === "class") classMembers(rhs, make(decl, outer, nameNode, name2, lhsText, "class", parent, rhs));
          else if (/^module\\.exports$/.test(lhsText)) {
            const obj = objectOf(t, rhsRaw);
            if (obj >= 0) objectMembers(obj, make(decl, outer, lhs, "module.exports", "module.exports", "value", parent, obj));
          }
        }
      }
    };
    statements(0);
    return units;
  };
  var scopesOf = (t, units) => {
    let nextId = 0;
    const all = [];
    const scopeOfNode = /* @__PURE__ */ new Map();
    const bindingOfName = /* @__PURE__ */ new Map();
    const newScope = (node, kind, parent) => {
      const s = { id: nextId++, node, kind, parent, bindings: /* @__PURE__ */ new Map() };
      all.push(s);
      scopeOfNode.set(node, s);
      return s;
    };
    const module2 = newScope(0, "module", null);
    const unitsByName = /* @__PURE__ */ new Map();
    for (const u of units) if (!u.parent) unitsByName.set(u.name, [...unitsByName.get(u.name) ?? [], u]);
    const declare = (scope, nameNode, kind, meaning, extra = {}) => {
      const name2 = textOf(t, nameNode);
      const b2 = { name: name2, meaning, kind, node: nameNode, scope, init: -1, typeNode: -1, decl: -1, ...extra };
      if (scope === module2 && !b2.unit && kind !== "import") {
        const u = (unitsByName.get(name2) ?? []).find((x2) => t.start[nameNode] >= x2.start && t.start[nameNode] < x2.end);
        if (u) b2.unit = u;
      }
      const list = scope.bindings.get(name2) ?? [];
      list.push(b2);
      scope.bindings.set(name2, list);
      bindingOfName.set(nameNode, b2);
      return b2;
    };
    const functionScopeOf = (s) => {
      let x2 = s;
      while (x2 && x2.kind !== "function" && x2.kind !== "arrow" && x2.kind !== "module") x2 = x2.parent;
      return x2 ?? module2;
    };
    const patternNames = (p, path, out2, init2 = -1) => {
      if (p < 0) return;
      const ty = t.type[p];
      if (ty === "identifier" || ty === "shorthand_property_identifier_pattern") out2.push({ node: p, path: ty === "shorthand_property_identifier_pattern" ? [...path, textOf(t, p)] : path, init: init2 });
      else if (ty === "object_pattern") {
        for (const c of namedChildren(t, p)) {
          if (t.type[c] === "shorthand_property_identifier_pattern") out2.push({ node: c, path: [...path, textOf(t, c)], init: -1 });
          else if (t.type[c] === "pair_pattern") patternNames(child(t, c, "value"), [...path, propName(t, child(t, c, "key"))], out2);
          else if (t.type[c] === "object_assignment_pattern") {
            const left = child(t, c, "left");
            if (t.type[left] === "shorthand_property_identifier_pattern") out2.push({ node: left, path: [...path, textOf(t, left)], init: child(t, c, "right") });
            else patternNames(left, path, out2);
          } else if (t.type[c] === "rest_pattern") patternNames(namedChildren(t, c)[0] ?? -1, [...path, "..."], out2);
        }
      } else if (ty === "array_pattern") {
        namedChildren(t, p).forEach((c, i2) => patternNames(c, [...path, String(i2)], out2));
      } else if (ty === "assignment_pattern") patternNames(child(t, p, "left"), path, out2, child(t, p, "right"));
      else if (ty === "rest_pattern") patternNames(namedChildren(t, p)[0] ?? -1, [...path, "..."], out2);
    };
    const declarePattern = (scope, p, kind, init2, typeNode) => {
      const names = [];
      patternNames(p, [], names);
      const plain = names.length === 1 && names[0].node === p;
      for (const n of names) declare(scope, n.node, kind, VALUE, { init: init2, typeNode, ...plain ? {} : { path: n.path }, decl: p });
    };
    const typeParams = (scope, n) => {
      const tp = child(t, n, "type_parameters");
      if (tp < 0) return;
      for (const p of namedChildren(t, tp)) {
        const nm = child(t, p, "name");
        if (nm >= 0) declare(scope, nm, "typeparam", TYPE);
      }
    };
    const params = (scope, fn) => {
      const single = child(t, fn, "parameter");
      if (single >= 0) declare(scope, single, "param", VALUE);
      const ps = child(t, fn, "parameters");
      if (ps < 0) return;
      for (const p of namedChildren(t, ps)) {
        if (t.type[p] === "required_parameter" || t.type[p] === "optional_parameter") {
          const pat = child(t, p, "pattern");
          const ty = child(t, p, "type");
          const typeNode = ty >= 0 ? namedChildren(t, ty)[0] ?? -1 : -1;
          if (pat >= 0 && t.type[pat] !== "this") declarePattern(scope, pat, "param", child(t, p, "value"), typeNode);
        } else declarePattern(scope, p, "param", -1, -1);
      }
    };
    const declareImport = (scope, stmt) => {
      for (const c of namedChildren(t, stmt)) {
        if (t.type[c] === "import_clause") {
          for (const k2 of namedChildren(t, c)) {
            if (t.type[k2] === "identifier") declare(scope, k2, "import", VALUE | TYPE | NS, { decl: k2 });
            else if (t.type[k2] === "namespace_import") {
              const id = childOfType(t, k2, "identifier");
              if (id >= 0) declare(scope, id, "import", VALUE | TYPE | NS, { decl: k2 });
            } else if (t.type[k2] === "named_imports") {
              for (const sp of namedChildren(t, k2)) {
                if (t.type[sp] !== "import_specifier") continue;
                const alias = child(t, sp, "alias");
                const nm = child(t, sp, "name");
                const local = alias >= 0 ? alias : nm;
                if (local >= 0 && t.type[local] === "identifier") declare(scope, local, "import", VALUE | TYPE | NS, { decl: sp });
              }
            }
          }
        } else if (t.type[c] === "import_require_clause") {
          const id = childOfType(t, c, "identifier");
          if (id >= 0) declare(scope, id, "import", VALUE | TYPE | NS, { decl: c });
        }
      }
    };
    const varDecl = (scope, n) => {
      const kindTok = child(t, n, "kind");
      const kind = t.type[n] === "variable_declaration" ? "var" : kindTok >= 0 && t.type[kindTok] === "let" ? "let" : "const";
      const target = kind === "var" ? functionScopeOf(scope) : scope;
      for (const d of namedChildren(t, n)) {
        if (t.type[d] !== "variable_declarator") continue;
        const ty = child(t, d, "type");
        declarePattern(target, child(t, d, "name"), kind, child(t, d, "value"), ty >= 0 ? namedChildren(t, ty)[0] ?? -1 : -1);
      }
    };
    const scopeIndex = new Int32Array(t.count);
    const scopeAt = { get: (n) => all[scopeIndex[n]] };
    const stack = [0];
    while (stack.length > 0) {
      const n = stack.pop();
      const outer = scopeAt.get(n);
      const ty = t.type[n];
      let inner = outer;
      switch (ty) {
        case "function_declaration":
        case "generator_function_declaration": {
          const nm = child(t, n, "name");
          if (nm >= 0) declare(outer, nm, "function", VALUE, { decl: n });
          inner = newScope(n, "function", outer);
          typeParams(inner, n);
          params(inner, n);
          break;
        }
        case "function_signature": {
          const nm = child(t, n, "name");
          if (nm >= 0 && !(outer.bindings.get(textOf(t, nm)) ?? []).some((b2) => b2.kind === "function")) declare(outer, nm, "function", VALUE, { decl: n });
          inner = newScope(n, "type", outer);
          typeParams(inner, n);
          break;
        }
        case "function_expression":
        case "function":
        case "generator_function": {
          inner = newScope(n, "function", outer);
          const nm = child(t, n, "name");
          if (nm >= 0) declare(inner, nm, "function", VALUE, { decl: n });
          typeParams(inner, n);
          params(inner, n);
          break;
        }
        case "arrow_function":
          inner = newScope(n, "arrow", outer);
          typeParams(inner, n);
          params(inner, n);
          break;
        case "method_definition":
        case "method_signature":
        case "abstract_method_signature":
          inner = newScope(n, ty === "method_definition" ? "function" : "type", outer);
          typeParams(inner, n);
          params(inner, n);
          break;
        case "class_declaration":
        case "abstract_class_declaration": {
          const nm = child(t, n, "name");
          if (nm >= 0) declare(outer, nm, "class", VALUE | TYPE, { decl: n });
          inner = newScope(n, "class", outer);
          typeParams(inner, n);
          break;
        }
        case "class": {
          inner = newScope(n, "class", outer);
          const nm = child(t, n, "name");
          if (nm >= 0) declare(inner, nm, "class", VALUE | TYPE, { decl: n });
          typeParams(inner, n);
          break;
        }
        case "interface_declaration":
        case "type_alias_declaration": {
          const nm = child(t, n, "name");
          if (nm >= 0) declare(outer, nm, "type", TYPE, { decl: n });
          inner = newScope(n, "type", outer);
          typeParams(inner, n);
          break;
        }
        case "enum_declaration": {
          const nm = child(t, n, "name");
          if (nm >= 0) declare(outer, nm, "enum", VALUE | TYPE, { decl: n });
          break;
        }
        case "internal_module":
        case "module": {
          const nm = child(t, n, "name");
          if (nm >= 0 && t.type[nm] === "identifier") declare(outer, nm, "namespace", VALUE | TYPE | NS, { decl: n });
          break;
        }
        case "statement_block":
        case "switch_body":
        case "class_static_block": {
          const p = t.parent[n];
          const pt2 = p >= 0 ? t.type[p] : "";
          if (!(t.field[n] === "body" && (pt2 === "function_declaration" || pt2 === "function_expression" || pt2 === "function" || pt2 === "generator_function" || pt2 === "generator_function_declaration" || pt2 === "arrow_function" || pt2 === "method_definition"))) inner = newScope(n, "block", outer);
          break;
        }
        case "for_statement":
        case "for_in_statement":
          inner = newScope(n, "for", outer);
          if (ty === "for_in_statement") {
            const kindTok = child(t, n, "kind");
            if (kindTok >= 0) {
              const k2 = t.type[kindTok] === "var" ? "var" : t.type[kindTok] === "let" ? "let" : "const";
              declarePattern(k2 === "var" ? functionScopeOf(outer) : inner, child(t, n, "left"), k2, -1, -1);
            }
          }
          break;
        case "catch_clause": {
          inner = newScope(n, "catch", outer);
          const p = child(t, n, "parameter");
          if (p >= 0) declarePattern(inner, p, "catch", -1, -1);
          break;
        }
        case "lexical_declaration":
        case "variable_declaration":
          varDecl(outer, n);
          break;
        case "import_statement":
          declareImport(module2, n);
          break;
      }
      for (let c = t.first[n]; c >= 0; c = t.next[c]) {
        scopeIndex[c] = inner.id;
        stack.push(c);
      }
    }
    return { module: module2, all, scopeOfNode, bindingOfName, scopeAt };
  };
  var lookup = (scope, name2, meaning) => {
    for (let s = scope; s; s = s.parent) {
      const list = s.bindings.get(name2);
      if (!list) continue;
      const b2 = list.find((x2) => x2.meaning & meaning);
      if (b2) return b2;
    }
    return null;
  };
  var requireSpec = (t, n, scope) => {
    n = unwrap(t, n);
    if (n < 0 || t.type[n] !== "call_expression") return null;
    const fn = child(t, n, "function");
    if (fn < 0 || t.type[fn] !== "identifier" || textOf(t, fn) !== "require") return null;
    if (scope && lookup(scope, "require", VALUE)) return null;
    const args2 = child(t, n, "arguments");
    const first = args2 >= 0 ? namedChildren(t, args2)[0] : void 0;
    return first === void 0 ? null : stringValue(t, first);
  };
  var modulesOf = (t) => {
    const imports = [];
    const exports = [];
    const specifiers = [];
    let moduleExports2 = -1;
    for (const s of namedChildren(t, 0)) {
      const ty = t.type[s];
      if (ty === "import_statement") {
        const src = child(t, s, "source");
        const spec = stringValue(t, src);
        const typeOnly = children(t, s).some((c) => !t.named[c] && t.type[c] === "type");
        const req = childOfType(t, s, "import_require_clause");
        if (req >= 0) {
          const rs = stringValue(t, child(t, req, "source"));
          const id = childOfType(t, req, "identifier");
          if (rs !== null) {
            specifiers.push({ spec: rs, node: req, reexport: false });
            if (id >= 0) imports.push({ local: textOf(t, id), spec: rs, imported: "=", node: id, typeOnly, kind: "import-equals" });
          }
          continue;
        }
        if (spec === null) continue;
        specifiers.push({ spec, node: s, reexport: false });
        const clause = childOfType(t, s, "import_clause");
        if (clause < 0) continue;
        for (const k2 of namedChildren(t, clause)) {
          if (t.type[k2] === "identifier") imports.push({ local: textOf(t, k2), spec, imported: "default", node: k2, typeOnly, kind: "esm" });
          else if (t.type[k2] === "namespace_import") {
            const id = childOfType(t, k2, "identifier");
            if (id >= 0) imports.push({ local: textOf(t, id), spec, imported: "*", node: id, typeOnly, kind: "esm" });
          } else if (t.type[k2] === "named_imports") {
            for (const sp of namedChildren(t, k2)) {
              if (t.type[sp] !== "import_specifier") continue;
              const nm = child(t, sp, "name");
              const alias = child(t, sp, "alias");
              const specTypeOnly = typeOnly || children(t, sp).some((c) => !t.named[c] && t.type[c] === "type");
              imports.push({ local: textOf(t, alias >= 0 ? alias : nm), spec, imported: propName(t, nm), node: nm, typeOnly: specTypeOnly, kind: "esm" });
            }
          }
        }
      } else if (ty === "export_statement") {
        const src = child(t, s, "source");
        const spec = src >= 0 ? stringValue(t, src) : null;
        if (spec !== null) specifiers.push({ spec, node: s, reexport: true });
        const decl = child(t, s, "declaration");
        const value = child(t, s, "value");
        const clause = childOfType(t, s, "export_clause");
        const nsExport = childOfType(t, s, "namespace_export");
        const isDefault = children(t, s).some((c) => !t.named[c] && t.type[c] === "default");
        if (decl >= 0) {
          let d = decl;
          if (t.type[d] === "ambient_declaration") d = namedChildren(t, d)[0] ?? d;
          const dt2 = t.type[d];
          if (dt2 === "lexical_declaration" || dt2 === "variable_declaration") {
            for (const vd of namedChildren(t, d)) {
              if (t.type[vd] !== "variable_declarator") continue;
              const names = [];
              const collect = (p) => {
                if (p < 0) return;
                if (t.type[p] === "identifier" || t.type[p] === "shorthand_property_identifier_pattern") names.push(p);
                else for (const c of namedChildren(t, p)) if (t.type[c] !== "property_identifier" || t.field[c] !== "key") collect(t.type[c] === "pair_pattern" ? child(t, c, "value") : c);
              };
              collect(child(t, vd, "name"));
              for (const nm of names) exports.push({ kind: "local", name: textOf(t, nm), local: textOf(t, nm), node: s, nameNode: nm });
            }
          } else {
            const nm = child(t, d, "name");
            if (nm >= 0) exports.push({ kind: "local", name: isDefault ? "default" : propName(t, nm), local: propName(t, nm), node: s, nameNode: nm });
            else if (isDefault) exports.push({ kind: "expr", name: "default", value: d, node: s });
          }
        } else if (value >= 0) {
          exports.push({ kind: "expr", name: "default", value, node: s });
        } else if (clause >= 0) {
          for (const sp of namedChildren(t, clause)) {
            if (t.type[sp] !== "export_specifier") continue;
            const nm = child(t, sp, "name");
            const alias = child(t, sp, "alias");
            const name2 = propName(t, alias >= 0 ? alias : nm);
            if (spec !== null) exports.push({ kind: "reexport", name: name2, spec, imported: propName(t, nm), node: s, nameNode: nm });
            else exports.push({ kind: "local", name: name2, local: propName(t, nm), node: s, nameNode: nm });
          }
        } else if (nsExport >= 0 && spec !== null) {
          const id = namedChildren(t, nsExport)[0];
          exports.push({ kind: "namespace", name: id !== void 0 ? propName(t, id) : "*", spec, node: s });
        } else if (spec !== null) {
          exports.push({ kind: "star", spec, node: s });
        } else if (hasToken(t, s, "=")) {
          const e = namedChildren(t, s).find((c) => t.type[c] !== "decorator");
          if (e !== void 0) moduleExports2 = e;
        }
      } else if (ty === "expression_statement") {
        const e = namedChildren(t, s)[0];
        if (e === void 0 || t.type[e] !== "assignment_expression") continue;
        const lhs = child(t, e, "left");
        const rhs = child(t, e, "right");
        const lt2 = textOf(t, lhs);
        if (lt2 === "module.exports") moduleExports2 = rhs;
        else {
          const m2 = /^(?:module\\.)?exports\\.([A-Za-z_$][\\w$]*)$/.exec(lt2);
          if (m2) exports.push({ kind: "expr", name: m2[1], value: rhs, node: s });
        }
      }
    }
    for (let n = 0; n < t.count; n++) {
      if (t.type[n] !== "call_expression") continue;
      const fn = child(t, n, "function");
      if (fn < 0) continue;
      const isImport = t.type[fn] === "import";
      const isRequire = t.type[fn] === "identifier" && textOf(t, fn) === "require";
      if (!isImport && !isRequire) continue;
      const args2 = child(t, n, "arguments");
      const first = args2 >= 0 ? namedChildren(t, args2)[0] : void 0;
      const spec = first === void 0 ? null : stringValue(t, first);
      if (spec !== null) specifiers.push({ spec, node: n, reexport: false });
    }
    return { imports, exports, specifiers, moduleExports: moduleExports2 };
  };
  var TYPE_CONTEXT = /* @__PURE__ */ new Set(["type_query", "nested_type_identifier", "type_annotation", "type_arguments", "implements_clause", "extends_type_clause", "type_predicate", "asserts"]);
  var ASSIGN = /* @__PURE__ */ new Set(["assignment_expression", "augmented_assignment_expression"]);
  var sitesOf = (t, scopes, mods) => {
    const sites = [];
    const importByNode = /* @__PURE__ */ new Map();
    for (const i2 of mods.imports) importByNode.set(i2.node, i2);
    const exportByName = /* @__PURE__ */ new Map();
    for (const e of mods.exports) if (e.kind === "local" || e.kind === "reexport") exportByName.set(e.nameNode, e);
    const scopeOf = (n) => scopes.scopeAt.get(n) ?? scopes.module;
    const push2 = (node, name2, ref, form, extra = {}) => {
      const start2 = t.start[node];
      sites.push({ node, start: start2, line: lineOf(t, start2), name: name2, ref, form, scope: scopeOf(node), receiver: -1, ...extra });
    };
    const valueKind = (id) => {
      let e = id;
      const p0 = t.parent[e];
      if (p0 >= 0 && (t.type[p0] === "member_expression" && t.field[e] === "property")) e = p0;
      else if (p0 >= 0 && t.type[p0] === "subscript_expression" && t.field[e] === "index") e = p0;
      while (t.parent[e] >= 0 && (t.type[t.parent[e]] === "parenthesized_expression" || t.type[t.parent[e]] === "non_null_expression" || t.type[t.parent[e]] === "as_expression")) e = t.parent[e];
      const p = t.parent[e];
      if (p < 0) return "value";
      const pt2 = t.type[p];
      if (pt2 === "call_expression" && t.field[e] === "function") return "call";
      if (pt2 === "new_expression" && t.field[e] === "constructor") return "call";
      if (pt2 === "decorator") return "call";
      if ((pt2 === "jsx_opening_element" || pt2 === "jsx_self_closing_element" || pt2 === "jsx_closing_element") && t.field[e] === "name") return "jsx";
      if (ASSIGN.has(pt2) && t.field[e] === "left") return "write";
      return "value";
    };
    const contextKind = (id) => {
      for (let a = t.parent[id]; a >= 0; a = t.parent[a]) {
        const at2 = t.type[a];
        if (at2 === "import_statement") return "import";
        if (at2 === "export_statement") {
          if (child(t, a, "declaration") >= 0) break;
          const v2 = child(t, a, "value");
          if (v2 >= 0) {
            if (unwrap(t, v2) === id) return "export";
            break;
          }
          return child(t, a, "source") >= 0 ? "import" : "export";
        }
        if (at2 === "variable_declarator") {
          const nm = child(t, a, "name");
          if (requireSpec(t, child(t, a, "value"), null) !== null && nm >= 0 && t.type[nm] !== "identifier") return "import";
          break;
        }
        if (at2 === "statement_block" || at2 === "program") break;
      }
      for (let a = t.parent[id]; a > 0; a = t.parent[a]) {
        const at2 = t.type[a];
        if (at2 === "extends_clause") return t.field[id] === "value" || t.parent[id] === a ? "extends" : "type";
        if (at2 === "class_heritage") return "extends";
        if (TYPE_CONTEXT.has(at2)) return "type";
        if (at2.endsWith("_statement") || at2 === "statement_block" || at2 === "arguments" || at2 === "call_expression" || at2 === "new_expression" || at2 === "arrow_function" || at2 === "pair" || at2 === "variable_declarator" || at2 === "assignment_expression" || at2 === "class_body" || at2 === "formal_parameters" || at2 === "binary_expression" || at2 === "ternary_expression" || at2 === "member_expression" && TYPE_CONTEXT.has(t.type[t.parent[a]] ?? "") === false) break;
      }
      return null;
    };
    for (let n = 1; n < t.count; n++) {
      const ty = t.type[n];
      if (ty === "identifier") {
        const p = t.parent[n];
        const pt2 = t.type[p];
        const name2 = textOf(t, n);
        if (pt2 === "import_specifier") {
          if (t.field[n] === "name") {
            const entry = importByNode.get(n);
            if (entry) push2(n, entry.imported, "import", "import", { importEntry: entry });
          }
          continue;
        }
        if (pt2 === "import_clause") {
          const entry = importByNode.get(n);
          if (entry) push2(n, name2, "import", "import", { importEntry: entry });
          continue;
        }
        if (pt2 === "namespace_import" || pt2 === "import_require_clause" || pt2 === "namespace_export") continue;
        if (pt2 === "export_specifier") {
          if (t.field[n] === "name") {
            const e = exportByName.get(n);
            if (e) push2(n, name2, e.kind === "reexport" ? "import" : "export", "export", { exportEntry: e });
          }
          continue;
        }
        const b2 = scopes.bindingOfName.get(n);
        if (b2) {
          if (b2.path && b2.path.length > 0) {
            const vd = enclosingDeclarator(t, n);
            if (vd >= 0 && requireSpec(t, child(t, vd, "value"), null) !== null) {
              const keyNode = t.type[p] === "pair_pattern" ? child(t, p, "key") : n;
              push2(keyNode, b2.path[b2.path.length - 1], "import", "require", { keyPath: b2.path });
            }
          }
          continue;
        }
        if ((pt2 === "jsx_opening_element" || pt2 === "jsx_self_closing_element" || pt2 === "jsx_closing_element") && /^[a-z]/.test(name2)) continue;
        if (pt2 === "nested_identifier" || pt2 === "internal_module" || pt2 === "module") continue;
        if (pt2 === "nested_type_identifier" && t.field[n] === "module") {
          push2(n, name2, "type", "bare");
          continue;
        }
        const ctx = contextKind(n);
        push2(n, name2, ctx ?? valueKind(n), "bare");
      } else if (ty === "type_identifier") {
        if (scopes.bindingOfName.has(n)) continue;
        const p = t.parent[n];
        if (t.type[p] === "nested_type_identifier") {
          if (t.field[n] === "name") push2(n, textOf(t, n), contextKind(n) === "import" ? "import" : "type", "member", { receiver: child(t, p, "module") });
          continue;
        }
        const ctx = contextKind(n);
        push2(n, textOf(t, n), ctx === "import" || ctx === "export" || ctx === "extends" ? ctx : "type", "bare");
      } else if (ty === "shorthand_property_identifier") {
        push2(n, textOf(t, n), contextKind(n) ?? "value", "bare");
      } else if (ty === "shorthand_property_identifier_pattern") {
        if (scopes.bindingOfName.has(n)) {
          const vd = enclosingDeclarator(t, n);
          const b2 = scopes.bindingOfName.get(n);
          if (vd >= 0 && b2.path && requireSpec(t, child(t, vd, "value"), null) !== null) push2(n, textOf(t, n), "import", "require", { keyPath: b2.path });
          continue;
        }
        push2(n, textOf(t, n), "write", "bare");
      } else if (ty === "property_identifier" || ty === "private_property_identifier") {
        const p = t.parent[n];
        if (t.type[p] === "member_expression" && t.field[n] === "property") {
          const obj = child(t, p, "object");
          const ctx = contextKind(n);
          push2(n, textOf(t, n), ctx === "type" ? "type" : ctx === "import" || ctx === "export" ? ctx : valueKind(n), "member", { receiver: obj });
        }
      } else if (ty === "string" && t.type[t.parent[n]] === "subscript_expression" && t.field[n] === "index") {
        const p = t.parent[n];
        const name2 = propName(t, n);
        if (/^[A-Za-z_$#][\\w$]*$/.test(name2)) push2(n, name2, valueKind(n), "member", { receiver: child(t, p, "object"), start: t.start[n] + 1 });
      }
    }
    return sites;
  };
  var enclosingDeclarator = (t, n) => {
    for (let a = t.parent[n]; a >= 0; a = t.parent[a]) {
      const at2 = t.type[a];
      if (at2 === "variable_declarator") return a;
      if (at2 !== "object_pattern" && at2 !== "pair_pattern" && at2 !== "array_pattern" && at2 !== "shorthand_property_identifier_pattern" && at2 !== "object_assignment_pattern" && at2 !== "assignment_pattern" && at2 !== "rest_pattern") return -1;
    }
    return -1;
  };
  var shapesOf = (f2, units) => {
    const t = f2.flat;
    const unitByValue = /* @__PURE__ */ new Map();
    const unitByNode = /* @__PURE__ */ new Map();
    for (const u of units) {
      unitByNode.set(u.node, u);
      if (u.valueNode >= 0) unitByValue.set(u.valueNode, u);
    }
    const memberUnit = (node, valueNode) => unitByNode.get(node) ?? (valueNode >= 0 ? unitByValue.get(valueNode) : void 0);
    const shapeId = (n) => \`\${f2.path}#\${t.start[n]}\`;
    for (let n = 0; n < t.count; n++) {
      const ty = t.type[n];
      if (ty === "class_declaration" || ty === "abstract_class_declaration" || ty === "class") {
        const nm = child(t, n, "name");
        const shape = { id: shapeId(n), path: f2.path, name: nm >= 0 ? textOf(t, nm) : "default", kind: "class", node: n, members: [], heritage: [], unit: unitByNode.get(n) ?? unitByValue.get(n), open: false };
        const heritage = childOfType(t, n, "class_heritage");
        if (heritage >= 0) {
          for (const h of namedChildren(t, heritage)) {
            if (t.type[h] === "extends_clause") {
              const v2 = child(t, h, "value");
              if (v2 >= 0) shape.heritage.push(v2);
            } else if (t.type[h] !== "implements_clause") shape.heritage.push(h);
          }
        }
        const body2 = child(t, n, "body");
        if (body2 >= 0) {
          for (const m2 of namedChildren(t, body2)) {
            const mt = t.type[m2];
            const isStatic = hasToken(t, m2, "static");
            if (mt === "method_definition" || mt === "method_signature" || mt === "abstract_method_signature") {
              const nm2 = child(t, m2, "name");
              const name2 = propName(t, nm2);
              const kind = hasToken(t, m2, "get") ? "get" : hasToken(t, m2, "set") ? "set" : mt === "method_definition" ? "method" : "signature";
              shape.members.push({ name: name2, static: isStatic, kind, node: m2, nameStart: t.start[nm2], unit: memberUnit(m2, m2), value: m2, typeNode: -1 });
              if (name2 === "constructor" && mt === "method_definition") {
                const ps = child(t, m2, "parameters");
                for (const p of ps >= 0 ? namedChildren(t, ps) : []) {
                  if ((t.type[p] === "required_parameter" || t.type[p] === "optional_parameter") && (childOfType(t, p, "accessibility_modifier") >= 0 || hasToken(t, p, "readonly"))) {
                    const pat = child(t, p, "pattern");
                    const typ = child(t, p, "type");
                    if (pat >= 0 && t.type[pat] === "identifier") shape.members.push({ name: textOf(t, pat), static: false, kind: "param", node: p, nameStart: t.start[pat], value: -1, typeNode: typ >= 0 ? namedChildren(t, typ)[0] ?? -1 : -1 });
                  }
                }
              }
            } else if (mt === "public_field_definition" || mt === "field_definition") {
              const nm2 = child(t, m2, mt === "field_definition" ? "property" : "name");
              const v2 = child(t, m2, "value");
              const typ = child(t, m2, "type");
              shape.members.push({ name: propName(t, nm2), static: isStatic, kind: "field", node: m2, nameStart: t.start[nm2], unit: memberUnit(m2, unwrap(t, v2)), value: v2, typeNode: typ >= 0 ? namedChildren(t, typ)[0] ?? -1 : -1 });
            }
          }
          collectThisAssignments(t, body2, shape, false);
        }
        f2.shapes.set(n, shape);
      } else if (ty === "interface_declaration") {
        const nm = child(t, n, "name");
        const shape = { id: shapeId(n), path: f2.path, name: textOf(t, nm), kind: "interface", node: n, members: [], heritage: [], unit: unitByNode.get(n), open: false };
        const ext = childOfType(t, n, "extends_type_clause");
        if (ext >= 0) shape.heritage.push(...namedChildren(t, ext));
        const body2 = child(t, n, "body");
        if (body2 >= 0) addTypeMembers(t, body2, shape);
        f2.shapes.set(n, shape);
      } else if (ty === "object_type") {
        const shape = { id: shapeId(n), path: f2.path, name: "{}", kind: "interface", node: n, members: [], heritage: [], open: false };
        addTypeMembers(t, n, shape);
        f2.shapes.set(n, shape);
      } else if (ty === "object") {
        const shape = { id: shapeId(n), path: f2.path, name: "{}", kind: "object", node: n, members: [], heritage: [], unit: unitByValue.get(n), open: false };
        for (const p of namedChildren(t, n)) {
          const pt2 = t.type[p];
          if (pt2 === "method_definition") {
            const nm = child(t, p, "name");
            const kind = hasToken(t, p, "get") ? "get" : hasToken(t, p, "set") ? "set" : "method";
            shape.members.push({ name: propName(t, nm), static: false, kind, node: p, nameStart: t.start[nm], unit: memberUnit(p, p), value: p, typeNode: -1 });
          } else if (pt2 === "pair") {
            const k2 = child(t, p, "key");
            if (t.type[k2] === "computed_property_name") {
              shape.open = true;
              continue;
            }
            const v2 = child(t, p, "value");
            shape.members.push({ name: propName(t, k2), static: false, kind: "pair", node: p, nameStart: t.start[k2], unit: memberUnit(p, unwrap(t, v2)), value: v2, typeNode: -1 });
          } else if (pt2 === "shorthand_property_identifier") {
            shape.members.push({ name: textOf(t, p), static: false, kind: "shorthand", node: p, nameStart: t.start[p], value: p, typeNode: -1 });
          } else if (pt2 === "spread_element") shape.open = true;
        }
        f2.shapes.set(n, shape);
      } else if (ty === "internal_module" || ty === "module") {
        const nm = child(t, n, "name");
        f2.shapes.set(n, { id: shapeId(n), path: f2.path, name: propName(t, nm), kind: "namespace", node: n, members: [], heritage: [], unit: unitByNode.get(n), open: false });
      }
    }
    const prototypeOf = (e) => {
      e = unwrap(t, e);
      if (e < 0) return null;
      if (t.type[e] === "assignment_expression") return prototypeOf(child(t, e, "left"));
      if (t.type[e] === "member_expression" && propName(t, child(t, e, "property")) === "prototype") {
        const o = unwrap(t, child(t, e, "object"));
        if (t.type[o] === "identifier") return textOf(t, o);
      }
      return null;
    };
    for (const s of namedChildren(t, 0)) {
      if (t.type[s] === "lexical_declaration" || t.type[s] === "variable_declaration") {
        for (const d of namedChildren(t, s)) {
          if (t.type[d] !== "variable_declarator") continue;
          const nm = child(t, d, "name");
          const owner = prototypeOf(child(t, d, "value"));
          if (owner && nm >= 0 && t.type[nm] === "identifier") f2.protoAliases.set(textOf(t, nm), owner);
        }
      }
    }
    const unitAt = (stmt, rhs) => unitByNode.get(stmt) ?? unitByValue.get(unwrap(t, rhs));
    const visitAssignments = (container) => {
      for (const s of namedChildren(t, container)) {
        if (t.type[s] !== "expression_statement") continue;
        const e = namedChildren(t, s)[0];
        if (e !== void 0 && t.type[e] === "call_expression" && /^Object(\\.a|A)ssign$/.test(textOf(t, child(t, e, "function")))) {
          const args2 = namedChildren(t, child(t, e, "arguments"));
          const target = args2[0] !== void 0 ? unwrap(t, args2[0]) : -1;
          if (target < 0 || t.type[target] !== "identifier") continue;
          for (const a of args2.slice(1)) {
            const obj2 = unwrap(t, a);
            if (t.type[obj2] !== "object") continue;
            for (const p of namedChildren(t, obj2)) {
              if (t.type[p] === "shorthand_property_identifier") f2.assignments.push({ owner: textOf(t, target), proto: false, name: textOf(t, p), node: s, nameStart: t.start[p], value: p });
              else if (t.type[p] === "pair" && t.type[child(t, p, "key")] !== "computed_property_name") {
                const k2 = child(t, p, "key");
                f2.assignments.push({ owner: textOf(t, target), proto: false, name: propName(t, k2), node: s, nameStart: t.start[k2], value: child(t, p, "value") });
              }
            }
          }
          continue;
        }
        if (e === void 0 || t.type[e] !== "assignment_expression") continue;
        const lhs = child(t, e, "left");
        const rhs = child(t, e, "right");
        if (t.type[lhs] !== "member_expression") continue;
        const prop = child(t, lhs, "property");
        const name2 = propName(t, prop);
        const obj = unwrap(t, child(t, lhs, "object"));
        if (t.type[obj] === "identifier") {
          const on2 = textOf(t, obj);
          if (name2 === "prototype") {
            const o = objectOf(t, rhs);
            if (o >= 0) f2.assignments.push({ owner: on2, proto: true, name: "*", node: s, nameStart: t.start[prop], value: o });
            continue;
          }
          const alias = f2.protoAliases.get(on2);
          if (alias) f2.assignments.push({ owner: alias, proto: true, name: name2, node: s, nameStart: t.start[prop], value: rhs, unit: unitAt(s, rhs) });
          else f2.assignments.push({ owner: on2, proto: false, name: name2, node: s, nameStart: t.start[prop], value: rhs, unit: unitAt(s, rhs) });
        } else if (t.type[obj] === "member_expression" && propName(t, child(t, obj, "property")) === "prototype") {
          const o = unwrap(t, child(t, obj, "object"));
          if (t.type[o] === "identifier") f2.assignments.push({ owner: textOf(t, o), proto: true, name: name2, node: s, nameStart: t.start[prop], value: rhs, unit: unitAt(s, rhs) });
        }
      }
    };
    visitAssignments(0);
    for (const u of units) {
      if (u.parent || u.kind !== "function") continue;
      const fnNode = u.valueNode;
      if (fnNode < 0) continue;
      const shape = { id: shapeId(fnNode), path: f2.path, name: u.name, kind: "function", node: fnNode, members: [], heritage: [], unit: u, open: false };
      const body2 = child(t, fnNode, "body");
      if (body2 >= 0) collectThisAssignments(t, body2, shape, true);
      f2.shapes.set(fnNode, shape);
    }
  };
  var addTypeMembers = (t, body2, shape) => {
    for (const m2 of namedChildren(t, body2)) {
      const mt = t.type[m2];
      if (mt === "property_signature" || mt === "method_signature") {
        const nm = child(t, m2, "name");
        const typ = child(t, m2, "type");
        shape.members.push({ name: propName(t, nm), static: false, kind: mt === "method_signature" ? "signature" : "field", node: m2, nameStart: t.start[nm], value: -1, typeNode: typ >= 0 ? namedChildren(t, typ)[0] ?? -1 : -1 });
      } else if (mt === "index_signature") shape.open = true;
    }
  };
  var CONDITIONAL = /* @__PURE__ */ new Set(["if_statement", "else_clause", "ternary_expression", "switch_case", "switch_default", "catch_clause", "for_statement", "for_in_statement", "while_statement", "do_statement"]);
  var collectThisAssignments = (t, root, shape, isFunction) => {
    const stack = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      const ty = t.type[n];
      if (n !== root && (ty === "function_expression" || ty === "function_declaration" || ty === "generator_function" || ty === "generator_function_declaration" || ty === "class" || ty === "class_declaration" || ty === "function")) continue;
      if (isFunction && n !== root && ty === "method_definition") continue;
      if (ty === "assignment_expression") {
        const lhs = child(t, n, "left");
        if (t.type[lhs] === "member_expression" && t.type[child(t, lhs, "object")] === "this") {
          const prop = child(t, lhs, "property");
          const name2 = propName(t, prop);
          let isStatic = false;
          let conditional = false;
          for (let a = t.parent[n]; a >= 0 && a !== root; a = t.parent[a]) {
            const at2 = t.type[a];
            if (at2 === "method_definition") {
              isStatic = hasToken(t, a, "static");
              break;
            }
            if (CONDITIONAL.has(at2) || at2 === "binary_expression" && /^(&&|\\|\\||\\?\\?)$/.test(tokensOf(t, a)[0] ?? "")) conditional = true;
          }
          if (!shape.members.some((m2) => m2.name === name2 && m2.kind === "this" && m2.value === child(t, n, "right"))) shape.members.push({ name: name2, static: isStatic, kind: "this", node: n, nameStart: t.start[prop], value: child(t, n, "right"), typeNode: -1, ...conditional ? { conditional } : {} });
        }
      }
      for (let c = t.first[n]; c >= 0; c = t.next[c]) stack.push(c);
    }
  };
  var parseFacts = (syntax, path, text) => {
    const flat = syntax.parse(path, text);
    return flat ? analyzeFile(path, flat) : null;
  };

  // src/lib/fp.ts
  var clamp = (x2, lo, hi) => Math.min(hi, Math.max(lo, x2));
  var uniqBy = (xs, key) => {
    const seen = /* @__PURE__ */ new Set();
    return xs.filter((x2) => !seen.has(key(x2)) && Boolean(seen.add(key(x2))));
  };
  var sortBy = (xs, ...keys) => [...xs].sort((a, b2) => {
    for (const key of keys) {
      const ka = key(a);
      const kb = key(b2);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
    }
    return 0;
  });
  var limiter = (size) => {
    let running = 0;
    const waiting = [];
    return async (job) => {
      if (running >= size) await new Promise((resolve) => waiting.push(resolve));
      running++;
      try {
        return await job();
      } finally {
        running--;
        waiting.shift()?.();
      }
    };
  };
  var count = (n) => n.toLocaleString("en-US");
  var plural = (n, one, many = \`\${one}s\`) => \`\${count(n)} \${n === 1 ? one : many}\`;

  // src/lib/guard.ts
  var string = (v2) => typeof v2 === "string";
  var number = (v2) => typeof v2 === "number" && Number.isFinite(v2);
  var boolean = (v2) => typeof v2 === "boolean";
  var oneOf = (values) => (v2) => typeof v2 === "string" && values.includes(v2);
  var nullable = (guard) => (v2) => v2 === null || guard(v2);
  var optional = (guard) => (v2) => v2 === void 0 || guard(v2);
  var object = (shape) => (v2) => typeof v2 === "object" && v2 !== null && Object.entries(shape).every(
    ([key, guard]) => guard(v2[key])
  );
  var parse = (guard, value) => guard(value) ? value : null;

  // src/lib/github.ts
  var API = "https://api.github.com";
  var RAW = "https://raw.githubusercontent.com";
  var MAX_FILES = 3e3;
  var PAGE = 100;
  var PAGES_AT_ONCE = 4;
  var pageCount = (changedFiles) => Math.max(1, Math.ceil(Math.min(changedFiles, MAX_FILES) / PAGE));
  var fail = (failure, message) => {
    throw new Error(message, { cause: failure });
  };
  var userShape = object({ login: string });
  var repoShape = nullable(object({ full_name: string }));
  var pullShape = object({
    number,
    html_url: string,
    title: string,
    body: nullable(string),
    state: oneOf(["open", "closed"]),
    draft: optional(boolean),
    merged: optional(boolean),
    merged_at: optional(nullable(string)),
    user: nullable(userShape),
    base: object({ repo: repoShape }),
    head: object({ sha: string, repo: repoShape }),
    additions: number,
    deletions: number,
    changed_files: number
  });
  var fileShape = object({
    filename: string,
    previous_filename: optional(string),
    status: oneOf(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
    additions: number,
    deletions: number,
    patch: optional(string)
  });
  var createGithub = (fetch2) => {
    const getJson = async (url) => {
      let res;
      try {
        res = await fetch2(url, { headers: { Accept: "application/vnd.github+json" } });
      } catch {
        return fail({ kind: "network" }, \`GET \${url} failed\`);
      }
      const left = res.headers.get("x-ratelimit-remaining");
      if (res.status === 404) return fail({ kind: "not-found" }, \`GET \${url}: 404\`);
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const limited = res.status === 429 || left === "0" || res.headers.has("retry-after");
        if (limited) {
          return fail({ kind: "rate-limited", resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1e3 : null }, \`GET \${url}: rate limited\`);
        }
      }
      if (!res.ok) return fail({ kind: "http", status: res.status }, \`GET \${url}: \${res.status}\`);
      return res.json();
    };
    const repoPath = (ref) => \`\${API}/repos/\${ref.owner}/\${ref.repo}/pulls/\${ref.number}\`;
    const pr = async (ref) => {
      const raw2 = await getJson(repoPath(ref));
      const p = parse(pullShape, raw2);
      if (!p) return fail({ kind: "http", status: 200 }, "GitHub returned a pull request PR Blackboard can't read");
      const state = p.merged || p.merged_at ? "merged" : p.state === "closed" ? "closed" : p.draft ? "draft" : "open";
      return {
        ref,
        url: p.html_url,
        title: p.title,
        body: p.body ?? "",
        author: p.user?.login ?? "ghost",
        state,
        headSha: p.head.sha,
        headRepo: p.head.repo?.full_name ?? p.base.repo?.full_name ?? \`\${ref.owner}/\${ref.repo}\`,
        additions: p.additions,
        deletions: p.deletions,
        changedFiles: p.changed_files
      };
    };
    const page = async (ref, n) => {
      const raw2 = await getJson(\`\${repoPath(ref)}/files?per_page=\${PAGE}&page=\${n}\`);
      return (Array.isArray(raw2) ? raw2 : []).flatMap((item) => {
        const f2 = parse(fileShape, item);
        if (!f2) return [];
        return [
          {
            path: f2.filename,
            ...f2.previous_filename ? { previousPath: f2.previous_filename } : {},
            status: f2.status,
            additions: f2.additions,
            deletions: f2.deletions,
            ...f2.patch !== void 0 ? { patch: f2.patch } : {}
          }
        ];
      });
    };
    const files = async (ref, count2) => {
      const slot = limiter(PAGES_AT_ONCE);
      let failure = null;
      const pageOf = (n) => slot(async () => {
        if (failure) throw failure;
        return page(ref, n).catch((err2) => {
          failure ?? (failure = err2);
          throw err2;
        });
      });
      const pages = await Promise.all(Array.from({ length: pageCount(count2) }, (_2, i2) => pageOf(i2 + 1)));
      return pages.flat();
    };
    const raw = async (repo, sha, path) => {
      const url = \`\${RAW}/\${repo}/\${sha}/\${path.split("/").map(encodeURIComponent).join("/")}\`;
      try {
        const res = await fetch2(url);
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    };
    return { pr, files, raw };
  };

  // src/lib/diff.ts
  var HEADER = /^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@/;
  var parsePatch = (patch) => {
    const raw = [];
    let current = null;
    let o = 0;
    let n = 0;
    for (const line of patch.split("\\n")) {
      const header = HEADER.exec(line);
      if (header) {
        o = Number(header[1]);
        n = Number(header[2]);
        current = { oldStart: o, newStart: n, lines: [] };
        raw.push(current);
        continue;
      }
      if (!current || line.startsWith("\\\\")) continue;
      const text = line.slice(1);
      if (line.startsWith("-")) current.lines.push({ t: "del", o: o++, text });
      else if (line.startsWith("+")) current.lines.push({ t: "add", n: n++, text });
      else current.lines.push({ t: "ctx", o: o++, n: n++, text });
    }
    return raw.map((h) => {
      const heads = h.lines.filter((l3) => l3.n !== void 0);
      const bases = h.lines.filter((l3) => l3.o !== void 0);
      const newEnd = heads.length > 0 ? heads[heads.length - 1].n : h.newStart - 1;
      const oldEnd = bases.length > 0 ? bases[bases.length - 1].o : h.oldStart - 1;
      let next = newEnd + 1;
      const lines = [];
      for (let i2 = h.lines.length - 1; i2 >= 0; i2--) {
        const l3 = h.lines[i2];
        if (l3.n !== void 0) next = l3.n;
        lines.push({ ...l3, at: l3.n ?? next });
      }
      return { oldStart: h.oldStart, newStart: h.newStart, newEnd, oldEnd, lines: lines.reverse() };
    });
  };
  var addedHunks = (text) => {
    const lines = text.split("\\n");
    if (lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 0) return [];
    return [{ oldStart: 0, newStart: 1, newEnd: lines.length, oldEnd: -1, lines: lines.map((line, i2) => ({ t: "add", n: i2 + 1, text: line, at: i2 + 1 })) }];
  };
  var allLines = (hunks) => hunks.flatMap((h) => h.lines);

  // src/lib/graph.ts
  var layers = (ids, edges) => {
    const out2 = new Map(ids.map((id) => [id, []]));
    for (const [a, b2] of edges) if (out2.has(a) && out2.has(b2) && a !== b2) out2.get(a).push(b2);
    const state = /* @__PURE__ */ new Map();
    const kept = [];
    const visit = (id) => {
      state.set(id, "open");
      for (const next of out2.get(id)) {
        const s = state.get(next);
        if (s === "open") continue;
        kept.push([id, next]);
        if (!s) visit(next);
      }
      state.set(id, "done");
    };
    for (const id of ids) if (!state.has(id)) visit(id);
    const layer = new Map(ids.map((id) => [id, 0]));
    const waiting = new Map(ids.map((id) => [id, 0]));
    const after = new Map(ids.map((id) => [id, []]));
    for (const [a, b2] of kept) {
      waiting.set(b2, waiting.get(b2) + 1);
      after.get(a).push(b2);
    }
    const ready = [...waiting].filter(([, n]) => n === 0).map(([id]) => id);
    for (let i2 = 0; i2 < ready.length; i2++) {
      const a = ready[i2];
      for (const b2 of after.get(a)) {
        layer.set(b2, Math.max(layer.get(b2), layer.get(a) + 1));
        waiting.set(b2, waiting.get(b2) - 1);
        if (waiting.get(b2) === 0) ready.push(b2);
      }
    }
    return layer;
  };

  // src/lib/highlight.ts
  var words = (s) => new Set(s.split(" "));
  var C_LIKE = "if else for while do switch case break continue default return new delete throw try catch finally class extends this super static public private protected const let var void null true false import export from as typeof instanceof in of async await yield function interface enum type implements package";
  var KEYWORDS = {
    ts: words(\`\${C_LIKE} readonly declare namespace module keyof infer never unknown any satisfies abstract override get set undefined\`),
    js: words(\`\${C_LIKE} undefined get set\`),
    py: words("def class return if elif else for while in not and or is None True False import from as with try except finally raise yield lambda pass break continue global nonlocal async await assert del self"),
    go: words("func package import return if else for range switch case default break continue go defer select chan map struct interface type var const nil true false fallthrough goto"),
    rs: words("fn let mut pub crate mod use impl trait struct enum match if else for while loop return break continue self Self super where as in ref move async await dyn const static unsafe true false Some None Ok Err"),
    java: words(\`\${C_LIKE} final abstract synchronized throws boolean int long double float char byte short\`),
    kt: words("fun val var class object interface if else when for while do return break continue try catch finally throw import package as is in out null true false this super override open data sealed suspend companion private public internal protected"),
    swift: words("func let var class struct enum protocol extension if else guard for while repeat return break continue switch case default import self Self nil true false init deinit throws throw try catch async await public private internal fileprivate static"),
    rb: words("def class module end if elsif else unless while until for in do return yield begin rescue ensure raise nil true false self super require require_relative attr_reader attr_accessor"),
    php: words(\`\${C_LIKE} function echo namespace use fn match array\`),
    cs: words(\`\${C_LIKE} using namespace readonly override virtual sealed partial string int bool var get set async await\`),
    c: words("if else for while do switch case break continue default return struct union enum typedef static const void int char long short unsigned signed float double sizeof include define NULL true false class public private protected template typename namespace using virtual auto"),
    sh: words("if then else elif fi for while do done case esac function return local export in"),
    sql: words("select from where and or not insert into values update set delete create table alter drop index join left right inner outer on group by order having limit as null is distinct union")
  };
  var LINE_COMMENT = {
    ts: "//",
    js: "//",
    go: "//",
    rs: "//",
    java: "//",
    kt: "//",
    swift: "//",
    php: "//",
    cs: "//",
    c: "//",
    py: "#",
    rb: "#",
    sh: "#",
    yaml: "#",
    toml: "#",
    sql: "--"
  };
  var BLOCK_COMMENTS = /* @__PURE__ */ new Set(["ts", "js", "go", "rs", "java", "kt", "swift", "php", "cs", "c", "css"]);
  var escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var span = (cls, text) => \`<span class="\${cls}">\${escapeHtml(text)}</span>\`;
  var highlightLine = (text, lang, state) => {
    const keywords = KEYWORDS[lang];
    const lineComment = LINE_COMMENT[lang];
    const blocks = BLOCK_COMMENTS.has(lang);
    if (lang === "md" || lang === "text") return escapeHtml(text);
    let out2 = "";
    let i2 = 0;
    while (i2 < text.length) {
      if (state.inBlock) {
        const end = text.indexOf("*/", i2);
        const stop2 = end < 0 ? text.length : end + 2;
        out2 += span("c", text.slice(i2, stop2));
        i2 = stop2;
        if (end >= 0) state.inBlock = false;
        continue;
      }
      const rest = text.slice(i2);
      if (blocks && rest.startsWith("/*")) {
        state.inBlock = true;
        out2 += span("c", "/*");
        i2 += 2;
        continue;
      }
      if (lineComment && rest.startsWith(lineComment)) {
        out2 += span("c", rest);
        break;
      }
      if (blocks && i2 === 0 && /^\\s*\\*(\\s|\\/|$)/.test(text)) {
        out2 += span("c", text);
        break;
      }
      const ch = text[i2];
      if (ch === '"' || ch === "'" || ch === "\`") {
        let j2 = i2 + 1;
        while (j2 < text.length && text[j2] !== ch) j2 += text[j2] === "\\\\" ? 2 : 1;
        out2 += span("s", text.slice(i2, j2 + 1));
        i2 = j2 + 1;
        continue;
      }
      const num = /^\\d[\\d_]*(\\.\\d+)?([eE][+-]?\\d+)?[a-zA-Z]*/.exec(rest);
      if (num && !/[\\w$]/.test(text[i2 - 1] ?? "")) {
        out2 += span("n", num[0]);
        i2 += num[0].length;
        continue;
      }
      const ident = /^[#@]?[A-Za-z_$][\\w$]*/.exec(rest);
      if (ident) {
        const word = ident[0];
        const after = text.slice(i2 + word.length).trimStart();
        if (keywords?.has(word)) out2 += span("k", word);
        else if (after.startsWith("(") || after.startsWith("<") && /^<[\\w\\s,.]*>\\s*\\(/.test(after)) out2 += span("f", word);
        else if (/^[A-Z][a-z0-9]/.test(word) && lang !== "sql") out2 += span("t", word);
        else out2 += escapeHtml(word);
        i2 += word.length;
        continue;
      }
      out2 += escapeHtml(ch);
      i2 += 1;
    }
    return out2;
  };

  // src/vendor/marked.ts
  function C2() {
    return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
  }
  var R = C2();
  function j(l3) {
    R = l3;
  }
  var z = { exec: () => null };
  function A(l3) {
    let e = [];
    return (t) => {
      let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
      return s || (s = l3(n), e[n] = s), s;
    };
  }
  function k(l3, e = "") {
    let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (s, r) => {
      let i2 = typeof r == "string" ? r : r.source;
      return i2 = i2.replace(m.caret, "$1"), t = t.replace(s, i2), n;
    }, getRegex: () => new RegExp(t, e) };
    return n;
  }
  var Te = ((l3 = "") => {
    try {
      return !!new RegExp("(?<=1)(?<!1)" + l3);
    } catch {
      return false;
    }
  })();
  var m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\\t)/gm, outputLinkReplace: /\\\\([\\[\\]])/g, indentCodeCompensation: /^(\\s+)(?:\`\`\`)/, beginningSpace: /^\\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\\n/g, tabCharGlobal: /\\t/g, multipleSpaceGlobal: /\\s+/g, blankLine: /^[ \\t]*$/, doubleBlankLine: /\\n[ \\t]*\\n[ \\t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\\n {0,3}((?:=+|-+) *)(?=\\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \\t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\\[[ xX]\\] +\\S/, listReplaceTask: /^\\[[ xX]\\] +/, listTaskCheckbox: /\\[[ xX]\\]/, anyLine: /\\n.*\\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\\||\\| *$/g, tableRowBlankLine: /\\n[ \\t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\\s|>)/i, endPreScriptTag: /^<\\/(pre|code|kbd|script)(\\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\\s])\\s+(['"])(.*)\\2/, unicodeAlphaNumeric: /[\\p{L}\\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\\w+);)/g, caret: /(^|[^\\[])\\^/g, percentDecode: /%25/g, findPipe: /\\|/g, splitPipe: / \\|/, slashPipe: /\\\\\\|/g, carriageReturn: /\\r\\n|\\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\\S*/, endingNewline: /\\n$/, listItemRegex: (l3) => new RegExp(\`^( {0,3}\${l3})((?:[	 ][^\\\\n]*)?(?:\\\\n|$))\`), nextBulletRegex: A((l3) => new RegExp(\`^ {0,\${l3}}(?:[*+-]|\\\\d{1,9}[.)])((?:[ 	][^\\\\n]*)?(?:\\\\n|$))\`)), hrRegex: A((l3) => new RegExp(\`^ {0,\${l3}}((?:- *){3,}|(?:_ *){3,}|(?:\\\\* *){3,})(?:\\\\n+|$)\`)), fencesBeginRegex: A((l3) => new RegExp(\`^ {0,\${l3}}(?:\\\`\\\`\\\`|~~~)\`)), headingBeginRegex: A((l3) => new RegExp(\`^ {0,\${l3}}#\`)), htmlBeginRegex: A((l3) => new RegExp(\`^ {0,\${l3}}<(?:[a-z].*>|!--)\`, "i")), blockquoteBeginRegex: A((l3) => new RegExp(\`^ {0,\${l3}}>\`)) };
  var Oe = /^(?:[ \\t]*(?:\\n|$))+/;
  var we = /^((?: {4}| {0,3}\\t)[^\\n]+(?:\\n(?:[ \\t]*(?:\\n|$))*)?)+/;
  var ye = /^ {0,3}(\`{3,}(?=[^\`\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}\\1[~\`]* *(?=\\n|$)|$)/;
  var q = /^ {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)/;
  var Pe = /^ {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)/;
  var U = / {0,3}(?:[*+-]|\\d{1,9}[.)])/;
  var oe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\\n(?!\\s*?\\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/;
  var ae = k(oe).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\\t)/).replace(/fences/g, / {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\\s|$)/).replace(/html/g, / {0,3}<[^\\n>]+>\\n/).replace(/\\|table/g, "").getRegex();
  var Se = k(oe).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\\t)/).replace(/fences/g, / {0,3}(?:\`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\\s|$)/).replace(/html/g, / {0,3}<[^\\n>]+>\\n/).replace(/table/g, / {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n/).getRegex();
  var K = /^([^\\n]+(?:\\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \\t]+\\n)[^\\n]+)*)/;
  var _e = /^[^\\n]+/;
  var W = /(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\])+/;
  var $e = k(/^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)/).replace("label", W).replace("title", /(?:"(?:\\\\"?|[^"\\\\])*"|'[^'\\n]*(?:\\n[^'\\n]+)*\\n?'|\\([^()]*\\))/).getRegex();
  var Le = k(/^(bull)([ \\t][^\\n]*?)?(?:\\n|$)/).replace(/bull/g, U).getRegex();
  var Q = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
  var X = /<!--(?:-?>|[\\s\\S]*?(?:-->|$))/;
  var Me = k("^ {0,3}(?:<(script|pre|style|textarea)[\\\\s>][\\\\s\\\\S]*?(?:</\\\\1>[^\\\\n]*\\\\n*|$)|comment[^\\\\n]*(\\\\n+|$)|<\\\\?[\\\\s\\\\S]*?(?:\\\\?>[^\\\\n]*\\\\n*|$)|<![A-Z][\\\\s\\\\S]*?(?:>[^\\\\n]*\\\\n*|$)|<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?(?:\\\\]\\\\]>[^\\\\n]*\\\\n*|$)|</?(tag)(?: +|\\\\n|/?>)[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|<(?!script|pre|style|textarea)([a-z][\\\\w-]*)(?:attribute)*? */?>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$)|</(?!script|pre|style|textarea)[a-z][\\\\w-]*\\\\s*>(?=[ \\\\t]*(?:\\\\n|$))[\\\\s\\\\S]*?(?:(?:\\\\n[ 	]*)+\\\\n|$))", "i").replace("comment", X).replace("tag", Q).replace("attribute", / +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *'[^'\\n]*'| *= *[^\\s"'=<>\`]+)?/).getRegex();
  var le = (l3) => k(K).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~~~)[^\\\\n]*\\\\n").replace("list", l3).replace("html", "</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
  var ze = le(/ {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]/);
  var Ee = le(/ {0,3}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|\\n|$)/);
  var Ce = k(/^( {0,3}> ?(paragraph|[^\\n]*)(?:\\n|$))+/).replace("paragraph", Ee).getRegex();
  var J = { blockquote: Ce, code: we, def: $e, fences: ye, heading: Pe, hr: q, html: Me, lheading: ae, list: Le, newline: Oe, paragraph: ze, table: z, text: _e };
  var se = k("^ *([^\\\\n ].*)\\\\n {0,3}((?:\\\\| *)?:?-+:? *(?:\\\\| *:?-+:? *)*(?:\\\\| *)?)(?:\\\\n((?:(?! *\\\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\\\n|$))*)\\\\n*|$)").replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\\\n]").replace("fences", " {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~~~)[^\\\\n]*\\\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\\\t]").replace("html", "</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
  var Ae = { ...J, lheading: Se, table: se, paragraph: k(K).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\\\s|$)").replace("|lheading", "").replace("table", se).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:\`{3,}(?=[^\`\\\\n]*\\\\n)|~~~)[^\\\\n]*\\\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\\\t]+[^ \\\\t\\\\n]").replace("html", "</?(?:tag)(?: +|\\\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex() };
  var Ie = { ...J, html: k(\`^ *(?:comment *(?:\\\\n|\\\\s*$)|<(tag)[\\\\s\\\\S]+?</\\\\1> *(?:\\\\n{2,}|\\\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\\\s[^'"/>\\\\s]*)*?/?> *(?:\\\\n{2,}|\\\\s*$))\`).replace("comment", X).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\\\b)\\\\w+(?!:|[^\\\\w\\\\s@]*@)\\\\b").getRegex(), def: /^ *\\[([^\\]]+)\\]: *<?([^\\s>]+)>?(?: +(["(][^\\n]+[")]))? *(?:\\n+|$)/, heading: /^(#{1,6})(.*)(?:\\n+|$)/, fences: z, lheading: /^(.+?)\\n {0,3}(=+|-+) *(?:\\n+|$)/, paragraph: k(K).replace("hr", q).replace("heading", \` *#{1,6} *[^
]\`).replace("lheading", ae).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
  var Be = /^\\\\([!"#$%&'()*+,\\-./:;<=>?@\\[\\]\\\\^_\`{|}~])/;
  var De = /^(\`+)([^\`]|[^\`][\\s\\S]*?[^\`])\\1(?!\`)/;
  var pe = /^( {2,}|\\\\)\\n(?!\\s*$)/;
  var qe = /^(\`+|[^\`])(?:(?= {2,}\\n)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*_]|\\b_|$)|[^ ](?= {2,}\\n)))/;
  var _ = /[\\p{P}\\p{S}]/u;
  var I = /[\\s\\p{P}\\p{S}]/u;
  var v = /[^\\s\\p{P}\\p{S}]/u;
  var ve = k(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, I).getRegex();
  var He = /[\\p{Pi}\\p{Ps}"']/u;
  var ue = /(?!~)[\\p{P}\\p{S}]/u;
  var Ze = /(?!~)[\\s\\p{P}\\p{S}]/u;
  var Ge = /(?:[^\\s\\p{P}\\p{S}]|~)/u;
  var Qe = k(/link|precode-code|html/, "g").replace("link", /\\[(?:[^\\[\\]\`]|(?<a>\`+)[^\`]+\\k<a>(?!\`))*?\\]\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)]|\\((?:\\\\[\\s\\S]|[^\\\\\\(\\)])*\\))*\\)/).replace("precode-", Te ? "(?<!\`)()" : "(^^|[^\`])").replace("code", /(?<b>\`+)[^\`]+\\k<b>(?!\`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
  var ce = /^(?:\\*+(?:((?!\\*)punct)|([^\\s*]))?)|^_+(?:((?!_)punct)|([^\\s_]))?/;
  var Ne = k(ce, "u").replace(/punct/g, _).getRegex();
  var je = k(ce, "u").replace(/punct/g, ue).getRegex();
  var Fe = /^(?:\\*+(?:((?!\\*)(?!openQuote)punct)|([^\\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\\s_]))?/;
  var Ue = k(Fe, "u").replace(/openQuote/g, He).replace(/punct/g, _).getRegex();
  var he = "^[^_*]*?__[^_*]*?\\\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\\\*)punct(\\\\*+)(?=[\\\\s]|$)|notPunctSpace(\\\\*+)(?!\\\\*)(?=punctSpace|$)|(?!\\\\*)punctSpace(\\\\*+)(?=notPunctSpace)|[\\\\s](\\\\*+)(?!\\\\*)(?=punct)|(?!\\\\*)punct(\\\\*+)(?!\\\\*)(?=punct)|notPunctSpace(\\\\*+)(?=notPunctSpace)";
  var Ke = k(he, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
  var We = k(he, "gu").replace(/notPunctSpace/g, Ge).replace(/punctSpace/g, Ze).replace(/punct/g, ue).getRegex();
  var Xe = "^[^_*]*?__[^_*]*?\\\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\\\*)punct(\\\\*+)(?=[\\\\s]|$)|notPunctSpace(\\\\*+)(?!\\\\*)(?=punctSpace|$)|(?!\\\\*)[\\\\s](\\\\*+)(?=notPunctSpace)|[\\\\s](\\\\*+)(?!\\\\*)(?=punct)|(?!\\\\*)punct(\\\\*+)(?!\\\\*)(?=punct)|(?:(?!\\\\*)punct|notPunctSpace)(\\\\*+)(?!\\\\*)(?=notPunctSpace)";
  var Je = k(Xe, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
  var Ve = k("^[^_*]*?\\\\*\\\\*[^_*]*?_[^_*]*?(?=\\\\*\\\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
  var Ye = "^[^_*]*?\\\\*\\\\*[^_*]*?_[^_*]*?(?=\\\\*\\\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\\\s](_+)(?=notPunctSpace)|[\\\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
  var et = k(Ye, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
  var tt = k(/^~~?(?:((?!~)punct)|[^\\s~])/, "u").replace(/punct/g, _).getRegex();
  var nt = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
  var rt = k(nt, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
  var st = k(/\\\\(punct)/, "gu").replace(/punct/g, _).getRegex();
  var it = k(/^<(scheme:[^\\s\\x00-\\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
  var ot = k(X).replace("(?:-->|$)", "-->").getRegex();
  var at = k("^comment|^</[a-zA-Z][\\\\w:-]*\\\\s*>|^<[a-zA-Z][\\\\w-]*(?:attribute)*?\\\\s*/?>|^<\\\\?[\\\\s\\\\S]*?\\\\?>|^<![a-zA-Z]+\\\\s[\\\\s\\\\S]*?>|^<!\\\\[CDATA\\\\[[\\\\s\\\\S]*?\\\\]\\\\]>").replace("comment", ot).replace("attribute", /\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*'[^']*'|\\s*=\\s*[^\\s"'=<>\`]+)?/).getRegex();
  var G = /(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|\`+(?!\`)[^\`]*?\`+(?!\`)|\`\`+(?=\\])|[^\\[\\]\\\\\`])*?/;
  var lt = k(/^!?\\[(label)\\]\\(\\s*(href)(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)(title))?\\s*\\)/).replace("label", G).replace("href", /<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]+|(?=\\))/).replace("title", /"(?:\\\\"?|[^"\\\\])*"|'(?:\\\\'?|[^'\\\\])*'|\\((?:\\\\\\)?|[^)\\\\])*\\)/).getRegex();
  var de = k(/^!?\\[(label)\\]\\[(ref)\\]/).replace("label", G).replace("ref", W).getRegex();
  var ke = k(/^!?\\[(ref)\\](?:\\[\\])?/).replace("ref", W).getRegex();
  var pt = k("reflink|nolink(?!\\\\()", "g").replace("reflink", de).replace("nolink", ke).getRegex();
  var ie = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
  var V = { _backpedal: z, anyPunctuation: st, autolink: it, blockSkip: Qe, br: pe, code: De, del: z, delLDelim: z, delRDelim: z, emStrongLDelim: Ne, emStrongRDelimAst: Ke, emStrongRDelimUnd: Ve, escape: Be, link: lt, nolink: ke, punctuation: ve, reflink: de, reflinkSearch: pt, tag: at, text: qe, url: z };
  var ut = { ...V, emStrongLDelim: Ue, emStrongRDelimAst: Je, emStrongRDelimUnd: et, link: k(/^!?\\[(label)\\]\\((.*?)\\)/).replace("label", G).getRegex(), reflink: k(/^!?\\[(label)\\]\\s*\\[([^\\]]*)\\]/).replace("label", G).getRegex() };
  var F = { ...V, emStrongRDelimAst: We, emStrongLDelim: je, delLDelim: tt, delRDelim: rt, url: k(/^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email/).replace("protocol", ie).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\\([^)]*\\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)/, text: k(/^(\`+|~+|[^\`~])(?:(?=[\`~])|(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[\`*~_]|\\b_|protocol:\\/\\/|www\\.|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-](?=[a-zA-Z0-9.!#$%&'*+\\/=?_\`{\\|}~-]+@)))/).replace("protocol", ie).getRegex() };
  var ct = { ...F, br: k(pe).replace("{2,}", "*").getRegex(), text: k(F.text).replace("\\\\b_", "\\\\b_| {2,}\\\\n").replace(/\\{2,\\}/g, "*").getRegex() };
  var H = { normal: J, gfm: Ae, pedantic: Ie };
  var B = { normal: V, gfm: F, breaks: ct, pedantic: ut };
  var ht = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var ge = (l3) => ht[l3];
  function O(l3, e) {
    if (e) {
      if (m.escapeTest.test(l3)) return l3.replace(m.escapeReplace, ge);
    } else if (m.escapeTestNoEncode.test(l3)) return l3.replace(m.escapeReplaceNoEncode, ge);
    return l3;
  }
  function Y(l3) {
    try {
      l3 = encodeURI(l3).replace(m.percentDecode, "%");
    } catch {
      return null;
    }
    return l3;
  }
  function ee(l3, e) {
    let t = l3.replace(m.findPipe, (r, i2, o) => {
      let p = false, a = i2;
      for (; --a >= 0 && o[a] === "\\\\"; ) p = !p;
      return p ? "|" : " |";
    }), n = t.split(m.splitPipe), s = 0;
    if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
    else for (; n.length < e; ) n.push("");
    for (; s < n.length; s++) n[s] = n[s].trim().replace(m.slashPipe, "|");
    return n;
  }
  function $(l3, e, t) {
    let n = l3.length;
    if (n === 0) return "";
    let s = 0;
    for (; s < n; ) {
      let r = l3.charAt(n - s - 1);
      if (r === e && !t) s++;
      else if (r !== e && t) s++;
      else break;
    }
    return l3.slice(0, n - s);
  }
  function te(l3) {
    let e = l3.split(\`
\`), t = e.length - 1;
    for (; t >= 0 && m.blankLine.test(e[t]); ) t--;
    return e.length - t <= 2 ? l3 : e.slice(0, t + 1).join(\`
\`);
  }
  function fe(l3, e) {
    if (l3.indexOf(e[1]) === -1) return -1;
    let t = 0;
    for (let n = 0; n < l3.length; n++) if (l3[n] === "\\\\") n++;
    else if (l3[n] === e[0]) t++;
    else if (l3[n] === e[1] && (t--, t < 0)) return n;
    return t > 0 ? -2 : -1;
  }
  function me(l3, e = 0) {
    let t = e, n = "";
    for (let s of l3) if (s === "	") {
      let r = 4 - t % 4;
      n += " ".repeat(r), t += r;
    } else n += s, t++;
    return n;
  }
  function xe(l3, e, t, n, s) {
    let r = e.href, i2 = e.title || null, o = l3[1].replace(s.other.outputLinkReplace, "$1");
    n.state.inLink = true;
    let p = { type: l3[0].charAt(0) === "!" ? "image" : "link", raw: t, href: r, title: i2, text: o, tokens: n.inlineTokens(o) };
    return n.state.inLink = false, p;
  }
  function dt(l3, e, t) {
    let n = l3.match(t.other.indentCodeCompensation);
    if (n === null) return e;
    let s = n[1];
    return e.split(\`
\`).map((r) => {
      let i2 = r.match(t.other.beginningSpace);
      if (i2 === null) return r;
      let [o] = i2;
      return o.length >= s.length ? r.slice(s.length) : r;
    }).join(\`
\`);
  }
  var y = class {
    constructor(e) {
      __publicField(this, "options");
      __publicField(this, "rules");
      __publicField(this, "lexer");
      this.options = e || R;
    }
    space(e) {
      let t = this.rules.block.newline.exec(e);
      if (t && t[0].length > 0) return { type: "space", raw: t[0] };
    }
    code(e) {
      let t = this.rules.block.code.exec(e);
      if (t) {
        let n = this.options.pedantic ? t[0] : te(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
        return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
      }
    }
    fences(e) {
      let t = this.rules.block.fences.exec(e);
      if (t) {
        let n = t[0], s = dt(n, t[3] || "", this.rules);
        return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
      }
    }
    heading(e) {
      let t = this.rules.block.heading.exec(e);
      if (t) {
        let n = t[2].trim();
        if (this.rules.other.endingHash.test(n)) {
          let s = $(n, "#");
          (this.options.pedantic || !s || this.rules.other.endingSpaceChar.test(s)) && (n = s.trim());
        }
        return { type: "heading", raw: $(t[0], \`
\`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
      }
    }
    hr(e) {
      let t = this.rules.block.hr.exec(e);
      if (t) return { type: "hr", raw: $(t[0], \`
\`) };
    }
    blockquote(e) {
      let t = this.rules.block.blockquote.exec(e);
      if (t) {
        let n = $(t[0], \`
\`).split(\`
\`), s = "", r = "", i2 = [];
        for (; n.length > 0; ) {
          let o = false, p = [], a;
          for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) p.push(n[a]), o = true;
          else if (!o) p.push(n[a]);
          else break;
          n = n.slice(a);
          let u = p.join(\`
\`), c = u.replace(this.rules.other.blockquoteSetextReplace, \`
    $1\`).replace(this.rules.other.blockquoteSetextReplace2, "");
          s = s ? \`\${s}
\${u}\` : u, r = r ? \`\${r}
\${c}\` : c;
          let h = this.lexer.state.top;
          if (this.lexer.state.top = true, this.lexer.blockTokens(c, i2, true), this.lexer.state.top = h, n.length === 0) break;
          let d = i2.at(-1);
          if (d?.type === "code") break;
          if (d?.type === "blockquote") {
            let T = d, g = n.join(\`
\`), w = T.raw + \`
\` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), M2 = this.blockquote(w);
            i2[i2.length - 1] = M2, s = \`\${s}
\${g}\`, r = r.substring(0, r.length - T.text.length) + M2.text;
            break;
          } else if (d?.type === "list") {
            let T = d, g = T.raw + \`
\` + n.join(\`
\`), w = this.list(g);
            i2[i2.length - 1] = w, s = s.substring(0, s.length - d.raw.length) + w.raw, r = r.substring(0, r.length - T.raw.length) + w.raw, n = g.substring(i2.at(-1).raw.length).split(\`
\`);
            continue;
          }
        }
        return { type: "blockquote", raw: s, tokens: i2, text: r };
      }
    }
    list(e) {
      let t = this.rules.block.list.exec(e);
      if (t) {
        let n = t[1].trim(), s = n.length > 1, r = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
        n = s ? \`\\\\d{1,9}\\\\\${n.slice(-1)}\` : \`\\\\\${n}\`, this.options.pedantic && (n = s ? n : "[*+-]");
        let i2 = this.rules.other.listItemRegex(n), o = false;
        for (; e; ) {
          let a = false, u = "", c = "";
          if (!(t = i2.exec(e)) || this.rules.block.hr.test(e)) break;
          u = t[0], e = e.substring(u.length);
          let h = me(t[2].split(\`
\`, 1)[0], t[1].length), d = e.split(\`
\`, 1)[0], T = !h.trim(), g = 0;
          if (this.options.pedantic ? (g = 2, c = h.trimStart()) : T ? g = t[1].length + 1 : (g = h.search(this.rules.other.nonSpaceChar), g = g > 4 ? 1 : g, c = h.slice(g), g += t[1].length), T && this.rules.other.blankLine.test(d) && (u += d + \`
\`, e = e.substring(d.length + 1), a = true), !a) {
            let w = this.rules.other.nextBulletRegex(g), M2 = this.rules.other.hrRegex(g), ne = this.rules.other.fencesBeginRegex(g), re = this.rules.other.headingBeginRegex(g), be = this.rules.other.htmlBeginRegex(g), Re = this.rules.other.blockquoteBeginRegex(g);
            for (; e; ) {
              let N = e.split(\`
\`, 1)[0], D;
              if (d = N, this.options.pedantic ? (d = d.replace(this.rules.other.listReplaceNesting, "  "), D = d) : D = d.replace(this.rules.other.tabCharGlobal, "    "), ne.test(d) || re.test(d) || be.test(d) || Re.test(d) || w.test(d) || M2.test(d)) break;
              if (D.search(this.rules.other.nonSpaceChar) >= g || !d.trim()) c += \`
\` + D.slice(g);
              else {
                if (T || h.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ne.test(h) || re.test(h) || M2.test(h)) break;
                c += \`
\` + d;
              }
              T = !d.trim(), u += N + \`
\`, e = e.substring(N.length + 1), h = D.slice(g);
            }
          }
          r.loose || (o ? r.loose = true : this.rules.other.doubleBlankLine.test(u) && (o = true)), r.items.push({ type: "list_item", raw: u, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), r.raw += u;
        }
        let p = r.items.at(-1);
        if (p) p.raw = p.raw.trimEnd(), p.text = p.text.trimEnd();
        else return;
        r.raw = r.raw.trimEnd();
        for (let a of r.items) {
          this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []);
          let u = a.tokens[0];
          if (a.task && (u?.type === "text" || u?.type === "paragraph")) {
            a.text = a.text.replace(this.rules.other.listReplaceTask, ""), u.raw = u.raw.replace(this.rules.other.listReplaceTask, ""), u.text = u.text.replace(this.rules.other.listReplaceTask, "");
            for (let h = this.lexer.inlineQueue.length - 1; h >= 0; h--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[h].src)) {
              this.lexer.inlineQueue[h].src = this.lexer.inlineQueue[h].src.replace(this.rules.other.listReplaceTask, "");
              break;
            }
            let c = this.rules.other.listTaskCheckbox.exec(a.raw);
            if (c) {
              let h = { type: "checkbox", raw: c[0] + " ", checked: c[0] !== "[ ]" };
              a.checked = h.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = h.raw + a.tokens[0].raw, a.tokens[0].text = h.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(h)) : a.tokens.unshift({ type: "paragraph", raw: h.raw, text: h.raw, tokens: [h] }) : a.tokens.unshift(h);
            }
          } else a.task && (a.task = false);
          if (!r.loose) {
            let c = a.tokens.filter((d) => d.type === "space"), h = c.length > 0 && c.some((d) => this.rules.other.anyLine.test(d.raw));
            r.loose = h;
          }
        }
        if (r.loose) for (let a of r.items) {
          a.loose = true;
          for (let u of a.tokens) u.type === "text" && (u.type = "paragraph");
        }
        return r;
      }
    }
    html(e) {
      let t = this.rules.block.html.exec(e);
      if (t) {
        let n = te(t[0]);
        return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
      }
    }
    def(e) {
      let t = this.rules.block.def.exec(e);
      if (t) {
        let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
        return { type: "def", tag: n, raw: $(t[0], \`
\`), href: s, title: r };
      }
    }
    table(e) {
      let t = this.rules.block.table.exec(e);
      if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
      let n = ee(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(\`
\`) : [], i2 = { type: "table", raw: $(t[0], \`
\`), header: [], align: [], rows: [] };
      if (n.length === s.length) {
        for (let o of s) this.rules.other.tableAlignRight.test(o) ? i2.align.push("right") : this.rules.other.tableAlignCenter.test(o) ? i2.align.push("center") : this.rules.other.tableAlignLeft.test(o) ? i2.align.push("left") : i2.align.push(null);
        for (let o = 0; o < n.length; o++) i2.header.push({ text: n[o], tokens: this.lexer.inline(n[o]), header: true, align: i2.align[o] });
        for (let o of r) i2.rows.push(ee(o, i2.header.length).map((p, a) => ({ text: p, tokens: this.lexer.inline(p), header: false, align: i2.align[a] })));
        return i2;
      }
    }
    lheading(e) {
      let t = this.rules.block.lheading.exec(e);
      if (t) {
        let n = t[1].trim();
        return { type: "heading", raw: $(t[0], \`
\`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
      }
    }
    paragraph(e) {
      let t = this.rules.block.paragraph.exec(e);
      if (t) {
        let n = t[1].charAt(t[1].length - 1) === \`
\` ? t[1].slice(0, -1) : t[1];
        return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
      }
    }
    text(e) {
      let t = this.rules.block.text.exec(e);
      if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
    }
    escape(e) {
      let t = this.rules.inline.escape.exec(e);
      if (t) return { type: "escape", raw: t[0], text: t[1] };
    }
    tag(e) {
      let t = this.rules.inline.tag.exec(e);
      if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
    }
    link(e) {
      let t = this.rules.inline.link.exec(e);
      if (t) {
        let n = t[2].trim();
        if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
          if (!this.rules.other.endAngleBracket.test(n)) return;
          let i2 = $(n.slice(0, -1), "\\\\");
          if ((n.length - i2.length) % 2 === 0) return;
        } else {
          let i2 = fe(t[2], "()");
          if (i2 === -2) return;
          if (i2 > -1) {
            let p = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i2;
            t[2] = t[2].substring(0, i2), t[0] = t[0].substring(0, p).trim(), t[3] = "";
          }
        }
        let s = t[2], r = "";
        if (this.options.pedantic) {
          let i2 = this.rules.other.pedanticHrefTitle.exec(s);
          i2 && (s = i2[1], r = i2[3]);
        } else r = t[3] ? t[3].slice(1, -1) : "";
        return s = s.trim(), this.rules.other.startAngleBracket.test(s) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? s = s.slice(1) : s = s.slice(1, -1)), xe(t, { href: s && s.replace(this.rules.inline.anyPunctuation, "$1"), title: r && r.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
      }
    }
    reflink(e, t) {
      let n;
      if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
        let s = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), r = t[s.toLowerCase()];
        if (!r) {
          let i2 = n[0].charAt(0);
          return { type: "text", raw: i2, text: i2 };
        }
        return xe(n, r, n[0], this.lexer, this.rules);
      }
    }
    emStrong(e, t, n = "") {
      let s = this.rules.inline.emStrongLDelim.exec(e);
      if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
      if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
        let i2 = [...s[0]].length - 1, o, p, a = i2, u = 0, c = s[0][0], h = n === c, d = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
        for (d.lastIndex = 0, t = t.slice(-1 * e.length + i2); (s = d.exec(t)) !== null; ) {
          if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o) continue;
          if (p = [...o].length, s[3] || s[4]) {
            a += p;
            continue;
          } else if (s[5] || s[6]) {
            if (i2 % 3 && !((i2 + p) % 3)) {
              u += p;
              continue;
            }
            if (h) break;
          }
          if (a -= p, a > 0) continue;
          p = Math.min(p, p + a + u);
          let T = [...s[0]][0].length, g = e.slice(0, i2 + s.index + T + p);
          if (Math.min(i2, p) % 2) {
            let M2 = g.slice(1, -1);
            return { type: "em", raw: g, text: M2, tokens: this.lexer.inlineTokens(M2) };
          }
          let w = g.slice(2, -2);
          return { type: "strong", raw: g, text: w, tokens: this.lexer.inlineTokens(w) };
        }
      }
    }
    codespan(e) {
      let t = this.rules.inline.code.exec(e);
      if (t) {
        let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
        return s && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
      }
    }
    br(e) {
      let t = this.rules.inline.br.exec(e);
      if (t) return { type: "br", raw: t[0] };
    }
    del(e, t, n = "") {
      let s = this.rules.inline.delLDelim.exec(e);
      if (!s) return;
      if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
        let i2 = [...s[0]].length - 1, o, p, a = i2, u = this.rules.inline.delRDelim;
        for (u.lastIndex = 0, t = t.slice(-1 * e.length + i2); (s = u.exec(t)) !== null; ) {
          if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o || (p = [...o].length, p !== i2)) continue;
          if (s[3] || s[4]) {
            a += p;
            continue;
          }
          if (a -= p, a > 0) continue;
          p = Math.min(p, p + a);
          let c = [...s[0]][0].length, h = e.slice(0, i2 + s.index + c + p), d = h.slice(i2, -i2);
          return { type: "del", raw: h, text: d, tokens: this.lexer.inlineTokens(d) };
        }
      }
    }
    autolink(e) {
      let t = this.rules.inline.autolink.exec(e);
      if (t) {
        let n, s;
        return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
      }
    }
    url(e) {
      let t;
      if (t = this.rules.inline.url.exec(e)) {
        let n, s;
        if (t[2] === "@") n = t[0], s = "mailto:" + n;
        else {
          let r;
          do
            r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
          while (r !== t[0]);
          n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
        }
        return { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
      }
    }
    inlineText(e) {
      let t = this.rules.inline.text.exec(e);
      if (t) {
        let n = this.lexer.state.inRawBlock;
        return { type: "text", raw: t[0], text: t[0], escaped: n };
      }
    }
  };
  var x = class l {
    constructor(e) {
      __publicField(this, "tokens");
      __publicField(this, "options");
      __publicField(this, "state");
      __publicField(this, "inlineQueue");
      __publicField(this, "tokenizer");
      this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || R, this.options.tokenizer = this.options.tokenizer || new y(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
      let t = { other: m, block: H.normal, inline: B.normal };
      this.options.pedantic ? (t.block = H.pedantic, t.inline = B.pedantic) : this.options.gfm && (t.block = H.gfm, this.options.breaks ? t.inline = B.breaks : t.inline = B.gfm), this.tokenizer.rules = t;
    }
    static get rules() {
      return { block: H, inline: B };
    }
    static lex(e, t) {
      return new l(t).lex(e);
    }
    static lexInline(e, t) {
      return new l(t).inlineTokens(e);
    }
    lex(e) {
      e = e.replace(m.carriageReturn, \`
\`), this.blockTokens(e, this.tokens);
      for (let t = 0; t < this.inlineQueue.length; t++) {
        let n = this.inlineQueue[t];
        this.inlineTokens(n.src, n.tokens);
      }
      return this.inlineQueue = [], this.tokens;
    }
    blockTokens(e, t = [], n = false) {
      this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
      let s = 1 / 0;
      for (; e; ) {
        if (e.length < s) s = e.length;
        else {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
        let r;
        if (this.options.extensions?.block?.some((o) => (r = o.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
        if (r = this.tokenizer.space(e)) {
          e = e.substring(r.raw.length);
          let o = t.at(-1);
          r.raw.length === 1 && o !== void 0 ? o.raw += \`
\` : t.push(r);
          continue;
        }
        if (r = this.tokenizer.code(e)) {
          e = e.substring(r.raw.length);
          let o = t.at(-1);
          o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(\`
\`) ? "" : \`
\`) + r.raw, o.text += \`
\` + r.text, this.inlineQueue.at(-1).src = o.text) : t.push(r);
          continue;
        }
        if (r = this.tokenizer.fences(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.heading(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.hr(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.blockquote(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.list(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.html(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.def(e)) {
          e = e.substring(r.raw.length);
          let o = t.at(-1);
          o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(\`
\`) ? "" : \`
\`) + r.raw, o.text += \`
\` + r.raw, this.inlineQueue.at(-1).src = o.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
          continue;
        }
        if (r = this.tokenizer.table(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.lheading(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        let i2 = e;
        if (this.options.extensions?.startBlock) {
          let o = 1 / 0, p = e.slice(1), a;
          this.options.extensions.startBlock.forEach((u) => {
            a = u.call({ lexer: this }, p), typeof a == "number" && a >= 0 && (o = Math.min(o, a));
          }), o < 1 / 0 && o >= 0 && (i2 = e.substring(0, o + 1));
        }
        if (this.state.top && (r = this.tokenizer.paragraph(i2))) {
          let o = t.at(-1);
          n && o?.type === "paragraph" ? (o.raw += (o.raw.endsWith(\`
\`) ? "" : \`
\`) + r.raw, o.text += \`
\` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r), n = i2.length !== e.length, e = e.substring(r.raw.length);
          continue;
        }
        if (r = this.tokenizer.text(e)) {
          e = e.substring(r.raw.length);
          let o = t.at(-1);
          o?.type === "text" ? (o.raw += (o.raw.endsWith(\`
\`) ? "" : \`
\`) + r.raw, o.text += \`
\` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r);
          continue;
        }
        if (e) {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
      }
      return this.state.top = true, t;
    }
    inline(e, t = []) {
      return this.inlineQueue.push({ src: e, tokens: t }), t;
    }
    inlineTokens(e, t = []) {
      this.tokenizer.lexer = this;
      let n = e;
      if (this.tokens.links) {
        let o = Object.keys(this.tokens.links);
        o.length > 0 && (n = n.replace(this.tokenizer.rules.inline.reflinkSearch, (p) => o.includes(p.slice(p.lastIndexOf("[") + 1, -1)) ? "[" + "a".repeat(p.length - 2) + "]" : p));
      }
      n = n.replace(this.tokenizer.rules.inline.anyPunctuation, "++"), n = n.replace(this.tokenizer.rules.inline.blockSkip, (o, p, a) => {
        let u = a ? a.length : 0;
        return o.slice(0, u) + "[" + "a".repeat(o.length - u - 2) + "]";
      }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
      let s = false, r = "", i2 = 1 / 0;
      for (; e; ) {
        if (e.length < i2) i2 = e.length;
        else {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
        s || (r = ""), s = false;
        let o;
        if (this.options.extensions?.inline?.some((a) => (o = a.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), true) : false)) continue;
        if (o = this.tokenizer.escape(e)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (o = this.tokenizer.tag(e)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (o = this.tokenizer.link(e)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (o = this.tokenizer.reflink(e, this.tokens.links)) {
          e = e.substring(o.raw.length);
          let a = t.at(-1);
          o.type === "text" && a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
          continue;
        }
        if (o = this.tokenizer.emStrong(e, n, r)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (o = this.tokenizer.codespan(e)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (o = this.tokenizer.br(e)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (o = this.tokenizer.del(e, n, r)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (o = this.tokenizer.autolink(e)) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        if (!this.state.inLink && (o = this.tokenizer.url(e))) {
          e = e.substring(o.raw.length), t.push(o);
          continue;
        }
        let p = e;
        if (this.options.extensions?.startInline) {
          let a = 1 / 0, u = e.slice(1), c;
          this.options.extensions.startInline.forEach((h) => {
            c = h.call({ lexer: this }, u), typeof c == "number" && c >= 0 && (a = Math.min(a, c));
          }), a < 1 / 0 && a >= 0 && (p = e.substring(0, a + 1));
        }
        if (o = this.tokenizer.inlineText(p)) {
          e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (r = o.raw.slice(-1)), s = true;
          let a = t.at(-1);
          a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
          continue;
        }
        if (e) {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
      }
      return t;
    }
    infiniteLoopError(e) {
      let t = "Infinite loop on byte: " + e;
      if (this.options.silent) console.error(t);
      else throw new Error(t);
    }
  };
  var P = class {
    constructor(e) {
      __publicField(this, "options");
      __publicField(this, "parser");
      this.options = e || R;
    }
    space(e) {
      return "";
    }
    code({ text: e, lang: t, escaped: n }) {
      let s = (t || "").match(m.notSpaceStart)?.[0], r = e.replace(m.endingNewline, "") + \`
\`;
      return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r : O(r, true)) + \`</code></pre>
\` : "<pre><code>" + (n ? r : O(r, true)) + \`</code></pre>
\`;
    }
    blockquote({ tokens: e }) {
      return \`<blockquote>
\${this.parser.parse(e)}</blockquote>
\`;
    }
    html({ text: e }) {
      return e;
    }
    def(e) {
      return "";
    }
    heading({ tokens: e, depth: t }) {
      return \`<h\${t}>\${this.parser.parseInline(e)}</h\${t}>
\`;
    }
    hr(e) {
      return \`<hr>
\`;
    }
    list(e) {
      let t = e.ordered, n = e.start, s = "";
      for (let o = 0; o < e.items.length; o++) {
        let p = e.items[o];
        s += this.listitem(p);
      }
      let r = t ? "ol" : "ul", i2 = t && n !== 1 ? ' start="' + n + '"' : "";
      return "<" + r + i2 + \`>
\` + s + "</" + r + \`>
\`;
    }
    listitem(e) {
      return \`<li>\${this.parser.parse(e.tokens)}</li>
\`;
    }
    checkbox({ checked: e }) {
      return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
    }
    paragraph({ tokens: e }) {
      return \`<p>\${this.parser.parseInline(e)}</p>
\`;
    }
    table(e) {
      let t = "", n = "";
      for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
      t += this.tablerow({ text: n });
      let s = "";
      for (let r = 0; r < e.rows.length; r++) {
        let i2 = e.rows[r];
        n = "";
        for (let o = 0; o < i2.length; o++) n += this.tablecell(i2[o]);
        s += this.tablerow({ text: n });
      }
      return s && (s = \`<tbody>\${s}</tbody>\`), \`<table>
<thead>
\` + t + \`</thead>
\` + s + \`</table>
\`;
    }
    tablerow({ text: e }) {
      return \`<tr>
\${e}</tr>
\`;
    }
    tablecell(e) {
      let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
      return (e.align ? \`<\${n} align="\${e.align}">\` : \`<\${n}>\`) + t + \`</\${n}>
\`;
    }
    strong({ tokens: e }) {
      return \`<strong>\${this.parser.parseInline(e)}</strong>\`;
    }
    em({ tokens: e }) {
      return \`<em>\${this.parser.parseInline(e)}</em>\`;
    }
    codespan({ text: e }) {
      return \`<code>\${O(e, true)}</code>\`;
    }
    br(e) {
      return "<br>";
    }
    del({ tokens: e }) {
      return \`<del>\${this.parser.parseInline(e)}</del>\`;
    }
    link({ href: e, title: t, tokens: n }) {
      let s = this.parser.parseInline(n), r = Y(e);
      if (r === null) return s;
      e = r;
      let i2 = '<a href="' + e + '"';
      return t && (i2 += ' title="' + O(t) + '"'), i2 += ">" + s + "</a>", i2;
    }
    image({ href: e, title: t, text: n, tokens: s }) {
      s && (n = this.parser.parseInline(s, this.parser.textRenderer));
      let r = Y(e);
      if (r === null) return O(n);
      e = r;
      let i2 = \`<img src="\${e}" alt="\${O(n)}"\`;
      return t && (i2 += \` title="\${O(t)}"\`), i2 += ">", i2;
    }
    text(e) {
      return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
    }
  };
  var L = class {
    strong({ text: e }) {
      return e;
    }
    em({ text: e }) {
      return e;
    }
    codespan({ text: e }) {
      return e;
    }
    del({ text: e }) {
      return e;
    }
    html({ text: e }) {
      return e;
    }
    text({ text: e }) {
      return e;
    }
    link({ text: e }) {
      return "" + e;
    }
    image({ text: e }) {
      return "" + e;
    }
    br() {
      return "";
    }
    checkbox({ raw: e }) {
      return e;
    }
  };
  var b = class l2 {
    constructor(e) {
      __publicField(this, "options");
      __publicField(this, "renderer");
      __publicField(this, "textRenderer");
      this.options = e || R, this.options.renderer = this.options.renderer || new P(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L();
    }
    static parse(e, t) {
      return new l2(t).parse(e);
    }
    static parseInline(e, t) {
      return new l2(t).parseInline(e);
    }
    parse(e) {
      this.renderer.parser = this;
      let t = "";
      for (let n = 0; n < e.length; n++) {
        let s = e[n];
        if (this.options.extensions?.renderers?.[s.type]) {
          let i2 = s, o = this.options.extensions.renderers[i2.type].call({ parser: this }, i2);
          if (o !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(i2.type)) {
            t += o || "";
            continue;
          }
        }
        let r = s;
        switch (r.type) {
          case "space": {
            t += this.renderer.space(r);
            break;
          }
          case "hr": {
            t += this.renderer.hr(r);
            break;
          }
          case "heading": {
            t += this.renderer.heading(r);
            break;
          }
          case "code": {
            t += this.renderer.code(r);
            break;
          }
          case "table": {
            t += this.renderer.table(r);
            break;
          }
          case "blockquote": {
            t += this.renderer.blockquote(r);
            break;
          }
          case "list": {
            t += this.renderer.list(r);
            break;
          }
          case "checkbox": {
            t += this.renderer.checkbox(r);
            break;
          }
          case "html": {
            t += this.renderer.html(r);
            break;
          }
          case "def": {
            t += this.renderer.def(r);
            break;
          }
          case "paragraph": {
            t += this.renderer.paragraph(r);
            break;
          }
          case "text": {
            t += this.renderer.text(r);
            break;
          }
          default: {
            let i2 = 'Token with "' + r.type + '" type was not found.';
            if (this.options.silent) return console.error(i2), "";
            throw new Error(i2);
          }
        }
      }
      return t;
    }
    parseInline(e, t = this.renderer) {
      this.renderer.parser = this;
      let n = "";
      for (let s = 0; s < e.length; s++) {
        let r = e[s];
        if (this.options.extensions?.renderers?.[r.type]) {
          let o = this.options.extensions.renderers[r.type].call({ parser: this }, r);
          if (o !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
            n += o || "";
            continue;
          }
        }
        let i2 = r;
        switch (i2.type) {
          case "escape": {
            n += t.text(i2);
            break;
          }
          case "html": {
            n += t.html(i2);
            break;
          }
          case "link": {
            n += t.link(i2);
            break;
          }
          case "image": {
            n += t.image(i2);
            break;
          }
          case "checkbox": {
            n += t.checkbox(i2);
            break;
          }
          case "strong": {
            n += t.strong(i2);
            break;
          }
          case "em": {
            n += t.em(i2);
            break;
          }
          case "codespan": {
            n += t.codespan(i2);
            break;
          }
          case "br": {
            n += t.br(i2);
            break;
          }
          case "del": {
            n += t.del(i2);
            break;
          }
          case "text": {
            n += t.text(i2);
            break;
          }
          default: {
            let o = 'Token with "' + i2.type + '" type was not found.';
            if (this.options.silent) return console.error(o), "";
            throw new Error(o);
          }
        }
      }
      return n;
    }
  };
  var _a10;
  var S = (_a10 = class {
    constructor(e) {
      __publicField(this, "options");
      __publicField(this, "block");
      this.options = e || R;
    }
    preprocess(e) {
      return e;
    }
    postprocess(e) {
      return e;
    }
    processAllTokens(e) {
      return e;
    }
    emStrongMask(e) {
      return e;
    }
    provideLexer(e = this.block) {
      return e ? x.lex : x.lexInline;
    }
    provideParser(e = this.block) {
      return e ? b.parse : b.parseInline;
    }
  }, __publicField(_a10, "passThroughHooks", /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"])), __publicField(_a10, "passThroughHooksRespectAsync", /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"])), _a10);
  var Z = class {
    constructor(...e) {
      __publicField(this, "defaults", C2());
      __publicField(this, "options", this.setOptions);
      __publicField(this, "parse", this.parseMarkdown(true));
      __publicField(this, "parseInline", this.parseMarkdown(false));
      __publicField(this, "Parser", b);
      __publicField(this, "Renderer", P);
      __publicField(this, "TextRenderer", L);
      __publicField(this, "Lexer", x);
      __publicField(this, "Tokenizer", y);
      __publicField(this, "Hooks", S);
      this.use(...e);
    }
    walkTokens(e, t) {
      let n = [];
      for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
        case "table": {
          let r = s;
          for (let i2 of r.header) n = n.concat(this.walkTokens(i2.tokens, t));
          for (let i2 of r.rows) for (let o of i2) n = n.concat(this.walkTokens(o.tokens, t));
          break;
        }
        case "list": {
          let r = s;
          n = n.concat(this.walkTokens(r.items, t));
          break;
        }
        default: {
          let r = s;
          this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((i2) => {
            let o = r[i2].flat(1 / 0);
            n = n.concat(this.walkTokens(o, t));
          }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
        }
      }
      return n;
    }
    use(...e) {
      let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
      return e.forEach((n) => {
        let s = { ...n };
        if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r) => {
          if (!r.name) throw new Error("extension name required");
          if ("renderer" in r) {
            let i2 = t.renderers[r.name];
            i2 ? t.renderers[r.name] = function(...o) {
              let p = r.renderer.apply(this, o);
              return p === false && (p = i2.apply(this, o)), p;
            } : t.renderers[r.name] = r.renderer;
          }
          if ("tokenizer" in r) {
            if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
            let i2 = t[r.level];
            i2 ? i2.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
          }
          "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
        }), s.extensions = t), n.renderer) {
          let r = this.defaults.renderer || new P(this.defaults);
          for (let i2 in n.renderer) {
            if (!(i2 in r)) throw new Error(\`renderer '\${i2}' does not exist\`);
            if (["options", "parser"].includes(i2)) continue;
            let o = i2, p = n.renderer[o], a = r[o];
            r[o] = (...u) => {
              let c = p.apply(r, u);
              return c === false && (c = a.apply(r, u)), c || "";
            };
          }
          s.renderer = r;
        }
        if (n.tokenizer) {
          let r = this.defaults.tokenizer || new y(this.defaults);
          for (let i2 in n.tokenizer) {
            if (!(i2 in r)) throw new Error(\`tokenizer '\${i2}' does not exist\`);
            if (["options", "rules", "lexer"].includes(i2)) continue;
            let o = i2, p = n.tokenizer[o], a = r[o];
            r[o] = (...u) => {
              let c = p.apply(r, u);
              return c === false && (c = a.apply(r, u)), c;
            };
          }
          s.tokenizer = r;
        }
        if (n.hooks) {
          let r = this.defaults.hooks || new S();
          for (let i2 in n.hooks) {
            if (!(i2 in r)) throw new Error(\`hook '\${i2}' does not exist\`);
            if (["options", "block"].includes(i2)) continue;
            let o = i2, p = n.hooks[o], a = r[o];
            S.passThroughHooks.has(i2) ? r[o] = (u) => {
              if (this.defaults.async && S.passThroughHooksRespectAsync.has(i2)) return (async () => {
                let h = await p.call(r, u);
                return a.call(r, h);
              })();
              let c = p.call(r, u);
              return a.call(r, c);
            } : r[o] = (...u) => {
              if (this.defaults.async) return (async () => {
                let h = await p.apply(r, u);
                return h === false && (h = await a.apply(r, u)), h;
              })();
              let c = p.apply(r, u);
              return c === false && (c = a.apply(r, u)), c;
            };
          }
          s.hooks = r;
        }
        if (n.walkTokens) {
          let r = this.defaults.walkTokens, i2 = n.walkTokens;
          s.walkTokens = function(o) {
            let p = [];
            return p.push(i2.call(this, o)), r && (p = p.concat(r.call(this, o))), p;
          };
        }
        this.defaults = { ...this.defaults, ...s };
      }), this;
    }
    setOptions(e) {
      return this.defaults = { ...this.defaults, ...e }, this;
    }
    lexer(e, t) {
      return x.lex(e, t ?? this.defaults);
    }
    parser(e, t) {
      return b.parse(e, t ?? this.defaults);
    }
    parseMarkdown(e) {
      return (n, s) => {
        let r = { ...s }, i2 = { ...this.defaults, ...r }, o = this.onError(!!i2.silent, !!i2.async);
        if (this.defaults.async === true && r.async === false) return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
        if (typeof n > "u" || n === null) return o(new Error("marked(): input parameter is undefined or null"));
        if (typeof n != "string") return o(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
        if (i2.hooks && (i2.hooks.options = i2, i2.hooks.block = e), i2.async) return (async () => {
          let p = i2.hooks ? await i2.hooks.preprocess(n) : n, u = await (i2.hooks ? await i2.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(p, i2), c = i2.hooks ? await i2.hooks.processAllTokens(u) : u;
          i2.walkTokens && await Promise.all(this.walkTokens(c, i2.walkTokens));
          let d = await (i2.hooks ? await i2.hooks.provideParser(e) : e ? b.parse : b.parseInline)(c, i2);
          return i2.hooks ? await i2.hooks.postprocess(d) : d;
        })().catch(o);
        try {
          i2.hooks && (n = i2.hooks.preprocess(n));
          let a = (i2.hooks ? i2.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, i2);
          i2.hooks && (a = i2.hooks.processAllTokens(a)), i2.walkTokens && this.walkTokens(a, i2.walkTokens);
          let c = (i2.hooks ? i2.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, i2);
          return i2.hooks && (c = i2.hooks.postprocess(c)), c;
        } catch (p) {
          return o(p);
        }
      };
    }
    onError(e, t) {
      return (n) => {
        if (n.message += \`
Please report this to https://github.com/markedjs/marked.\`, e) {
          let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
          return t ? Promise.resolve(s) : s;
        }
        if (t) return Promise.reject(n);
        throw n;
      };
    }
  };
  var E = new Z();
  function f(l3, e) {
    return E.parse(l3, e);
  }
  f.options = f.setOptions = function(l3) {
    return E.setOptions(l3), f.defaults = E.defaults, j(f.defaults), f;
  };
  f.getDefaults = C2;
  f.defaults = R;
  function kt(...l3) {
    return E.use(...l3), f.defaults = E.defaults, j(f.defaults), f;
  }
  f.use = kt;
  f.walkTokens = function(l3, e) {
    return E.walkTokens(l3, e);
  };
  f.parseInline = E.parseInline;
  f.Parser = b;
  f.parser = b.parse;
  f.Renderer = P;
  f.TextRenderer = L;
  f.Lexer = x;
  f.lexer = x.lex;
  f.Tokenizer = y;
  f.Hooks = S;
  f.parse = f;
  var nn = f.options;
  var rn = f.setOptions;
  var sn = f.walkTokens;
  var on = f.parseInline;
  var ln = b.parse;
  var pn = x.lex;

  // src/lib/language.ts
  var EXTENSIONS = {
    ts: "ts",
    tsx: "ts",
    mts: "ts",
    cts: "ts",
    js: "js",
    jsx: "js",
    mjs: "js",
    cjs: "js",
    vue: "js",
    svelte: "js",
    py: "py",
    go: "go",
    rs: "rs",
    java: "java",
    kt: "kt",
    kts: "kt",
    scala: "java",
    swift: "swift",
    rb: "rb",
    php: "php",
    cs: "cs",
    c: "c",
    h: "c",
    cc: "c",
    cpp: "c",
    hpp: "c",
    m: "c",
    css: "css",
    scss: "css",
    less: "css",
    html: "html",
    xml: "html",
    svg: "html",
    json: "json",
    jsonc: "json",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    md: "md",
    mdx: "md",
    rst: "md",
    txt: "text",
    sh: "sh",
    bash: "sh",
    zsh: "sh",
    sql: "sql"
  };
  var languageOf = (path) => {
    const name2 = path.split("/").pop() ?? path;
    if (/^(Dockerfile|Makefile)$/i.test(name2)) return "sh";
    const ext = name2.includes(".") ? name2.split(".").pop().toLowerCase() : "";
    return EXTENSIONS[ext] ?? "text";
  };
  var GENERATED = [
    /(^|\\/)(package-lock\\.json|npm-shrinkwrap\\.json|pnpm-lock\\.yaml|yarn\\.lock|bun\\.lockb?|Cargo\\.lock|go\\.sum|poetry\\.lock|uv\\.lock|Pipfile\\.lock|Gemfile\\.lock|composer\\.lock|Podfile\\.lock|flake\\.lock)$/,
    /(^|\\/)(dist|build|out|vendor|third_party|node_modules|generated|__generated__)\\//,
    /\\.(min\\.(js|css)|map|snap|pb\\.go|lock)$/,
    /(^|\\/)__snapshots__\\//,
    /\\.generated\\.[^/]+$/
  ];
  var TEST = [
    /(^|\\/)(__tests__|__mocks__|tests?|spec|specs|e2e|testdata|fixtures)\\//i,
    /\\.(test|spec|e2e)\\.[^/]+$/i,
    /_test\\.(go|py|rb|exs?)$/,
    /(^|\\/)test_[^/]+\\.py$/,
    /Tests?\\.(java|kt|cs|swift)$/
  ];
  var DOCS = [/\\.(md|mdx|rst|txt|adoc)$/i, /(^|\\/)(docs?|documentation)\\//i, /(^|\\/)(LICENSE|CHANGELOG|README|CONTRIBUTING)(\\.[^/]*)?$/i];
  var CONFIG = [
    /\\.(json|jsonc|ya?ml|toml|ini|cfg|conf|env|properties|lock)$/i,
    /(^|\\/)\\.[^/]+$/,
    /(^|\\/)[^/]*\\.config\\.[^/]+$/,
    /(^|\\/)(Dockerfile|Makefile|Procfile)$/,
    // Tooling and agent folders (\`.github/\`, \`.claude/\`, \`.vscode/\`, \`.devcontainer/\`): not the change itself.
    /(^|\\/)\\.[^/]+\\//
  ];
  var roleOf = (path) => {
    if (GENERATED.some((re) => re.test(path))) return "generated";
    if (TEST.some((re) => re.test(path))) return "test";
    if (DOCS.some((re) => re.test(path))) return "docs";
    if (CONFIG.some((re) => re.test(path))) return "config";
    return "code";
  };

  // src/lib/markdown.ts
  var MAX_BODY = 2e4;
  var lexMarkdown = (body2) => x.lex(body2.slice(0, MAX_BODY), { gfm: true }).filter((t) => t.type !== "space");
  var EMOJI = {
    tada: "\\u{1F389}",
    sparkles: "\\u2728",
    rocket: "\\u{1F680}",
    bug: "\\u{1F41B}",
    fire: "\\u{1F525}",
    zap: "\\u26A1",
    memo: "\\u{1F4DD}",
    recycle: "\\u267B\\uFE0F",
    art: "\\u{1F3A8}",
    wrench: "\\u{1F527}",
    hammer: "\\u{1F528}",
    package: "\\u{1F4E6}",
    lock: "\\u{1F512}",
    boom: "\\u{1F4A5}",
    warning: "\\u26A0\\uFE0F",
    construction: "\\u{1F6A7}",
    white_check_mark: "\\u2705",
    heavy_check_mark: "\\u2714\\uFE0F",
    x: "\\u274C",
    lipstick: "\\u{1F484}",
    bookmark: "\\u{1F516}",
    rotating_light: "\\u{1F6A8}",
    arrow_up: "\\u2B06\\uFE0F",
    arrow_down: "\\u2B07\\uFE0F",
    pencil2: "\\u270F\\uFE0F",
    eyes: "\\u{1F440}",
    wastebasket: "\\u{1F5D1}\\uFE0F"
  };
  var emojify = (text) => text.replace(/:([a-z0-9_+-]+):/g, (whole, name2) => EMOJI[name2] ?? whole);
  var segments = (title) => title.split("\`").map((text, i2) => ({ text: i2 % 2 === 1 ? text : emojify(text), code: i2 % 2 === 1 })).filter((s) => s.text.length > 0);
  var visible = (tokens) => {
    let chars = 0;
    let breaks = 0;
    for (const t of tokens ?? []) {
      if (t.type === "br" || t.type === "html" && /^<br/i.test(t.text ?? "")) breaks++;
      else if (t.type === "image" || t.type === "html" && /^<img/i.test(t.text ?? "")) chars += 8 + (t.text?.length ?? 0);
      else if (t.type === "html") continue;
      else if (t.type === "codespan") chars += (t.text?.length ?? 0) * 1.1 + 2;
      else if (t.tokens) {
        const inner = visible(t.tokens);
        chars += inner.chars;
        breaks += inner.breaks;
      } else chars += t.text?.length ?? 0;
    }
    return { chars, breaks };
  };
  var M = { line: 21, gap: 16, charWidth: 7.2, indent: 32, codeLine: 20, codePad: 32, tableRow: 34, quotePad: 16, itemGap: 3.5 };
  var HEADING = [0, 84, 74, 62, 58, 56, 54];
  var textHeight = (tokens, width) => {
    const { chars, breaks } = visible(tokens);
    return (Math.max(1, Math.ceil(chars * M.charWidth / Math.max(1, width))) + breaks) * M.line;
  };
  var MARGIN = 1.03;
  var markdownBlocks = (tokens, width) => {
    const height = (t, w, nested) => {
      switch (t.type) {
        case "paragraph":
          return textHeight(t.tokens, w) + M.gap;
        case "text":
          return textHeight(t.tokens ?? [{ type: "text", text: t.text }], w);
        case "heading":
          return HEADING[Math.min(6, t.depth ?? 1)] + (textHeight(t.tokens, w) / M.line - 1) * M.line * 1.4;
        case "code":
          return (t.text ?? "").split("\\n").length * M.codeLine + M.codePad + M.gap;
        case "hr":
          return 52;
        case "table":
          return ((t.rows?.length ?? 0) + 1) * M.tableRow + M.gap;
        case "blockquote":
          return sum(t.tokens ?? [], w - 16) + M.quotePad;
        case "list": {
          const items = (t.items ?? []).map((item) => Math.max(M.line, sum(item.tokens ?? [], w - M.indent)));
          const loose = (t.items ?? []).some((item) => item.tokens?.[0]?.type === "paragraph");
          const between = loose ? -M.gap : M.itemGap * (items.length - 1);
          return items.reduce((n, h) => n + h, 0) + between + (nested ? M.itemGap : M.gap);
        }
        default:
          return 0;
      }
    };
    const sum = (list, w) => list.reduce((n, t) => n + height(t, w, true), 0);
    let depth = 0;
    let first = true;
    return tokens.map((t) => {
      if (t.type === "html") {
        const text = t.text ?? "";
        const opens = (text.match(/<details\\b/gi) ?? []).length;
        const closes = (text.match(/<\\/details>/gi) ?? []).length;
        const was = depth;
        depth = Math.max(0, depth + opens - closes);
        const shown = text.replace(/<!--[\\s\\S]*?(-->|$)|<[^>]*>/g, "");
        const h2 = was > 0 ? 0 : opens > 0 ? M.line + M.gap : /[^\\s]/.test(shown) ? textHeight([{ type: "text", text: shown }], width) + M.gap : 0;
        if (h2 > 0) first = false;
        return h2;
      }
      if (depth > 0) return 0;
      const h = height(t, width, false);
      const above = t.type === "heading" || t.type === "hr" ? first ? 24 : M.gap : 0;
      if (h > 0) first = false;
      return h - above;
    });
  };
  var blocksHeight = (blocks) => Math.ceil(Math.max(0, blocks.reduce((n, h) => n + h, 0) - M.gap) * MARGIN);

  // src/lib/card.ts
  var CARD = {
    header: 56,
    row: 20,
    padBottom: 12,
    minWidth: 480,
    maxWidth: 880,
    /** Width of one character of the code font at 12.5px. */
    charWidth: 7.6,
    /** Two line-number columns, the +/− column and the call arrow. */
    gutter: 124,
    /** Code rows a card shows at most; rows that start a string are never cut. */
    maxRows: 24,
    /** Unchanged lines a card keeps on each side of a change. */
    context: 2,
    /** Rows a context card shows at most. */
    contextRows: 10,
    /** Test cases a test card lists at most. */
    maxCases: 12
  };
  var opensReadAll = (r) => r?.kind === "fold" && r.tail || r?.kind === "info" && r.readAll === true;
  var expandTabs = (text) => text.replace(/\\t/g, "    ");
  var changedSpan = (a, b2) => {
    let start2 = 0;
    while (start2 < a.length && start2 < b2.length && a[start2] === b2[start2]) start2++;
    let endA = a.length;
    let endB = b2.length;
    while (endA > start2 && endB > start2 && a[endA - 1] === b2[endB - 1]) {
      endA--;
      endB--;
    }
    const indent = Math.min(/^\\s*/.exec(a)[0].length, /^\\s*/.exec(b2)[0].length, start2);
    const shared = start2 - indent + (a.length - endA);
    if (shared < 4 || shared < (Math.max(a.length, b2.length) - indent) * 0.3) return null;
    return { start: start2, endA, endB };
  };
  var highlightMarked = (text, lang, state, [from, to]) => from === to ? highlightLine(text, lang, state) : highlightLine(text.slice(0, from), lang, state) + \`<mark>\${highlightLine(text.slice(from, to), lang, state)}</mark>\` + highlightLine(text.slice(to), lang, state);
  var pairLines = (dels, adds) => {
    let from = 0;
    return dels.map((a) => {
      if (adds.length > 40) return null;
      let best = null;
      for (let at2 = from; at2 < adds.length; at2++) {
        const span2 = changedSpan(a, adds[at2]);
        const score = span2 ? span2.start + (a.length - span2.endA) : -1;
        if (span2 && (!best || score > best.score)) best = { add: at2, span: span2, score };
      }
      if (!best) return null;
      from = best.add + 1;
      return { add: best.add, span: best.span };
    });
  };
  var changeRuns = (items, kind) => {
    const runs = [];
    for (let i2 = 0; i2 < items.length; ) {
      if (kind(items[i2]) !== "del") {
        i2++;
        continue;
      }
      const dels = [];
      const adds = [];
      while (i2 < items.length && kind(items[i2]) === "del") dels.push(i2++);
      while (i2 < items.length && kind(items[i2]) === "add") adds.push(i2++);
      runs.push({ dels, adds });
    }
    return runs;
  };
  var lineRows = (lang, lines) => {
    const marks = /* @__PURE__ */ new Map();
    for (const run2 of changeRuns(lines, (l3) => l3.t === "ctx" ? "other" : l3.t)) {
      const pairs = pairLines(
        run2.dels.map((i2) => expandTabs(lines[i2].text)),
        run2.adds.map((i2) => expandTabs(lines[i2].text))
      );
      pairs.forEach((pair, d) => {
        if (!pair) return;
        marks.set(lines[run2.dels[d]], [pair.span.start, pair.span.endA]);
        marks.set(lines[run2.adds[pair.add]], [pair.span.start, pair.span.endB]);
      });
    }
    const state = { inBlock: false };
    return lines.map((line) => {
      const text = expandTabs(line.text);
      const mark = marks.get(line);
      return { kind: "line", line, html: mark ? highlightMarked(text, lang, state, mark) : highlightLine(text, lang, state) };
    });
  };
  var declLines = (f2, head, from, to, trailing = false) => {
    const all = allLines(f2.hunks);
    const byHead = new Map(all.filter((l3) => l3.n !== void 0).map((l3) => [l3.n, l3]));
    const dels = /* @__PURE__ */ new Map();
    for (const l3 of all) if (l3.t === "del") dels.set(l3.at, [...dels.get(l3.at) ?? [], l3]);
    const offset = (n) => {
      const above = f2.hunks.filter((h) => h.newEnd < n);
      const last = above[above.length - 1];
      return last ? last.oldEnd - last.newEnd : 0;
    };
    const out2 = [];
    for (let n = from; n <= to; n++) {
      out2.push(...dels.get(n) ?? []);
      out2.push(byHead.get(n) ?? { t: "ctx", o: n + offset(n), n, at: n, text: head[n - from] ?? "" });
    }
    if (trailing) out2.push(...dels.get(to + 1) ?? []);
    return out2;
  };
  var foldRows = (lang, lines, priority, calls, max) => {
    const highlighted = lineRows(lang, lines);
    const render = (kept2, cut) => {
      const rows = [];
      for (let i2 = 0; i2 < lines.length; ) {
        if (kept2[i2]) {
          const n = lines[i2].n;
          rows.push({ ...highlighted[i2], ...n !== void 0 && calls.has(n) ? { call: true } : {} });
          i2++;
          continue;
        }
        let j2 = i2;
        while (j2 < lines.length && !kept2[j2]) j2++;
        const tail = j2 === lines.length;
        if (j2 - i2 === 1) rows.push(highlighted[i2]);
        else rows.push({ kind: "fold", count: j2 - i2, from: lines[i2].at, to: lines[j2 - 1].at, tail, more: tail && cut });
        i2 = j2;
      }
      return rows;
    };
    const at2 = (min) => priority.map((p) => p >= min);
    for (const min of [1, 2]) {
      const rows = render(at2(min), false);
      if (rows.length <= max) return rows;
    }
    const kept = at2(3);
    priority.forEach((p, i2) => {
      if (p !== 2) return;
      kept[i2] = true;
      if (render(kept, true).length > max) kept[i2] = false;
    });
    return render(kept, true);
  };
  var outgoing = (review, pin) => review.links.filter((l3) => l3.from === pin);
  var declRows = (pin, review) => {
    const f2 = review.files.find((x2) => x2.path === pin.path);
    if (!f2 || !pin.head) return [{ kind: "info", text: "PR Blackboard couldn't read this file." }];
    const lines = declLines(f2, pin.head, pin.from, pin.to, (pin.symbol?.to ?? 0) > pin.to);
    const out2 = outgoing(review, pin.id);
    const starts = new Set(out2.map((l3) => l3.at).filter((n) => n !== void 0));
    const calls = new Set(out2.flatMap((l3) => l3.rows));
    const start2 = pin.symbol?.start ?? pin.from;
    if (pin.kind === "context") {
      const priority2 = lines.map((l3) => l3.n === start2 || starts.has(l3.n ?? -1) || calls.has(l3.n ?? -1) ? 3 : 0);
      const near = priority2.map((_2, i2) => priority2.slice(Math.max(0, i2 - 1), i2 + 2).some((p) => p === 3));
      const helper = calls.size === 0;
      return foldRows(f2.lang, lines, priority2.map((p, i2) => p === 3 ? 3 : helper || near[i2] ? 1 : 0), calls, CARD.contextRows);
    }
    const sigEnd = (() => {
      for (let n = start2; n <= Math.min(pin.to, start2 + 15); n++) if (/(\\{|=>|:|=)\\s*$/.test((pin.head[n - pin.from] ?? "").trim())) return n;
      return start2;
    })();
    const changedAt = lines.map((l3, i2) => l3.t === "ctx" ? -1 : i2).filter((i2) => i2 >= 0);
    const priority = lines.map((l3, i2) => {
      const n = l3.n ?? -1;
      if (l3.t !== "del" && n === start2 || starts.has(n)) return 3;
      if (l3.t !== "ctx" || calls.has(n) || n === sigEnd && sigEnd - start2 + 1 > 3) return 2;
      if (changedAt.some((c) => Math.abs(c - i2) <= CARD.context)) return 1;
      return 0;
    });
    return foldRows(f2.lang, lines, priority, calls, CARD.maxRows);
  };
  var fileRows = (pin, review) => {
    const f2 = review.files.find((x2) => x2.path === pin.path);
    if (!f2) return [{ kind: "info", text: "Nothing to show." }];
    if (!f2.hasPatch) {
      return [
        { kind: "info", text: "GitHub doesn't show this diff: the file is too large or not text." },
        ...f2.previousPath ? [{ kind: "info", text: \`Renamed from \${f2.previousPath}.\` }] : []
      ];
    }
    if (f2.hunks.length === 0) return [{ kind: "info", text: f2.previousPath ? \`Renamed from \${f2.previousPath}, with no changes inside.\` : "No changes inside the file." }];
    const inRange = (l3) => !pin.ranges || pin.ranges.some((r) => l3.at >= r.from - 3 && l3.at <= r.to + 3);
    const rows = [];
    let end = null;
    for (const h of f2.hunks) {
      const lines = h.lines.filter(inRange);
      if (lines.length === 0) continue;
      if (end !== null && lines[0].at > end + 1) rows.push({ kind: "gap", count: lines[0].at - end - 1 });
      end = lines[lines.length - 1].at;
      const changedAt = lines.map((l3, i2) => l3.t === "ctx" ? -1 : i2).filter((i2) => i2 >= 0);
      const priority = lines.map((l3, i2) => l3.t !== "ctx" ? 2 : changedAt.some((c) => Math.abs(c - i2) <= CARD.context) ? 1 : 0);
      rows.push(...foldRows(f2.lang, lines, priority, /* @__PURE__ */ new Set(), Number.MAX_SAFE_INTEGER).filter((r) => !(r.kind === "fold" && r.tail)));
    }
    if (rows.length <= CARD.maxRows) return rows;
    const kept = rows.slice(0, CARD.maxRows - 1);
    const hidden = rows.slice(kept.length).reduce((n, r) => n + (r.kind === "line" ? 1 : r.kind === "fold" ? r.count : 0), 0);
    return [...kept, { kind: "fold", count: hidden, from: 0, to: 0, tail: true, more: true }];
  };
  var testRows = (pin, review) => {
    const f2 = review.files.find((x2) => x2.path === pin.path);
    if (!f2) return [];
    const cases = f2.cases.filter((c) => c.t === "add" || !f2.cases.some((d) => d.t === "add" && d.at === c.at));
    if (cases.length === 0) return fileRows(pin, review);
    const shown = cases.slice(0, CARD.maxCases);
    const open = [];
    const rows = shown.map((test) => {
      while (open.length > 0 && open[open.length - 1] >= test.indent) open.pop();
      const depth = open.length;
      if (test.group) open.push(test.indent);
      return { kind: "case", test, depth };
    });
    const tail = cases.length > shown.length ? { kind: "info", text: \`\${plural(cases.length - shown.length, "more case")} \\xB7 Read all\`, readAll: true } : { kind: "info", text: "Test code \\xB7 Read all", readAll: true };
    return [...rows, tail];
  };
  var wordOf = (l3) => l3.kind === "context" ? l3.reads ?? "calls" : l3.kind;
  var rowChars = (r) => {
    switch (r.kind) {
      case "line":
        return expandTabs(r.line.text).length;
      case "case":
        return r.test.name.length + 10 + r.depth * 2;
      case "info":
        return r.text.length * 0.9;
      default:
        return 0;
    }
  };
  var rowWidth = (r) => CARD.gutter + rowChars(r) * CARD.charWidth + 32;
  var pinCard = (pin, review) => {
    const built = pin.kind === "change" || pin.kind === "context" ? declRows(pin, review) : pin.kind === "test" ? testRows(pin, review) : fileRows(pin, review);
    const header = 220 + (pin.name.length + (pin.path ?? "").length) * 7;
    const width = Math.round(clamp(Math.max(header, ...built.map(rowWidth)), CARD.minWidth, CARD.maxWidth));
    const room = width - (pin.kind === "context" ? 68 : CARD.gutter) - 12;
    const cut = built.flatMap((r) => r.kind === "line" && rowChars(r) * CARD.charWidth > room ? [r.line.at] : []);
    const rows = cut.length === 0 || opensReadAll(built[built.length - 1]) ? built : [...built, { kind: "fold", count: cut.length, from: cut[0], to: cut[0], tail: true, more: false, cut: true }];
    const anchors = {};
    for (const l3 of outgoing(review, pin.id)) {
      const i2 = rows.findIndex((r) => r.kind === "line" && r.line.t !== "del" && r.line.n === l3.at);
      if (i2 >= 0) anchors[l3.id] = i2;
    }
    return { pin: pin.id, rows, width, height: CARD.header + rows.length * CARD.row + CARD.padBottom, anchors };
  };
  var rowMiddle = (row) => row < 0 ? CARD.header / 2 : CARD.header + row * CARD.row + CARD.row / 2;
  var CARD_CSS = \`
header { height: \${CARD.header}px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: var(--bg2); border-bottom: 1px solid var(--line); white-space: nowrap; }
.name { flex: none; max-width: 52%; font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; }
.chip { flex: none; border-radius: 6px; padding: 3px 7px; font: 700 10.5px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .06em; }
.chip.new { background: var(--add-gut); color: var(--add); } .chip.unchanged { background: var(--line); color: var(--ink2); } .chip.test { background: var(--blue); color: var(--bg); }
.where { min-width: 0; flex: 1; text-align: right; color: var(--ink3); font: 12px ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; }
.counts { flex: none; font: 500 12.5px ui-monospace, Menlo, monospace; }
.r { height: \${CARD.row}px; line-height: \${CARD.row}px; display: grid; grid-template-columns: 44px 44px 20px 16px 1fr; white-space: pre; overflow: hidden; font: 12.5px/\${CARD.row}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
.r > i { font-style: normal; text-align: right; padding-right: 8px; color: var(--ink3); font-size: 11.5px; }
.r > b { font-weight: 400; text-align: center; color: var(--ink3); }
.r > u { text-decoration: none; color: var(--ink); font-weight: 700; text-align: center; }
.r > code { overflow: hidden; text-overflow: ellipsis; padding-right: 12px; }
.add { background: var(--add-bg); } .add > i { background: var(--add-gut); } .add > b { color: var(--add); }
.del { background: var(--del-bg); } .del > i { background: var(--del-gut); } .del > b { color: var(--del); }
.plain .r { grid-template-columns: 52px 16px 1fr; color: var(--ink2); }
.gap, .fold, .info { height: \${CARD.row}px; line-height: \${CARD.row}px; padding: 0 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink3); font-size: 11.5px; }
.fold, .gap { font-family: ui-monospace, Menlo, monospace; padding-left: 112px; }
.fold.cases { padding-left: 52px; }
.ra { color: var(--ink2); text-decoration: underline; text-underline-offset: 2px; }
.dots { font: 15px/1 ui-sans-serif, system-ui, sans-serif; }
.info { color: var(--ink2); font-size: 12.5px; }
.case { height: \${CARD.row}px; line-height: \${CARD.row}px; padding-right: 14px; display: grid; grid-template-columns: 44px 20px 1fr; white-space: nowrap; overflow: hidden; font-size: 12.5px; }
.case > i { font-style: normal; text-align: right; padding-right: 8px; color: var(--ink3); font: 11.5px/\${CARD.row}px ui-monospace, Menlo, monospace; }
.case > b { font-weight: 400; text-align: center; }
.case > span { overflow: hidden; text-overflow: ellipsis; }
.case.group > span { font-weight: 600; }
.case.removed { color: var(--ink3); text-decoration: line-through; }
.k { color: var(--k); } .s { color: var(--s); } .n { color: var(--n); } .c { color: var(--c); font-style: italic; } .f { color: var(--f); } .t { color: var(--t); }
mark { color: inherit; border-radius: 3px; background: var(--add-mark); }
.del mark { background: var(--del-mark); }
body.context { border: 1.5px dashed var(--ink3); border-radius: 12px; }
body.context header { background: transparent; color: var(--ink2); }
\`;
  var PR = {
    width: 640,
    pad: 16,
    titleLine: 26,
    /** About how wide a character of the 20 px title runs. */
    titleChar: 10.8,
    /** Title to meta, and the meta line. */
    meta: 24,
    unpinned: 20,
    /** 16 above the rule, the rule, 16 below. */
    rule: 33,
    /** The description area is never taller. */
    maxDescription: 500,
    fold: 32,
    /** The fade over a first block cut inside. */
    fade: 48,
    /** How far over Chrome's layout the description's estimate runs at most, as a share of it. */
    over: 0.1
  };
  var unpinnedText = ({ functions, files }) => {
    const parts2 = [functions > 0 ? plural(functions, "function") : "", files > 0 ? plural(files, "file") : ""].filter(Boolean);
    return parts2.length > 0 ? \`\${parts2.join(" and ")} not pinned\` : null;
  };
  var fitBlocks = (tokens, blocks, max) => {
    if (blocksHeight(blocks) <= max + PR.fold) return { count: tokens.length, height: blocksHeight(blocks), cut: false };
    let count2 = 0;
    while (count2 < tokens.length && blocksHeight(blocks.slice(0, count2 + 1)) <= max) count2++;
    if (count2 === tokens.length) return { count: count2, height: blocksHeight(blocks), cut: false };
    while (count2 > 0 && (tokens[count2 - 1].type === "heading" || blocks[count2 - 1] === 0)) count2--;
    if (count2 === 0) return { count: tokens.length, height: max, cut: true };
    return { count: count2, height: blocksHeight(blocks.slice(0, count2)), cut: false };
  };
  var prCard = (review) => {
    const all = lexMarkdown(review.pr.body);
    const inner = PR.width - 2 * PR.pad;
    const titleChars = segments(review.pr.title).reduce((n, s) => n + s.text.length * (s.code ? 1.15 : 1), 0);
    const titleLines = clamp(Math.ceil(titleChars * PR.titleChar / inner), 1, 3);
    const blocks = markdownBlocks(all, inner);
    const estimate = blocksHeight(blocks);
    const fit = fitBlocks(all, blocks, PR.maxDescription);
    const folded = fit.count < all.length || fit.cut;
    const top = CARD.header + PR.pad + titleLines * PR.titleLine + PR.meta + (unpinnedText(review.unpinned) ? PR.unpinned : 0) + (estimate > 0 ? PR.rule : 0);
    return {
      width: PR.width,
      height: top + fit.height + (folded ? PR.fold : 0) + PR.pad,
      titleLines,
      tokens: all.slice(0, fit.count),
      estimate,
      description: fit.height,
      cut: fit.cut,
      fold: folded ? top + fit.height - (fit.cut ? 0 : Math.ceil(fit.height * PR.over)) : null
    };
  };
  var PR_CSS = \`
.prchip { flex: none; border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; font: 12px/16px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink2); }
.state { flex: none; border-radius: 999px; padding: 2px 10px; font: 600 12px/16px ui-sans-serif, system-ui, sans-serif; }
main { padding: \${PR.pad}px \${PR.pad}px 0; }
.title { font: 600 20px/\${PR.titleLine}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.title code { padding: .1em .35em; font: 85% ui-monospace, SFMono-Regular, Menlo, monospace; background: rgb(129 139 152 / .12); border-radius: 6px; }
.meta { margin-top: 4px; height: 20px; color: var(--ink2); font-size: 12.5px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.unpinned { height: \${PR.unpinned}px; line-height: \${PR.unpinned}px; font-size: 12.5px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rule { margin: 16px 0; border: 0; height: 1px; background: var(--line); }
\`;
  var CLOSE_ROOM = 56;
  var READ_ALL_CSS = \`
html { overflow: auto; overscroll-behavior: contain; }
body { height: auto; overflow: visible; }
header { position: sticky; top: 0; z-index: 1; padding-right: \${CLOSE_ROOM}px; }
.r { height: auto; min-height: \${CARD.row}px; white-space: pre-wrap; }
.r > code { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; user-select: text; }
.r:hover { box-shadow: inset 0 0 0 999px var(--hover); }
.fold, .gap { padding-left: 14px; }
\`;

  // src/lib/curve.ts
  var catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - 3 * p2 + p3 - p0) * t3);
  };
  var catmullRomSpline = (waypoints, steps = 20) => {
    const n = waypoints.length;
    if (n <= 2) return waypoints.map((p) => ({ x: p.x, y: p.y }));
    const out2 = [];
    for (let i2 = 0; i2 < n - 1; i2++) {
      const p0 = waypoints[Math.max(0, i2 - 1)];
      const p1 = waypoints[i2];
      const p2 = waypoints[i2 + 1];
      const p3 = waypoints[Math.min(n - 1, i2 + 2)];
      for (let s = 0; s <= (i2 === n - 2 ? steps : steps - 1); s++) {
        const t = s / steps;
        out2.push({ x: catmullRom(p0.x, p1.x, p2.x, p3.x, t), y: catmullRom(p0.y, p1.y, p2.y, p3.y, t) });
      }
    }
    return out2;
  };
  var smoothstep = (s) => s * s * (3 - 2 * s);
  var segmentHits = (a, b2, r) => {
    const dx = b2.x - a.x;
    const dy = b2.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q2 = [a.x - r.x, r.x + r.width - a.x, a.y - r.y, r.y + r.height - a.y];
    let t0 = 0;
    let t1 = 1;
    for (let i2 = 0; i2 < 4; i2++) {
      if (p[i2] === 0) {
        if (q2[i2] < 0) return false;
        continue;
      }
      const t = q2[i2] / p[i2];
      if (p[i2] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
    return true;
  };
  var inflate = (r, by) => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });
  var pathHits = (path, r) => {
    for (let i2 = 1; i2 < path.length; i2++) if (segmentHits(path[i2 - 1], path[i2], r)) return true;
    return false;
  };
  var pathClears = (path, boxes, pad) => boxes.every((r) => !pathHits(path, inflate(r, pad)));
  var nearRun = (a, b2, within, ends = [], skip = 0) => {
    const chunks = chunksOf(b2);
    let run2 = 0;
    for (let i2 = 1; i2 < a.length; i2++) {
      const p = a[i2];
      if (ends.some((e) => Math.hypot(e.x - p.x, e.y - p.y) <= skip)) continue;
      const near = chunks.some(
        (c) => p.x >= c.x0 - within && p.x <= c.x1 + within && p.y >= c.y0 - within && p.y <= c.y1 + within && distanceToPath(p, b2.slice(c.from - 1, c.to)) < within
      );
      if (near) run2 += Math.hypot(p.x - a[i2 - 1].x, p.y - a[i2 - 1].y);
    }
    return run2;
  };
  var distanceToSegment = (p, a, b2) => {
    const dx = b2.x - a.x;
    const dy = b2.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  var distanceToPath = (p, path) => {
    if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
    let best = Infinity;
    for (let i2 = 1; i2 < path.length; i2++) best = Math.min(best, distanceToSegment(p, path[i2 - 1], path[i2]));
    return best;
  };
  var CHUNK = 16;
  var chunksOf = (path) => {
    const out2 = [];
    for (let from = 1; from < path.length; from += CHUNK) {
      const to = Math.min(path.length, from + CHUNK);
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i2 = from - 1; i2 < to; i2++) {
        x0 = Math.min(x0, path[i2].x);
        x1 = Math.max(x1, path[i2].x);
        y0 = Math.min(y0, path[i2].y);
        y1 = Math.max(y1, path[i2].y);
      }
      out2.push({ from, to, x0, x1, y0, y1 });
    }
    return out2;
  };
  var crossings = (a, b2, near = [], radius = 0) => {
    const cross = (p, q2, r) => (q2.x - p.x) * (r.y - p.y) - (q2.y - p.y) * (r.x - p.x);
    const [ca, cb] = [chunksOf(a), chunksOf(b2)];
    let n = 0;
    for (const u of ca)
      for (const v2 of cb) {
        if (u.x1 < v2.x0 || v2.x1 < u.x0 || u.y1 < v2.y0 || v2.y1 < u.y0) continue;
        for (let i2 = u.from; i2 < u.to; i2++) {
          const [p1, p2] = [a[i2 - 1], a[i2]];
          for (let j2 = v2.from; j2 < v2.to; j2++) {
            const [q1, q2] = [b2[j2 - 1], b2[j2]];
            const d1 = cross(q1, q2, p1);
            const d2 = cross(q1, q2, p2);
            if (!(d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0)) continue;
            const d3 = cross(p1, p2, q1);
            const d4 = cross(p1, p2, q2);
            if (!(d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0)) continue;
            const t = d1 / (d1 - d2);
            const at2 = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
            if (!near.some((e) => Math.hypot(e.x - at2.x, e.y - at2.y) <= radius)) n++;
          }
        }
      }
    return n;
  };

  // src/lib/layout.ts
  var LAYOUT = {
    /** Room kept between any two cards or labels, and between a string and any card or label but its own two cards. */
    clearance: 8,
    /** Next card in a column: its top at least this far below the previous card's bottom. */
    stack: 48,
    columnGap: 160,
    /**
     * Roomier boards, tried in turn while strings can't find their way: a wider gap between columns gives a string
     * room to climb, a taller one between stacked cards a second lane through it.
     */
    roomier: [
      { gap: 240, stack: 48 },
      { gap: 240, stack: 58 }
    ],
    /** From the lowest card of one band, the row under it included, to the top of the next band or the bottom row. */
    bandGap: 96,
    /** From a band's lowest card to the top of the row under it. */
    underGap: 72,
    /** How far below its band's top a card may go to sit level with the row that calls it: about one card. */
    maxDrop: 400,
    restSpacing: 48,
    /** Room for a string and its label between a bottom-row card and the test right after it. */
    restTestSpacing: 160,
    minRowWidth: 2800,
    /** \`flat\`: from a flat string to its label's near edge; \`steep\`: from a steep one. */
    label: { size: 16, height: 22, flat: 6, steep: 10 },
    /** A string meets a card's side at its header's middle. */
    header: CARD.header / 2,
    /** How far a string across hangs at its middle: \`share\` of its length, no less than \`min\` and no more than \`max\`. */
    sag: { share: 0.08, min: 20, max: 48 },
    /** A string may run closer than \`near\` to a card's edge, its own cards' too, for less than \`run\`: any longer and it reads as the card's border. */
    hug: { near: 24, run: 120 },
    /**
     * R1' through columns: a lane at least \`hug.near\` clear of the cards on either side of its gap, or \`off\` above or below
     * a column, at most \`reach\` off the straight line; strings in one gap \`lane\` apart; the course level \`margin\` beyond each
     * column's edges, a bend every \`step\`.
     */
    detour: { off: 24, reach: 320, lane: 10, margin: 16, step: 64 },
    /** Strings of one kind into one card, at most: the nearest ones. */
    fanIn: 3,
    /** Strings that run within \`near\` of each other for \`run\` or more count as close when colours are handed out. */
    colour: { near: 12, run: 60 },
    /** Passes that reorder each column by where its cards' links pull them from both sides. */
    sweeps: 4,
    /** A back link runs over both cards: its outer bends \`lead\` above the higher card's top, its middle \`top\` above. */
    back: { lead: 48, top: 60 }
  };
  var STRING_COLOURS = ["#9163d5", "#da7f00", "#009E73", "#0072B2", "#CC79A7", "#a79300", "#D55E00", "#29a1c1"];
  var textWidth = (text, fontSize) => Math.ceil([...text].length * fontSize * 0.56) + 4;
  var union = (rects) => {
    const x2 = Math.min(...rects.map((r) => r.x));
    const y2 = Math.min(...rects.map((r) => r.y));
    return {
      x: x2,
      y: y2,
      width: Math.max(...rects.map((r) => r.x + r.width)) - x2,
      height: Math.max(...rects.map((r) => r.y + r.height)) - y2
    };
  };
  var textRect = (t) => ({ x: t.x, y: t.y, width: t.width, height: t.height });
  var right = (r) => r.x + r.width;
  var bottom = (r) => r.y + r.height;
  var overlaps = (a, b2) => a.x < right(b2) && b2.x < right(a) && a.y < bottom(b2) && b2.y < bottom(a);
  var pathRect = (path) => union(path.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
  var colourStrings = (strings, order) => {
    const { near, run: run2 } = LAYOUT.colour;
    const cards = sortBy([...new Set(strings.map((s) => s.from.pin))], (pin) => order.indexOf(pin));
    const same = (p, q2) => Math.abs(p.x - q2.x) < 0.5 && Math.abs(p.y - q2.y) < 0.5;
    const clash = (a, b2) => {
      const shared = [a.start, a.end].filter((p) => same(p, b2.start) || same(p, b2.end));
      return shared.length > 0 || stringCrossings(a, b2) > 0 || nearRun(a.path, b2.path, near) >= run2;
    };
    const neighbours = new Map(cards.map((pin) => [pin, /* @__PURE__ */ new Set()]));
    strings.forEach(
      (a, i2) => strings.slice(i2 + 1).forEach((b2) => {
        if (a.from.pin === b2.from.pin || !clash(a, b2)) return;
        neighbours.get(a.from.pin).add(b2.from.pin);
        neighbours.get(b2.from.pin).add(a.from.pin);
      })
    );
    const colour = /* @__PURE__ */ new Map();
    for (const pin of sortBy(cards, (p) => -neighbours.get(p).size, (p) => order.indexOf(p))) {
      const taken = [...neighbours.get(pin)].flatMap((n) => colour.has(n) ? [colour.get(n)] : []);
      const free = STRING_COLOURS.findIndex((_2, i2) => !taken.includes(i2));
      colour.set(pin, free >= 0 ? free : sortBy(STRING_COLOURS.map((_2, i2) => i2), (i2) => taken.filter((t) => t === i2).length)[0]);
    }
    return new Map(strings.map((s) => [s.link, STRING_COLOURS[colour.get(s.from.pin)]]));
  };
  var styleOf = (l3, review) => ({
    color: STRING_COLOURS[0],
    width: 2,
    dash: review.pins.some((p) => p.kind === "context" && (p.id === l3.from || p.id === l3.to)) ? "dashed" : "solid"
  });
  var rolesOf = /* @__PURE__ */ new WeakMap();
  var laneRank = (pin, files) => {
    let roles = rolesOf.get(files);
    if (!roles) {
      roles = /* @__PURE__ */ new Map();
      for (const f2 of files) if (!roles.has(f2.path)) roles.set(f2.path, f2.role);
      rolesOf.set(files, roles);
    }
    const role = (pin.path === void 0 ? void 0 : roles.get(pin.path)) ?? "code";
    return [role === "generated" ? 2 : role === "docs" || role === "config" ? 1 : 0, pin.path ?? "", pin.from];
  };
  var FLOW_KINDS = ["calls", "uses", "imports"];
  var S2 = smoothstep;
  var SPLINE_STEPS = 20;
  var STAGES = [0.25, 0.5, 0.75];
  var acrossBends = (a, b2, level = false) => {
    const d = { x: b2.x - a.x, y: b2.y - a.y };
    const { share, min, max } = LAYOUT.sag;
    const sag = Math.min(max, Math.max(min, Math.hypot(d.x, d.y) * share));
    return STAGES.map((s) => ({ x: a.x + d.x * s, y: a.y + d.y * (level ? S2(s) : s) + sag * 4 * s * (1 - s) }));
  };
  var upBends = (a, b2) => STAGES.map((s) => ({ x: a.x + (b2.x - a.x) * S2(s), y: a.y + (b2.y - a.y) * s }));
  var mainAxis = (route) => route === "R2" ? "y" : "x";
  var hooks = (route, path, start2, end) => {
    const axis = mainAxis(route);
    const lo = Math.min(start2[axis], end[axis]) - 2;
    const hi = Math.max(start2[axis], end[axis]) + 2;
    return path.some((p) => p[axis] < lo || p[axis] > hi);
  };
  var stringPath = (start2, bend, end) => catmullRomSpline([start2, ...bend, end], SPLINE_STEPS);
  var hugs = (path, r) => {
    const [tl, tr, br, bl] = [
      { x: r.x, y: r.y },
      { x: right(r), y: r.y },
      { x: right(r), y: bottom(r) },
      { x: r.x, y: bottom(r) }
    ];
    return [[tl, bl], [tr, br], [tl, tr], [bl, br]].some((edge) => nearRun(path, edge, LAYOUT.hug.near) >= LAYOUT.hug.run);
  };
  var MEET = 24;
  var stringCrossings = (a, b2) => {
    const same = (p, q2) => Math.abs(p.x - q2.x) < 0.5 && Math.abs(p.y - q2.y) < 0.5;
    const shared = [a.start, a.end].filter((p) => same(p, b2.start) || same(p, b2.end));
    return crossings(a.path, b2.path, shared, MEET);
  };
  var columnsOf = (rects) => {
    const columns = [];
    for (const r of sortBy(rects, (r2) => r2.x)) {
      const last = columns[columns.length - 1];
      if (last && r.x < last.hi) {
        last.hi = Math.max(last.hi, right(r));
        last.cards.push(r);
      } else columns.push({ lo: r.x, hi: right(r), cards: [r] });
    }
    return columns.map((c) => ({ ...c, cards: sortBy(c.cards, (r) => r.y) }));
  };
  var laneSlots = (column) => {
    const { off, lane } = LAYOUT.detour;
    const ys = [];
    column.slice(1).forEach((r, i2) => {
      const room = r.y - bottom(column[i2]);
      const middle = (bottom(column[i2]) + r.y) / 2;
      for (const k2 of [0, 1, -1, 2, -2]) if (room / 2 - Math.abs(k2 * lane) >= LAYOUT.hug.near) ys.push(middle + k2 * lane);
    });
    for (let k2 = 0; k2 < 4; k2++) ys.push(column[0].y - off - k2 * lane, bottom(column[column.length - 1]) + off + k2 * lane);
    return ys.map((y2) => Math.round(y2));
  };
  var throughBends = (a, b2, columns) => {
    const { margin, step } = LAYOUT.detour;
    const course = [a];
    const leg = (p, q2, level) => {
      for (let x2 = p.x + 4; x2 < q2.x; x2 += 4) {
        const s = (x2 - p.x) / (q2.x - p.x);
        course.push({ x: x2, y: p.y + (q2.y - p.y) * (level ? smoothstep(s) : s) });
      }
      course.push(q2);
    };
    let at2 = a;
    columns.forEach((c, i2) => {
      leg(at2, { x: c.lo - margin, y: c.y }, i2 > 0);
      at2 = { x: c.hi + margin, y: c.y };
      course.push(at2);
    });
    leg(at2, b2, false);
    const length = course.slice(1).reduce((n, p, i2) => n + Math.hypot(p.x - course[i2].x, p.y - course[i2].y), 0);
    const count2 = Math.max(3, Math.round(length / step) - 1);
    const bends = [];
    let walked = 0;
    for (let i2 = 1, k2 = 1; i2 < course.length && k2 <= count2; i2++) {
      const [p, q2] = [course[i2 - 1], course[i2]];
      const d = Math.hypot(q2.x - p.x, q2.y - p.y);
      while (k2 <= count2 && walked + d >= k2 * length / (count2 + 1)) {
        const t = (k2 * length / (count2 + 1) - walked) / (d || 1);
        bends.push({ x: p.x + (q2.x - p.x) * t, y: p.y + (q2.y - p.y) * t });
        k2++;
      }
      walked += d;
    }
    return bends;
  };
  var planBoard = (review) => {
    const tangle = (plan) => plan.strings.reduce((n, s, i2) => n + plan.strings.slice(i2 + 1).reduce((m2, o) => m2 + stringCrossings(s, o), 0), 0);
    let best = planWith(review, LAYOUT.columnGap, LAYOUT.stack);
    for (const { gap, stack } of LAYOUT.roomier) {
      if (best.undrawn.length === 0) break;
      const roomier = planWith(review, gap, stack);
      if (roomier.undrawn.length < best.undrawn.length || roomier.undrawn.length === best.undrawn.length && tangle(roomier) < tangle(best)) best = roomier;
    }
    return best;
  };
  var planWith = (review, gap, stack) => {
    const L2 = LAYOUT;
    const pinOf = (id) => review.pins.find((p) => p.id === id);
    const cards = new Map(review.pins.filter((p) => p.kind !== "pr").map((p) => [p.id, pinCard(p, review)]));
    const prSize = prCard(review);
    const sizeOf = (id) => {
      const { width, height } = id === "pr" ? prSize : cards.get(id);
      return { width, height };
    };
    const placed = /* @__PURE__ */ new Map();
    const order = [];
    const lowest = () => Math.max(0, ...[...placed.values()].map(bottom));
    const widest = () => Math.max(0, ...[...placed.values()].map(right));
    const place2 = (id, x2, y2, width = sizeOf(id).width) => placed.set(id, { x: Math.round(x2), y: Math.round(y2), width, height: sizeOf(id).height });
    const othersThan = (...ids) => [...placed].filter(([id]) => !ids.includes(id)).map(([, r]) => r);
    const clear = (c) => {
      const path = stringPath(c.start, c.bend, c.end);
      return !hooks(c.route, path, c.start, c.end) && pathClears(path, othersThan(c.from.pin, c.to.pin), L2.clearance) && ![...placed.values()].some((r) => hugs(path, r));
    };
    const end = (pin, r, p) => ({ pin, anchorX: (p.x - r.x) / r.width, anchorY: (p.y - r.y) / r.height });
    const topMiddle = (r) => ({ x: r.x + r.width / 2, y: r.y });
    const bottomMiddle = (r) => ({ x: r.x + r.width / 2, y: bottom(r) });
    const vertical = (l3, A2, B2) => {
      const up = bottom(B2) <= A2.y;
      const a = up ? topMiddle(A2) : bottomMiddle(A2);
      const b2 = up ? bottomMiddle(B2) : topMiddle(B2);
      return { route: "R2", from: end(l3.from, A2, a), to: end(l3.to, B2, b2), start: a, end: b2, bend: upBends(a, b2) };
    };
    const lanes = /* @__PURE__ */ new Set();
    const across = (l3, A2, B2) => {
      const a = { x: right(A2), y: A2.y + rowMiddle(cards.get(l3.from)?.anchors[l3.id] ?? -1) };
      const b2 = { x: B2.x, y: B2.y + L2.header };
      const ends = { from: end(l3.from, A2, a), to: end(l3.to, B2, b2), start: a, end: b2 };
      const direct = { route: "R1", ...ends, bend: acrossBends(a, b2) };
      const level = { route: "R1", ...ends, bend: acrossBends(a, b2, true) };
      const others = othersThan(l3.from, l3.to).filter((r) => r.x > a.x && right(r) < b2.x);
      if (!others.some((r) => pathHits(stringPath(a, direct.bend, b2), inflate(r, L2.clearance)))) return [direct, level];
      const lineY = (x2) => a.y + (b2.y - a.y) * (x2 - a.x) / (b2.x - a.x || 1);
      const columns = columnsOf(others).map((column) => {
        const ideal = lineY((column.lo + column.hi) / 2);
        const slots = laneSlots(column.cards).filter((y2) => !lanes.has(\`\${column.lo}:\${y2}\`) && Math.abs(y2 - ideal) <= L2.detour.reach);
        return { ...column, ideal, slots: sortBy(slots, (y2) => Math.abs(y2 - ideal)) };
      });
      if (columns.some((c) => c.slots.length === 0)) return [direct, level];
      const picks = [
        (c) => c.slots[0],
        (c) => c.slots.find((y2) => y2 <= c.ideal) ?? c.slots[0],
        (c) => c.slots.find((y2) => y2 >= c.ideal) ?? c.slots[0]
      ];
      const routes = picks.map((pick) => {
        const through = columns.map((c) => ({ lo: c.lo, hi: c.hi, y: pick(c) }));
        return { route: "R1'", ...ends, bend: throughBends(a, b2, through), lanes: through.map((t) => \`\${t.lo}:\${t.y}\`) };
      });
      return [direct, level, ...uniqBy(routes, (r) => r.lanes.join(" "))];
    };
    const back = (l3, A2, B2) => ["over", "under"].map((side) => {
      const a = side === "over" ? topMiddle(A2) : bottomMiddle(A2);
      const b2 = side === "over" ? topMiddle(B2) : bottomMiddle(B2);
      const sign = side === "over" ? -1 : 1;
      const edge = side === "over" ? Math.min(A2.y, B2.y) : Math.max(bottom(A2), bottom(B2));
      const inward = Math.sign(b2.x - a.x) * Math.abs(b2.x - a.x) / 8;
      const bend = [
        { x: a.x + inward, y: edge + sign * L2.back.lead },
        { x: (a.x + b2.x) / 2, y: edge + sign * L2.back.top },
        { x: b2.x - inward, y: edge + sign * L2.back.lead }
      ];
      return { route: "R4", from: end(l3.from, A2, a), to: end(l3.to, B2, b2), start: a, end: b2, bend };
    });
    const flat = (l3, A2, B2) => {
      const a = { x: A2.x, y: A2.y + L2.header };
      const b2 = { x: right(B2), y: B2.y + L2.header };
      return { route: "R3", from: end(l3.from, A2, a), to: end(l3.to, B2, b2), start: a, end: b2, bend: acrossBends(a, b2) };
    };
    const routesOf = (l3) => {
      const A2 = placed.get(l3.from);
      const B2 = placed.get(l3.to);
      const low = pinOf(l3.from).lane !== "flow";
      if (low && bottom(B2) <= A2.y - L2.clearance) return [vertical(l3, A2, B2), ...B2.x >= right(A2) + L2.clearance ? across(l3, A2, B2) : []];
      if (B2.x >= right(A2) + L2.clearance) return across(l3, A2, B2);
      if (low && B2.y >= bottom(A2) + L2.clearance) return [vertical(l3, A2, B2)];
      if (l3.kind === "tests" && A2.y === B2.y && right(B2) < A2.x) return [flat(l3, A2, B2)];
      return back(l3, A2, B2);
    };
    review.bands.forEach((_2, b2) => {
      const members = review.pins.filter((p) => p.lane === "flow" && p.band === b2 && (p.kind !== "pr" || b2 === 0)).map((p) => p.id);
      const floor = b2 === 0 ? 0 : lowest() + L2.bandGap;
      const columns = /* @__PURE__ */ new Map();
      for (const id of members) {
        const c = pinOf(id).column;
        columns.set(c, [...columns.get(c) ?? [], id]);
      }
      const keys = [...columns.keys()].sort((x2, y2) => x2 - y2);
      const width = new Map(keys.map((c) => [c, Math.max(...columns.get(c).map((id) => sizeOf(id).width))]));
      const left = /* @__PURE__ */ new Map();
      let cursor = 0;
      for (const c of keys) {
        left.set(c, cursor);
        cursor += width.get(c) + gap;
      }
      const columnOf = (id) => pinOf(id).column;
      const ties = review.links.filter((l3) => FLOW_KINDS.includes(l3.kind) && members.includes(l3.from) && members.includes(l3.to) && columnOf(l3.from) !== columnOf(l3.to));
      const startOf = (l3) => rowMiddle(cards.get(l3.from)?.anchors[l3.id] ?? -1);
      const topsFor = (orders2) => {
        const top2 = /* @__PURE__ */ new Map();
        const level = (id) => {
          const levels = ties.filter((l3) => l3.to === id && columnOf(l3.from) < columnOf(id) && top2.has(l3.from)).map((l3) => top2.get(l3.from) + startOf(l3) - L2.header);
          const middle = levels.reduce((a, y2) => a + y2, 0) / Math.max(1, levels.length);
          return sortBy(
            levels.filter((y2) => y2 <= L2.maxDrop),
            (y2) => Math.abs(y2 - middle)
          )[0] ?? 0;
        };
        for (const c of keys) {
          let previous = -Infinity;
          for (const id of orders2.get(c)) {
            const wanted = level(id);
            const t = Math.max(wanted, previous + stack);
            top2.set(id, t);
            previous = t + sizeOf(id).height;
          }
        }
        return top2;
      };
      const pull = (id, top2, sides) => {
        const wants = ties.flatMap((l3) => {
          if (l3.to === id && (sides === "both" || columnOf(l3.from) < columnOf(id))) return [top2.get(l3.from) + startOf(l3) - L2.header];
          if (l3.from === id && sides === "both") return [top2.get(l3.to) + L2.header - startOf(l3)];
          return [];
        });
        return wants.length === 0 ? null : wants.reduce((a, y2) => a + y2, 0) / wants.length;
      };
      const tangles = (top2) => {
        const lines = ties.map((l3) => [
          { x: left.get(columnOf(l3.from)) + width.get(columnOf(l3.from)), y: top2.get(l3.from) + startOf(l3) },
          { x: left.get(columnOf(l3.to)), y: top2.get(l3.to) + L2.header }
        ]);
        return lines.reduce((n, a, i2) => n + lines.slice(i2 + 1).reduce((m2, b3) => m2 + crossings(a, b3), 0), 0);
      };
      const byPath = (ids) => sortBy(ids, (id) => id === "pr" ? 0 : 1, (id) => pinOf(id).path ?? "", (id) => pinOf(id).from);
      const sorted = (ids, key, fallback) => sortBy(ids, (id) => id === "pr" ? 0 : 1, (id) => key(id) ?? fallback.get(id) ?? 0, (id) => fallback.get(id) ?? 0);
      let orders = new Map(keys.map((c) => [c, byPath(columns.get(c))]));
      const first = /* @__PURE__ */ new Map();
      for (const c of keys) {
        const sofar = topsFor(orders);
        orders.set(c, sorted(orders.get(c), (id) => pull(id, sofar, "left"), first));
        for (const [id, t] of topsFor(orders)) first.set(id, t);
      }
      let top = topsFor(orders);
      let best = { orders, top, tangles: tangles(top) };
      for (let sweep = 0; sweep < L2.sweeps && best.tangles > 0; sweep++) {
        orders = new Map(keys.map((c) => [c, sorted(orders.get(c), (id) => pull(id, top, "both"), top)]));
        top = topsFor(orders);
        const n = tangles(top);
        if (n < best.tangles) best = { orders, top, tangles: n };
      }
      top = best.top;
      const bandOrder = keys.flatMap((c) => best.orders.get(c));
      const dy = floor - Math.min(...bandOrder.map((id) => top.get(id)));
      for (const id of bandOrder) place2(id, left.get(columnOf(id)), top.get(id) + dy, columnOf(id) === 0 ? sizeOf(id).width : width.get(columnOf(id)));
      order.push(...bandOrder);
      const under = review.pins.filter((p) => p.lane === "under" && p.band === b2);
      if (under.length === 0) return;
      const cardTop = lowest() + L2.underGap;
      const coveredBy = (p) => sortBy(review.links.filter((l3) => l3.from === p.id && members.includes(l3.to)).map((l3) => placed.get(l3.to)), (r) => r.x);
      const centredUnder = (p, xs) => xs.reduce((a, x2) => a + x2, 0) / Math.max(1, xs.length) - sizeOf(p.id).width / 2;
      const wantedX = (p) => centredUnder(p, coveredBy(p).map((r) => r.x + r.width / 2));
      const reaches = (p, target) => {
        const card = placed.get(p.id);
        const a = topMiddle(card);
        const z2 = bottomMiddle(target);
        return a.y > z2.y && pathClears(stringPath(a, upBends(a, z2), z2), othersThan(p.id).filter((r) => r !== target), L2.clearance);
      };
      let edge = -Infinity;
      for (const p of sortBy(under, wantedX, (p2) => p2.path ?? "")) {
        const covered = coveredBy(p);
        const spots = [wantedX(p), ...covered.map((r) => centredUnder(p, [r.x + r.width / 2]))].map((x3) => Math.max(0, x3, edge + L2.restSpacing));
        const x2 = spots.find((x3) => {
          place2(p.id, x3, cardTop);
          return covered.some((r) => reaches(p, r));
        }) ?? spots[0];
        place2(p.id, x2, cardTop);
        order.push(p.id);
        edge = x2 + sizeOf(p.id).width;
      }
    });
    if (review.bands.length === 0) {
      place2("pr", 0, 0);
      order.push("pr");
    }
    const rest = review.pins.filter((p) => p.lane === "rest");
    if (rest.length > 0) {
      const ranked = sortBy(
        rest,
        (p) => laneRank(p, review.files)[0],
        (p) => laneRank(p, review.files)[1],
        (p) => laneRank(p, review.files)[2]
      );
      const covers = (t) => review.links.find((l3) => l3.from === t.id && l3.kind === "tests" && rest.some((p) => p.id === l3.to))?.to;
      const sequence = [];
      for (const p of ranked) {
        if (p.kind === "test" && covers(p)) continue;
        sequence.push(p, ...ranked.filter((t) => t.kind === "test" && covers(t) === p.id));
      }
      const rowWidth2 = Math.max(L2.minRowWidth, widest());
      let x2 = 0;
      let rowTop = lowest() + L2.bandGap;
      let rowBottom = rowTop;
      sequence.forEach((p, i2) => {
        const size = sizeOf(p.id);
        const gap2 = i2 > 0 && p.kind === "test" && covers(p) === sequence[i2 - 1].id ? L2.restTestSpacing : L2.restSpacing;
        if (i2 > 0 && x2 + gap2 + size.width > rowWidth2) {
          rowTop = rowBottom + L2.restSpacing;
          x2 = 0;
        } else if (i2 > 0) x2 += gap2;
        place2(p.id, x2, rowTop);
        rowBottom = Math.max(rowBottom, rowTop + size.height);
        x2 += size.width;
        order.push(p.id);
      });
    }
    const rank = (id) => order.indexOf(id);
    const distance = (l3) => {
      const [A2, B2] = [placed.get(l3.from), placed.get(l3.to)];
      return Math.hypot(A2.x + A2.width / 2 - B2.x - B2.width / 2, A2.y + A2.height / 2 - B2.y - B2.height / 2);
    };
    const links = sortBy(
      review.links.filter((l3) => placed.has(l3.from) && placed.has(l3.to)),
      distance,
      (l3) => rank(l3.from),
      (l3) => rank(l3.to)
    );
    const groups = /* @__PURE__ */ new Map();
    for (const l3 of links) groups.set(\`\${l3.to} \${l3.kind}\`, [...groups.get(\`\${l3.to} \${l3.kind}\`) ?? [], l3]);
    const crowd = new Set([...groups.values()].flatMap((group) => sortBy(group, distance).slice(L2.fanIn).map((l3) => l3.id)));
    const strings = [];
    const undrawn = [];
    const tangle = { curved: 0, straight: 0 };
    for (const l3 of links) {
      if (crowd.has(l3.id)) {
        undrawn.push(l3.id);
        continue;
      }
      const crossed = (c) => {
        const path = stringPath(c.start, c.bend, c.end);
        return strings.reduce((n, o) => n + stringCrossings({ ...c, path }, o), 0);
      };
      const straight = (c) => strings.reduce((n, o) => n + crossings([c.start, c.end], [o.start, o.end]), 0);
      const clearRoutes = routesOf(l3).filter(clear);
      const found = clearRoutes.length <= 1 ? clearRoutes[0] : sortBy(clearRoutes, crossed)[0];
      if (!found || tangle.curved + crossed(found) > tangle.straight + straight(found)) {
        undrawn.push(l3.id);
        continue;
      }
      const { lanes: taken = [], ...route } = found;
      taken.forEach((lane) => lanes.add(lane));
      tangle.curved += crossed(found);
      tangle.straight += straight(found);
      strings.push({ link: l3.id, kind: l3.kind, ...route, path: stringPath(found.start, found.bend, found.end), label: null, style: styleOf(l3, review) });
    }
    const labels = [];
    for (const s of strings) {
      const text = wordOf(review.links.find((l3) => l3.id === s.link));
      const w = textWidth(text, L2.label.size);
      const h = L2.label.height;
      const boxes = [...placed.values(), ...labels.map(textRect)];
      const others = strings.filter((o) => o !== s);
      const besideBend = (i2) => {
        const [before, middle2, after] = [s.bend[i2 - 1], s.bend[i2], s.bend[i2 + 1]];
        const at2 = (i2 + 1) * SPLINE_STEPS;
        const near = (lo, hi, axis) => {
          const inside = (k2) => k2 >= 0 && k2 < s.path.length && s.path[k2][axis] >= lo - 2 && s.path[k2][axis] <= hi + 2;
          let first = at2;
          let last = at2;
          while (inside(first - 1)) first--;
          while (inside(last + 1)) last++;
          return s.path.slice(first, last + 1);
        };
        const spots = [];
        if (Math.abs(after.y - before.y) > Math.abs(after.x - before.x)) {
          const y2 = middle2.y - h / 2;
          const xs = near(y2, y2 + h, "y").map((p) => p.x);
          spots.push({ x: Math.max(middle2.x, ...xs) + L2.label.steep, y: y2 }, { x: Math.min(middle2.x, ...xs) - L2.label.steep - w, y: y2 });
        } else {
          const x2 = middle2.x - w / 2;
          const ys = near(x2, x2 + w, "x").map((p) => p.y);
          spots.push({ x: x2, y: Math.min(middle2.y, ...ys) - L2.label.flat - h }, { x: x2, y: Math.max(middle2.y, ...ys) + L2.label.flat });
        }
        return spots.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), text, fontSize: L2.label.size, width: w, height: h }));
      };
      const middle = (s.bend.length - 1) / 2;
      const bends = sortBy(
        s.bend.map((_2, i2) => i2).filter((i2) => i2 > 0 && i2 < s.bend.length - 1),
        (i2) => Math.abs(i2 - middle)
      );
      const found = bends.flatMap(besideBend).find((t) => {
        const r = textRect(t);
        const padded = inflate(r, L2.clearance);
        return boxes.every((b2) => !overlaps(padded, b2)) && others.every((o) => !pathHits(o.path, padded)) && !pathHits(s.path, inflate(r, 2));
      });
      if (!found) continue;
      s.label = found;
      labels.push(found);
    }
    const colours = colourStrings(strings, order);
    for (const s of strings) s.style = { ...s.style, color: colours.get(s.link) };
    return {
      pins: placed,
      cards,
      strings,
      undrawn,
      order,
      bounds: union([...placed.values(), ...labels.map(textRect), ...strings.map((s) => pathRect(s.path))])
    };
  };

  // src/lib/linker.ts
  var SAME_MEMBERS = /* @__PURE__ */ new Set(["Partial", "Required", "Readonly", "NonNullable", "Pick", "Omit"]);
  var COMPUTED = /* @__PURE__ */ new Set(["ReturnType", "Parameters", "ConstructorParameters", "Awaited", "ThisType", "ThisParameterType", "OmitThisParameter", "Extract", "Exclude", "Record", "InstanceType"]);
  var NONE = { units: [], shapes: [] };
  var unknown = (why) => ({ units: [], shapes: [], unknown: why });
  var merge = (...vs) => {
    const known = vs.filter((v2) => !v2.unknown);
    if (known.length === 0) return vs[0] ?? unknown("nothing");
    return {
      units: [...new Set(known.flatMap((v2) => v2.units))],
      shapes: known.flatMap((v2) => v2.shapes),
      ...known.find((v2) => v2.module) ? { module: known.find((v2) => v2.module).module } : {},
      ...vs.some((v2) => v2.unknown) ? { unknown: vs.find((v2) => v2.unknown).unknown } : {}
    };
  };
  var CODE_EXT = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
  var JS_EXT = /\\.(js|jsx|mjs|cjs)$/;
  var dirOf = (path) => path.split("/").slice(0, -1).join("/");
  var joinPath = (dir, rel) => {
    const parts2 = dir ? dir.split("/") : [];
    for (const seg of rel.split("/")) {
      if (seg === "..") parts2.pop();
      else if (seg !== "." && seg !== "") parts2.push(seg);
    }
    return parts2.join("/");
  };
  var moduleCandidates = (from, spec, paths) => {
    const expand = (base) => {
      const out3 = [];
      if (CODE_EXT.some((e) => base.endsWith(e))) out3.push(base);
      if (JS_EXT.test(base)) {
        const stem = base.replace(JS_EXT, "");
        out3.push(\`\${stem}.ts\`, \`\${stem}.tsx\`, \`\${stem}.mts\`, \`\${stem}.cts\`, \`\${stem}.d.ts\`);
      }
      for (const e of CODE_EXT) out3.push(\`\${base}\${e}\`);
      for (const e of CODE_EXT) out3.push(\`\${base}/index\${e}\`);
      return [...new Set(out3)];
    };
    if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") return { candidates: expand(joinPath(dirOf(from), spec)), bare: false };
    if (spec.startsWith("/")) return { candidates: expand(spec.slice(1)), bare: false };
    const out2 = [];
    const sorted = [...paths].sort((a, b2) => b2.pattern.replace("*", "").length - a.pattern.replace("*", "").length);
    for (const m2 of sorted) {
      const star = m2.pattern.indexOf("*");
      let rest = null;
      if (star < 0) rest = spec === m2.pattern ? "" : null;
      else if (spec.startsWith(m2.pattern.slice(0, star)) && spec.endsWith(m2.pattern.slice(star + 1)) && spec.length >= m2.pattern.length - 1) rest = spec.slice(star, spec.length - (m2.pattern.length - star - 1));
      if (rest === null) continue;
      for (const target of m2.targets) out2.push(...expand(star < 0 ? target : target.replace("*", rest)));
    }
    return { candidates: [...new Set(out2)], bare: true };
  };
  var createProgram = (files, config) => {
    const byPath = new Map(files.map((f2) => [f2.path, f2]));
    const resolved = /* @__PURE__ */ new Map();
    const resolveModule = (from, spec) => {
      const key = \`\${from}\\0\${spec}\`;
      const hit = resolved.get(key);
      if (hit) return hit;
      const { candidates, bare } = moduleCandidates(from, spec, config.paths(from));
      const builtin = bare ? config.builtin(spec) : null;
      const path = candidates.find((c) => byPath.has(c)) ?? (builtin && byPath.has(builtin) ? builtin : void 0);
      const out2 = path ? { path } : { external: bare };
      resolved.set(key, out2);
      return out2;
    };
    const memo = /* @__PURE__ */ new Map();
    const memoOf = (f2) => {
      let m2 = memo.get(f2);
      if (!m2) memo.set(f2, m2 = /* @__PURE__ */ new Map());
      return m2;
    };
    const shapeOf = (f2, node) => f2.shapes.get(node);
    const unitByValue = /* @__PURE__ */ new Map();
    const unitOfValue = (f2, node) => {
      let m2 = unitByValue.get(f2);
      if (!m2) {
        m2 = /* @__PURE__ */ new Map();
        for (const u of f2.units) if (u.valueNode >= 0) m2.set(u.valueNode, u);
        unitByValue.set(f2, m2);
      }
      return m2.get(node);
    };
    const unitVal = (f2, u) => {
      const t = f2.flat;
      const own = { units: [u], shapes: [] };
      if (u.kind === "class") {
        const s = shapeOf(f2, u.valueNode);
        return s ? { units: [u], shapes: [{ shape: s, side: "static", file: f2 }] } : own;
      }
      if (u.kind === "function") {
        const s = shapeOf(f2, u.valueNode);
        return s ? { units: [u], shapes: [{ shape: s, side: "static", file: f2 }] } : own;
      }
      if (u.kind === "namespace") {
        const s = shapeOf(f2, u.valueNode);
        return s ? { units: [u], shapes: [{ shape: s, side: "static", file: f2 }] } : own;
      }
      if (u.kind === "type") {
        const s = shapeOf(f2, u.valueNode);
        if (s) return { units: [u], shapes: [{ shape: s, side: "instance", file: f2 }] };
        if (t.type[u.valueNode] === "type_alias_declaration") return { ...typeVal(f2, child(t, u.valueNode, "value")), units: [u] };
        return own;
      }
      if (u.kind === "value") {
        if (u.valueNode >= 0 && t.type[u.valueNode] === "object") {
          const s = shapeOf(f2, u.valueNode);
          return s ? { units: [u], shapes: [{ shape: s, side: "instance", file: f2 }] } : own;
        }
        const decl = t.type[u.node] === "variable_declarator" ? u.node : -1;
        if (decl >= 0) {
          const ty = child(t, decl, "type");
          const v2 = ty >= 0 ? typeVal(f2, namedChildren(t, ty)[0] ?? -1) : evalExpr(f2, child(t, decl, "value"));
          return { ...v2, units: [u] };
        }
        if (u.valueNode >= 0) return { ...evalExpr(f2, u.valueNode), units: [u] };
        return own;
      }
      return own;
    };
    const bindingMemo = /* @__PURE__ */ new Map();
    const bindingVal = (f2, b2) => {
      if (bindingMemo.has(b2)) return bindingMemo.get(b2) ?? unknown("cycle");
      bindingMemo.set(b2, null);
      const v2 = bindingUncached(f2, b2);
      bindingMemo.set(b2, v2);
      return v2;
    };
    const bindingUncached = (f2, b2) => {
      if (b2.kind === "import") {
        const entry = f2.imports.find((i2) => i2.node === b2.node || i2.local === b2.name);
        return entry ? importVal(f2, entry) : unknown("import");
      }
      if (b2.unit) return unitVal(f2, b2.unit);
      const t = f2.flat;
      if (b2.kind === "class") {
        const s = shapeOf(f2, b2.decl);
        return s ? { units: [], shapes: [{ shape: s, side: "static", file: f2 }] } : NONE;
      }
      if (b2.kind === "function") return NONE;
      if (b2.kind === "type") {
        const s = shapeOf(f2, b2.decl);
        if (s) return { units: [], shapes: [{ shape: s, side: "instance", file: f2 }] };
        if (t.type[b2.decl] === "type_alias_declaration") return typeVal(f2, child(t, b2.decl, "value"));
        return NONE;
      }
      if (b2.kind === "enum" || b2.kind === "namespace") return NONE;
      if (b2.kind === "typeparam") return unknown("type parameter");
      if (b2.typeNode >= 0 || b2.init >= 0) {
        let v2 = b2.typeNode >= 0 ? typeVal(f2, b2.typeNode) : evalExpr(f2, b2.init);
        for (const key of b2.path ?? []) {
          if (key === "..." || /^\\d+$/.test(key)) return unknown("destructured rest or array element");
          v2 = memberOf(v2, key).next;
        }
        return v2;
      }
      if (b2.kind === "param") return unknown("untyped parameter");
      if (b2.kind === "catch") return unknown("caught value");
      return unknown("variable without initializer");
    };
    const importVal = (f2, entry) => {
      const target = resolveModule(f2.path, entry.spec);
      if (!target.path) return target.external ? { ...NONE, external: \`package '\${entry.spec}'\` } : unknown(\`missing module '\${entry.spec}'\`);
      if (entry.imported === "*") return { units: [], shapes: [], module: target.path };
      if (entry.imported === "=") return moduleVal(target.path);
      const v2 = exportVal(target.path, entry.imported, /* @__PURE__ */ new Set());
      if (v2) return v2;
      if (entry.imported === "default") return moduleVal(target.path);
      return NONE;
    };
    const moduleVal = (path) => {
      const f2 = byPath.get(path);
      if (!f2) return unknown(\`unread module \${path}\`);
      if (f2.moduleExports >= 0) return evalExpr(f2, f2.moduleExports);
      const ns = { units: [], shapes: [], module: path };
      if (!f2.exports.some((e) => e.kind !== "star" && e.name === "default")) return ns;
      const d = exportVal(path, "default", /* @__PURE__ */ new Set());
      return d && !d.unknown ? { ...ns, shapes: d.shapes, units: [] } : ns;
    };
    const exportVal = (path, name2, seen) => {
      const key = \`\${path}\\0\${name2}\`;
      if (seen.has(key)) return null;
      seen.add(key);
      const f2 = byPath.get(path);
      if (!f2) return unknown(\`unread module \${path}\`);
      for (const e of f2.exports) {
        if (e.kind === "star" || e.name !== name2) continue;
        if (e.kind === "local") {
          const b2 = lookup(f2.module, e.local, VALUE | TYPE | NS);
          return b2 ? bindingVal(f2, b2) : NONE;
        }
        if (e.kind === "expr") return evalExpr(f2, e.value);
        if (e.kind === "reexport") {
          const target = resolveModule(path, e.spec);
          if (!target.path) return unknown(\`re-export from external '\${e.spec}'\`);
          return exportVal(target.path, e.imported, seen) ?? NONE;
        }
        if (e.kind === "namespace") {
          const target = resolveModule(path, e.spec);
          return target.path ? { units: [], shapes: [], module: target.path } : unknown(\`external '\${e.spec}'\`);
        }
      }
      if (name2 !== "default") {
        for (const e of f2.exports) {
          if (e.kind !== "star") continue;
          const target = resolveModule(path, e.spec);
          if (!target.path) continue;
          const v2 = exportVal(target.path, name2, seen);
          if (v2 && (v2.units.length > 0 || v2.shapes.length > 0 || v2.module || !v2.unknown)) return v2;
        }
      }
      if (f2.moduleExports >= 0) {
        const m2 = memberOf(evalExpr(f2, f2.moduleExports), name2);
        if (m2.found !== "no") return m2.next.unknown ? { ...m2.next, units: m2.units } : { ...m2.next, units: [.../* @__PURE__ */ new Set([...m2.units, ...m2.next.units])] };
      }
      return null;
    };
    const thisVal = (f2, node) => {
      const t = f2.flat;
      let prev = node;
      for (let a = t.parent[node]; a >= 0; prev = a, a = t.parent[a]) {
        const ty = t.type[a];
        if (ty === "arrow_function") continue;
        if (ty === "public_field_definition" || ty === "field_definition") {
          if (t.field[prev] !== "value") continue;
          const cls = classOfBody(t, t.parent[a]);
          const s = cls >= 0 ? shapeOf(f2, cls) : void 0;
          return s ? { units: [], shapes: [{ shape: s, side: tokensOf(t, a).includes("static") ? "static" : "instance", file: f2 }] } : unknown("this in a field");
        }
        if (ty === "class_static_block") {
          const cls = classOfBody(t, t.parent[a]);
          const s = cls >= 0 ? shapeOf(f2, cls) : void 0;
          return s ? { units: [], shapes: [{ shape: s, side: "static", file: f2 }] } : unknown("this in a static block");
        }
        if (ty === "method_definition") {
          const holder = t.parent[a];
          if (t.type[holder] === "object") {
            const s2 = shapeOf(f2, holder);
            return s2 ? { units: [], shapes: [{ shape: s2, side: "instance", file: f2 }] } : unknown("this in an object method");
          }
          const cls = classOfBody(t, holder);
          const s = cls >= 0 ? shapeOf(f2, cls) : void 0;
          const isStatic = tokensOf(t, a).includes("static");
          return s ? { units: [], shapes: [{ shape: s, side: isStatic ? "static" : "instance", file: f2 }] } : unknown("this in a method");
        }
        if (ty === "function_declaration" || ty === "generator_function_declaration") {
          const s = shapeOf(f2, a);
          return s ? { units: [], shapes: [{ shape: s, side: "instance", file: f2 }] } : unknown("this in a nested function");
        }
        if (ty === "function_expression" || ty === "function" || ty === "generator_function") {
          let ctx = a;
          while (t.parent[ctx] >= 0 && t.type[t.parent[ctx]] === "parenthesized_expression") ctx = t.parent[ctx];
          const p = t.parent[ctx];
          if (p >= 0 && t.type[p] === "pair") {
            const s = shapeOf(f2, t.parent[p]);
            return s ? { units: [], shapes: [{ shape: s, side: "instance", file: f2 }] } : unknown("this in an object function");
          }
          if (p >= 0 && t.type[p] === "assignment_expression" && t.field[ctx] === "right") {
            const lhs = child(t, p, "left");
            if (t.type[lhs] === "member_expression") {
              const obj = unwrap(t, child(t, lhs, "object"));
              const owner = protoOwner(f2, obj);
              if (owner) return asSide(owner, "instance");
              return evalExpr(f2, obj);
            }
          }
          if (p >= 0 && t.type[p] === "variable_declarator") {
            const s = shapeOf(f2, a);
            if (s) return { units: [], shapes: [{ shape: s, side: "instance", file: f2 }] };
          }
          return unknown("this in a function expression");
        }
        if (ty === "class_body" || ty === "program") break;
      }
      return unknown("top-level this");
    };
    const protoOwner = (f2, obj) => {
      const t = f2.flat;
      if (t.type[obj] === "identifier") {
        const owner = f2.protoAliases.get(textOf(t, obj));
        if (owner) {
          const b2 = lookup(f2.module, owner, VALUE);
          return b2 ? bindingVal(f2, b2) : null;
        }
        return null;
      }
      if (t.type[obj] === "member_expression" && propName(t, child(t, obj, "property")) === "prototype") return evalExpr(f2, unwrap(t, child(t, obj, "object")));
      return null;
    };
    const asSide = (v2, side) => ({
      units: [],
      shapes: v2.shapes.map((s) => ({ ...s, side: s.shape.kind === "class" || s.shape.kind === "function" ? side : s.side })),
      ...v2.unknown ? { unknown: v2.unknown } : {}
    });
    const typeMemo = /* @__PURE__ */ new Map();
    const typeVal = (f2, n) => {
      if (n < 0) return unknown("no type");
      let m2 = typeMemo.get(f2);
      if (!m2) typeMemo.set(f2, m2 = /* @__PURE__ */ new Map());
      if (m2.has(n)) return m2.get(n) ?? unknown("cycle");
      m2.set(n, null);
      const v2 = typeUncached(f2, n);
      m2.set(n, v2);
      return v2;
    };
    const typeUncached = (f2, n) => {
      const t = f2.flat;
      const ty = t.type[n];
      switch (ty) {
        case "type_annotation":
          return typeVal(f2, namedChildren(t, n)[0] ?? -1);
        case "parenthesized_type":
          return typeVal(f2, namedChildren(t, n)[0] ?? -1);
        case "type_identifier": {
          const scope = scopeAt(f2, n);
          const name2 = textOf(t, n);
          const b2 = lookup(scope, name2, TYPE);
          if (!b2) return COMPUTED.has(name2) || SAME_MEMBERS.has(name2) ? unknown(\`global type \${name2}\`) : { ...NONE, external: \`global type \${name2}\` };
          return asSide(bindingVal(f2, b2), "instance");
        }
        case "generic_type": {
          const name2 = child(t, n, "name");
          const nameText = name2 >= 0 ? textOf(t, name2) : "";
          const args2 = child(t, n, "type_arguments");
          const first = args2 >= 0 ? namedChildren(t, args2)[0] : void 0;
          if (!lookup(scopeAt(f2, n), nameText, TYPE)) {
            if (SAME_MEMBERS.has(nameText) && first !== void 0) return typeVal(f2, first);
            if (nameText === "InstanceType" && first !== void 0 && t.type[first] === "type_query") return asSide(typeVal(f2, first), "instance");
          }
          return typeVal(f2, name2);
        }
        case "nested_type_identifier": {
          const mod = child(t, n, "module");
          const v2 = evalExpr(f2, mod);
          return asSide(memberOf(v2, textOf(t, child(t, n, "name"))).next, "instance");
        }
        case "union_type": {
          const parts2 = flattenUnion(t, n).filter((c) => !/^(null|undefined|void)$/.test(textOf(t, c)));
          if (parts2.length === 0) return NONE;
          return merge(...parts2.map((c) => typeVal(f2, c)));
        }
        case "intersection_type":
          return merge(...namedChildren(t, n).map((c) => typeVal(f2, c)));
        case "object_type": {
          const s = shapeOf(f2, n);
          return s ? { units: [], shapes: [{ shape: s, side: "instance", file: f2 }] } : NONE;
        }
        case "type_query":
          return evalExpr(f2, namedChildren(t, n)[0] ?? -1);
        case "lookup_type": {
          const [obj, idx] = namedChildren(t, n);
          const lit = idx !== void 0 && t.type[idx] === "literal_type" ? namedChildren(t, idx)[0] : void 0;
          if (obj === void 0 || lit === void 0 || t.type[lit] !== "string") return unknown("indexed type");
          return memberOf(typeVal(f2, obj), propName(t, lit)).next;
        }
        case "predefined_type":
        case "literal_type":
        case "function_type":
        case "constructor_type":
        case "array_type":
        case "tuple_type":
        case "template_literal_type":
          return NONE;
        default:
          return unknown(\`type \${ty}\`);
      }
    };
    const scopeAt = (f2, n) => {
      const t = f2.flat;
      for (let a = t.parent[n]; a >= 0; a = t.parent[a]) {
        const s = f2.scopeOfNode.get(a);
        if (s) return s;
      }
      return f2.module;
    };
    const evalExpr = (f2, n) => {
      if (n < 0) return unknown("no expression");
      const m2 = memoOf(f2);
      if (m2.has(n)) return m2.get(n) ?? unknown("cycle");
      m2.set(n, null);
      const v2 = evalUncached(f2, n);
      m2.set(n, v2);
      return v2;
    };
    const evalUncached = (f2, n) => {
      const t = f2.flat;
      const ty = t.type[n];
      switch (ty) {
        case "identifier":
        case "shorthand_property_identifier": {
          const name2 = textOf(t, n);
          const b2 = lookup(scopeAt(f2, n), name2, VALUE | NS);
          if (b2) return bindingVal(f2, b2);
          if (name2 === "exports") return moduleVal(f2.path);
          return unknown(\`global \${name2}\`);
        }
        case "this":
          return thisVal(f2, n);
        case "parenthesized_expression":
        case "as_expression":
        case "satisfies_expression":
        case "non_null_expression":
        case "type_assertion":
          return evalExpr(f2, unwrap(t, n));
        case "member_expression": {
          const obj = child(t, n, "object");
          const name2 = propName(t, child(t, n, "property"));
          if (t.type[obj] === "identifier" && textOf(t, obj) === "module" && !lookup(scopeAt(f2, n), "module", VALUE) && name2 === "exports") return moduleVal(f2.path);
          if (name2 === "prototype") return asSide(evalExpr(f2, obj), "instance");
          return memberOf(receiverVal(f2, obj), name2).next;
        }
        case "subscript_expression": {
          const idx = child(t, n, "index");
          if (t.type[idx] !== "string") return unknown("computed member");
          return memberOf(receiverVal(f2, child(t, n, "object")), propName(t, idx)).next;
        }
        case "new_expression": {
          const ctor = child(t, n, "constructor");
          if (t.type[ctor] === "identifier" && !lookup(scopeAt(f2, n), textOf(t, ctor), VALUE)) return { ...NONE, external: \`new \${textOf(t, ctor)}\` };
          const c = evalExpr(f2, ctor);
          if (c.external) return { ...NONE, external: c.external };
          if (c.unknown) return unknown(\`new on \${c.unknown}\`);
          return asSide(c, "instance");
        }
        case "call_expression": {
          const spec = requireSpec(t, n, scopeAt(f2, n));
          if (spec !== null) {
            const target = resolveModule(f2.path, spec);
            if (target.path) return moduleVal(target.path);
            return unknown(\`external module '\${spec}'\`);
          }
          const fn = child(t, n, "function");
          const fnText = fn >= 0 ? textOf(t, fn) : "";
          if (/^(Object\\.)?(freeze|seal|assign)$|^Object(Freeze|Seal|Assign)$/.test(fnText)) {
            const args2 = child(t, n, "arguments");
            const first = args2 >= 0 ? namedChildren(t, args2)[0] : void 0;
            if (first !== void 0) return evalExpr(f2, first);
          }
          return unknown("call result");
        }
        case "await_expression": {
          const inner = namedChildren(t, n)[0];
          if (inner !== void 0 && t.type[inner] === "call_expression" && t.type[child(t, inner, "function")] === "import") {
            const args2 = child(t, inner, "arguments");
            const first = args2 >= 0 ? namedChildren(t, args2)[0] : void 0;
            const spec = first !== void 0 && t.type[first] === "string" ? propName(t, first) : null;
            const target = spec ? resolveModule(f2.path, spec) : null;
            if (target?.path && byPath.has(target.path)) return { units: [], shapes: [], module: target.path };
          }
          return unknown("awaited value");
        }
        case "assignment_expression": {
          const lhs = child(t, n, "left");
          if (t.type[lhs] === "member_expression" && propName(t, child(t, lhs, "property")) === "prototype") return evalExpr(f2, lhs);
          return evalExpr(f2, child(t, n, "right"));
        }
        case "ternary_expression":
          return merge(evalExpr(f2, child(t, n, "consequence")), evalExpr(f2, child(t, n, "alternative")));
        case "binary_expression": {
          const op = tokensOf(t, n).find((x2) => x2 === "||" || x2 === "??" || x2 === "&&");
          if (!op) return NONE;
          return merge(evalExpr(f2, child(t, n, "left")), evalExpr(f2, child(t, n, "right")));
        }
        case "object": {
          const s = shapeOf(f2, n);
          const u = unitOfValue(f2, n);
          return { units: u ? [u] : [], shapes: s ? [{ shape: s, side: "instance", file: f2 }] : [] };
        }
        case "class": {
          const s = shapeOf(f2, n);
          const u = unitOfValue(f2, n);
          return { units: u ? [u] : [], shapes: s ? [{ shape: s, side: "static", file: f2 }] : [] };
        }
        case "function_expression":
        case "function":
        case "arrow_function":
        case "generator_function": {
          const u = unitOfValue(f2, n);
          const s = shapeOf(f2, n);
          return { units: u ? [u] : [], shapes: s ? [{ shape: s, side: "static", file: f2 }] : [] };
        }
        case "string":
        case "template_string":
        case "number":
        case "true":
        case "false":
        case "null":
        case "undefined":
        case "regex":
        case "array":
        case "unary_expression":
        case "update_expression":
          return NONE;
        default:
          return unknown(\`expression \${ty}\`);
      }
    };
    const receiverVal = (f2, obj) => {
      const t = f2.flat;
      if (obj >= 0 && t.type[obj] === "super") {
        const self2 = thisVal(f2, obj);
        if (self2.unknown) return self2;
        const bases = self2.shapes.flatMap((s) => s.shape.heritage.map((h) => ({ h, side: s.side, file: s.file })));
        if (bases.length === 0) return unknown("super without a base class");
        return { ...merge(...bases.map((b2) => asSide(evalExpr(b2.file, b2.h), b2.side))), protoOnly: true };
      }
      return evalExpr(f2, obj);
    };
    const memberCache = /* @__PURE__ */ new Map();
    const membersOf = (s, side, f2) => {
      let bySide = memberCache.get(s);
      if (!bySide) memberCache.set(s, bySide = /* @__PURE__ */ new Map());
      let list = bySide.get(side);
      if (!list) bySide.set(side, list = membersUncached(s, side, f2));
      return list;
    };
    const membersUncached = (s, side, f2) => {
      const own = s.members.filter((m2) => s.kind === "class" || s.kind === "function" ? m2.static === (side === "static") : true);
      if (s.kind !== "class" && s.kind !== "function") return own;
      const extra = [];
      for (const a of f2.assignments) {
        if (a.owner !== s.name || a.proto !== (side === "instance")) continue;
        if (a.name === "*") {
          const os = f2.shapes.get(a.value);
          if (os) extra.push(...os.members);
          continue;
        }
        extra.push({ name: a.name, static: side === "static", kind: "proto", node: a.node, nameStart: a.nameStart, ...a.unit ? { unit: a.unit } : {}, value: a.value, typeNode: -1 });
      }
      return [...own, ...extra];
    };
    const memberOf = (v2, name2, depth = 0, write = false) => {
      if (depth > 8) return { units: [], next: unknown("deep inheritance"), found: "unknown", why: "deep inheritance" };
      if (v2.module) {
        const e = exportVal(v2.module, name2, /* @__PURE__ */ new Set());
        if (e) return { units: e.units, next: e, found: e.unknown && e.units.length === 0 ? "unknown" : "yes", ...e.unknown ? { why: e.unknown } : {} };
        if (v2.shapes.length === 0) return { units: [], next: NONE, found: "no" };
      }
      if (v2.external && v2.shapes.length === 0 && !v2.module) return { units: [], next: { ...NONE, external: v2.external }, found: "no" };
      if (v2.unknown && v2.shapes.length === 0) return { units: [], next: unknown(\`member of \${v2.unknown}\`), found: "unknown", why: v2.unknown };
      if (v2.shapes.length === 0) return { units: [], next: NONE, found: "no" };
      const units = [];
      const nexts = [];
      let found = false;
      let open = false;
      let why = "";
      for (const { shape, side, file } of v2.shapes) {
        if (name2 === "prototype" && side === "static" && (shape.kind === "class" || shape.kind === "function")) {
          nexts.push({ units: [], shapes: [{ shape, side: "instance", file }] });
          found = true;
          continue;
        }
        const hits = membersOf(shape, side, file).filter((m2) => m2.name === name2 && !(v2.protoOnly && m2.kind === "this"));
        if (hits.length > 0) {
          found = true;
          const always = hits.some((m2) => !m2.conditional);
          for (const m2 of hits) {
            const value = memberValue(file, m2);
            nexts.push(m2.unit ? { ...value, units: [m2.unit] } : value);
            if (m2.conditional && always) continue;
            if (m2.unit) units.push(m2.unit);
            if (!write && !m2.unit && (m2.kind === "proto" || m2.kind === "pair" || m2.kind === "shorthand" || m2.kind === "this" || m2.kind === "field")) units.push(...value.units.filter((u) => u.kind === "function" || u.kind === "method"));
          }
          continue;
        }
        if (shape.open) open = true;
        for (const h of shape.heritage) {
          const base = shape.kind === "interface" ? typeVal(file, h) : asSide(evalExpr(file, h), side);
          if ((base.unknown || base.external) && base.shapes.length === 0) {
            if (base.external) {
              why || (why = \`inherits from \${base.external}\`);
              continue;
            }
            open = true;
            why || (why = \`inherits from \${base.unknown}\`);
            continue;
          }
          const r = memberOf(base, name2, depth + 1, write);
          if (r.found === "yes") {
            found = true;
            units.push(...r.units);
            nexts.push(r.next);
          } else if (r.found === "unknown") {
            open = true;
            why || (why = r.why ?? "inherited");
          }
        }
      }
      if (found) return { units: [...new Set(units)], next: merge(...nexts), found: "yes" };
      if (open || v2.unknown) return { units: [], next: unknown(why || "open object"), found: "unknown", why: why || v2.unknown || "open object" };
      return { units: [], next: NONE, found: "no" };
    };
    const memberValue = (f2, m2) => {
      const t = f2.flat;
      if (m2.kind === "method" || m2.kind === "get" || m2.kind === "set" || m2.kind === "signature") {
        return m2.unit ? { units: [m2.unit], shapes: [] } : NONE;
      }
      if (m2.typeNode >= 0) return typeVal(f2, m2.typeNode);
      if (m2.kind === "shorthand") {
        const b2 = lookup(scopeAt(f2, m2.value), textOf(t, m2.value), VALUE);
        return b2 ? bindingVal(f2, b2) : unknown("shorthand");
      }
      if (m2.value >= 0) return evalExpr(f2, m2.value);
      return unknown("member without value");
    };
    const resolveSite = (f2, s) => {
      const t = f2.flat;
      if (s.form === "import" && s.importEntry) return s.importEntry.imported === "*" ? [] : importVal(f2, s.importEntry).units;
      if (s.form === "require" && s.keyPath) {
        let a = s.node;
        while (a >= 0 && t.type[a] !== "variable_declarator") a = t.parent[a];
        let v2 = a >= 0 ? evalExpr(f2, child(t, a, "value")) : unknown("require");
        for (const key of s.keyPath) {
          if (key === "..." || /^\\d+$/.test(key)) return [];
          const m2 = memberOf(v2, key);
          v2 = m2.units.length > 0 ? { ...m2.next, units: m2.units } : m2.next;
        }
        return v2.units;
      }
      if (s.form === "export" && s.exportEntry) {
        const e = s.exportEntry;
        if (e.kind === "local") {
          const b2 = lookup(f2.module, e.local, VALUE | TYPE | NS);
          return !b2 ? [] : b2.unit ? [b2.unit] : b2.kind === "import" ? bindingVal(f2, b2).units : [];
        }
        if (e.kind === "reexport") {
          const target = resolveModule(f2.path, e.spec);
          return target.path ? exportVal(target.path, e.imported, /* @__PURE__ */ new Set())?.units ?? [] : [];
        }
        return [];
      }
      if (s.form === "bare") {
        const meaning = t.type[s.node] === "type_identifier" ? TYPE : s.ref === "type" && t.type[t.parent[s.node]] === "nested_type_identifier" ? NS | VALUE : VALUE | NS;
        const b2 = lookup(s.scope, s.name, meaning);
        if (!b2) return [];
        if (b2.kind === "import") {
          const entry = f2.imports.find((i2) => i2.node === b2.node || i2.local === b2.name);
          return entry && (entry.imported === "*" || entry.imported === "=") ? [] : bindingVal(f2, b2).units;
        }
        return b2.unit ? [b2.unit, ...requireAlias(f2, b2)] : [];
      }
      const recv = t.type[t.parent[s.node]] === "nested_type_identifier" ? evalExpr(f2, s.receiver) : receiverVal(f2, s.receiver);
      const hit = memberOf(recv, s.name, 0, s.ref === "write");
      return hit.found === "yes" ? hit.units : [];
    };
    const requireAlias = (f2, b2) => {
      const t = f2.flat;
      if (b2.init < 0 || b2.path) return [];
      const keys = [];
      let e = unwrap(t, b2.init);
      while (e >= 0 && t.type[e] === "member_expression") {
        keys.unshift(propName(t, child(t, e, "property")));
        e = unwrap(t, child(t, e, "object"));
      }
      const spec = requireSpec(t, e, scopeAt(f2, e));
      const target = spec === null ? null : resolveModule(f2.path, spec);
      const m2 = target?.path ? byPath.get(target.path) : void 0;
      if (!m2) return [];
      let v2 = m2.moduleExports >= 0 ? evalExpr(m2, m2.moduleExports) : exportVal(m2.path, "default", /* @__PURE__ */ new Set()) ?? { units: [], shapes: [], module: m2.path };
      if (keys.length > 0) v2 = moduleVal(m2.path);
      for (const k2 of keys) {
        const hit = memberOf(v2, k2);
        v2 = hit.units.length > 0 ? { ...hit.next, units: hit.units } : hit.next;
      }
      return v2.units.filter((u) => u !== b2.unit);
    };
    return { resolveModule, resolveSite };
  };
  var resolveAll = (files, changed, config) => {
    const program = createProgram(files, config);
    const holdsCards = (f2) => changed.has(f2.path) || f2.specifiers.some((sp) => changed.has(program.resolveModule(f2.path, sp.spec).path ?? ""));
    const refs = [];
    for (const f2 of files) {
      if (!holdsCards(f2)) continue;
      for (const s of f2.sites) {
        const units = program.resolveSite(f2, s);
        if (units.length > 0) refs.push({ path: f2.path, start: s.start, line: s.line, ref: s.ref, units });
      }
    }
    return refs;
  };
  var NODE_BUILTINS = /* @__PURE__ */ new Set([
    "_http_agent",
    "_http_client",
    "_http_common",
    "_http_incoming",
    "_http_outgoing",
    "_http_server",
    "_stream_duplex",
    "_stream_passthrough",
    "_stream_readable",
    "_stream_transform",
    "_stream_wrap",
    "_stream_writable",
    "_tls_common",
    "_tls_wrap",
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
    "node:sea",
    "node:sqlite",
    "node:test",
    "node:test/reporters"
  ]);
  var builtinRule = (base, changed) => {
    const repo = \`\${base.owner}/\${base.repo}\`.toLowerCase();
    const fileOf = repo === "nodejs/node" ? (name2) => \`lib/\${name2}.js\` : repo === "oven-sh/bun" ? (name2) => \`src/js/node/\${name2.replaceAll("/", ".")}.ts\` : null;
    if (!fileOf) return () => null;
    return (spec) => {
      const name2 = spec.replace(/^node:/, "");
      if (!NODE_BUILTINS.has(spec) && !(NODE_BUILTINS.has(name2) && !NODE_BUILTINS.has(\`node:\${name2}\`))) return null;
      const path = fileOf(name2);
      return changed.has(path) ? path : null;
    };
  };
  var classOfBody = (t, body2) => body2 >= 0 && t.type[body2] === "class_body" ? t.parent[body2] : -1;
  var flattenUnion = (t, n) => t.type[n] === "union_type" ? namedChildren(t, n).flatMap((c) => flattenUnion(t, c)) : [n];

  // src/lib/sources.ts
  var READ = { code: 40, tests: 40, chars: 4e5, imports: 300, inFlight: 16 };
  var topDir = (path) => path.includes("/") ? path.split("/")[0] : "";
  var pickFiles = (files, max) => {
    if (files.length <= max) return [...files];
    const size = (f2) => f2.additions + f2.deletions;
    const total = files.reduce((n, f2) => n + size(f2), 0);
    const byLanguage = /* @__PURE__ */ new Map();
    for (const f2 of files) byLanguage.set(languageOf(f2.path), (byLanguage.get(languageOf(f2.path)) ?? 0) + size(f2));
    const main = new Set([...byLanguage].filter(([, n]) => n >= total / 10).map(([lang]) => lang));
    const groups = /* @__PURE__ */ new Map();
    for (const f2 of files.filter((f3) => main.has(languageOf(f3.path)))) {
      const group = groups.get(topDir(f2.path));
      if (group) group.push(f2);
      else groups.set(topDir(f2.path), [f2]);
    }
    const queues = [...groups.values()].map((g) => [...g].sort((a, b2) => size(b2) - size(a))).sort((a, b2) => b2.reduce((n, f2) => n + size(f2), 0) - a.reduce((n, f2) => n + size(f2), 0));
    const picked = /* @__PURE__ */ new Set();
    while (picked.size < max && queues.some((q2) => q2.length > 0)) for (const q2 of queues) if (q2.length > 0 && picked.size < max) picked.add(q2.shift());
    return files.filter((f2) => picked.has(f2));
  };
  var changedSources = (files) => {
    const live = files.filter((f2) => f2.status !== "removed");
    const code = live.filter((f2) => roleOf(f2.path) === "code" && languageOf(f2.path) !== "text" && (grammarOf(f2.path) !== null || f2.patch !== void 0 || f2.status === "added"));
    const tests = live.filter((f2) => roleOf(f2.path) === "test" && grammarOf(f2.path) !== null);
    return [...pickFiles(code, READ.code), ...pickFiles(tests, READ.tests)];
  };
  var parseJsonc = (text) => {
    let out2 = "";
    let inString = false;
    for (let i2 = 0; i2 < text.length; i2++) {
      const c = text[i2];
      if (inString) {
        out2 += c;
        if (c === "\\\\") out2 += text[++i2] ?? "";
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        out2 += c;
      } else if (c === "/" && text[i2 + 1] === "/") {
        while (i2 < text.length && text[i2] !== "\\n") i2++;
        out2 += "\\n";
      } else if (c === "/" && text[i2 + 1] === "*") {
        i2 += 2;
        while (i2 < text.length && !(text[i2] === "*" && text[i2 + 1] === "/")) i2++;
        i2++;
      } else out2 += c;
    }
    return JSON.parse(out2.replace(/,(\\s*[}\\]])/g, "$1"));
  };
  var breathe = () => new Promise((resolve) => setTimeout(resolve, 0));
  var readSources = async (files, read, parse2) => {
    const slot = limiter(READ.inFlight);
    const answers = /* @__PURE__ */ new Map();
    const once = (path) => {
      let answer = answers.get(path);
      if (!answer) answers.set(path, answer = slot(() => read(path)).catch(() => null));
      return answer;
    };
    const usable = (text) => text !== null && text.length <= READ.chars;
    const typings = /* @__PURE__ */ new Set();
    const configs = /* @__PURE__ */ new Map();
    const loadConfig = (path, depth = 0) => {
      let hit = configs.get(path);
      if (!hit) configs.set(path, hit = configUncached(path, depth));
      return hit;
    };
    const configUncached = async (path, depth) => {
      const text = await once(path);
      if (text === null) return null;
      let json;
      try {
        json = parseJsonc(text);
      } catch {
        return null;
      }
      const dir = dirOf(path);
      const ext = typeof json.extends === "string" ? json.extends : null;
      const base = ext && (ext.startsWith("./") || ext.startsWith("../")) && depth < 4 ? await loadConfig(joinPath(dir, ext.endsWith(".json") ? ext : \`\${ext}.json\`), depth + 1) : null;
      for (const entry of [...Array.isArray(json.files) ? json.files : [], ...Array.isArray(json.include) ? json.include : []]) {
        if (typeof entry === "string" && entry.endsWith(".d.ts") && !/[*?]/.test(entry)) typings.add(joinPath(dir, entry));
      }
      const co = json.compilerOptions ?? {};
      return {
        dir,
        ...co.baseUrl !== void 0 ? { baseUrl: joinPath(dir, co.baseUrl) } : base?.baseUrl !== void 0 ? { baseUrl: base.baseUrl } : {},
        ...co.paths ? { paths: co.paths, pathsDir: dir } : base?.paths ? { paths: base.paths, pathsDir: base.pathsDir ?? base.dir } : {}
      };
    };
    const byDir = /* @__PURE__ */ new Map();
    const mappingsFor = (dir) => {
      let hit = byDir.get(dir);
      if (!hit) byDir.set(dir, hit = mappingsUncached(dir));
      return hit;
    };
    const mappingsUncached = async (dir) => {
      for (const name2 of ["tsconfig.json", "jsconfig.json"]) {
        const c = await loadConfig(dir ? \`\${dir}/\${name2}\` : name2);
        if (!c) continue;
        const root = c.baseUrl ?? c.pathsDir ?? c.dir;
        return Object.entries(c.paths ?? {}).map(([pattern, targets]) => ({ pattern, targets: targets.map((x2) => joinPath(root, x2)) }));
      }
      return dir ? mappingsFor(dirOf(dir)) : [];
    };
    const changed = changedSources(files);
    const parsedChanged = changed.filter((f2) => grammarOf(f2.path) !== null);
    const mappings = Promise.all(parsedChanged.map((f2) => mappingsFor(dirOf(f2.path))));
    const texts = /* @__PURE__ */ new Map();
    const facts = /* @__PURE__ */ new Map();
    const take = async (path, text) => {
      texts.set(path, text);
      const f2 = await parse2(path, text);
      if (f2) facts.set(path, f2);
      await breathe();
    };
    const changedTexts = changed.map((f2) => once(f2.path));
    for (const [i2, f2] of changed.entries()) {
      const text = await changedTexts[i2];
      if (usable(text)) await take(f2.path, text);
    }
    await mappings;
    for (const path of [...typings].sort()) {
      if (texts.has(path)) continue;
      const text = await once(path);
      if (usable(text)) await take(path, text);
    }
    const known = new Set(texts.keys());
    const paths = (from) => {
      for (let d = dirOf(from); ; d = dirOf(d)) {
        if (byDir.has(d)) return resolvedMappings.get(d) ?? [];
        if (!d) return [];
      }
    };
    const resolvedMappings = /* @__PURE__ */ new Map();
    for (const [dir, m2] of byDir) resolvedMappings.set(dir, await m2);
    const resolveImport = async (from, spec) => {
      const { candidates } = moduleCandidates(from, spec, paths(from));
      const already = candidates.find((c) => known.has(c));
      if (already) return already;
      for (const c of candidates) if (await once(c) !== null) return c;
      return null;
    };
    const imports = parsedChanged.flatMap((c) => facts.get(c.path) ?? []).flatMap((f2) => f2.specifiers.map((s) => resolveImport(f2.path, s.spec)));
    let added = 0;
    for (const target of imports) {
      const path = await target;
      if (!path || texts.has(path) || added >= READ.imports) continue;
      const text = await once(path);
      if (!usable(text)) continue;
      added++;
      await take(path, text);
    }
    return { texts, facts, paths };
  };

  // src/lib/rust.ts
  var codeOnly = (text) => {
    const out2 = text.split("");
    const n = text.length;
    const blank = (from, to) => {
      for (let k2 = from; k2 < to && k2 < n; k2++) if (out2[k2] !== "\\n") out2[k2] = " ";
    };
    const wordBefore = (i3) => /[A-Za-z0-9_]/.test(text[i3 - 1] ?? "");
    let i2 = 0;
    while (i2 < n) {
      const c = text[i2];
      const next = text[i2 + 1];
      if (c === "/" && next === "/") {
        const end = text.indexOf("\\n", i2);
        const stop2 = end < 0 ? n : end;
        blank(i2, stop2);
        i2 = stop2;
      } else if (c === "/" && next === "*") {
        let depth = 1;
        let k2 = i2 + 2;
        while (k2 < n && depth > 0) {
          if (text[k2] === "/" && text[k2 + 1] === "*") depth++, k2 += 2;
          else if (text[k2] === "*" && text[k2 + 1] === "/") depth--, k2 += 2;
          else k2++;
        }
        blank(i2, k2);
        i2 = k2;
      } else if ((c === "r" || c === "b" || c === "c") && !wordBefore(i2) && /^(?:[bc]?r)(#*)"/.test(text.slice(i2, i2 + 40))) {
        const hashes = /^(?:[bc]?r)(#*)"/.exec(text.slice(i2, i2 + 40))[1];
        const open = text.indexOf('"', i2) + 1;
        const end = text.indexOf(\`"\${hashes}\`, open);
        const stop2 = end < 0 ? n : end + 1 + hashes.length;
        blank(i2, stop2);
        i2 = stop2;
      } else if (c === '"' || (c === "b" || c === "c") && next === '"' && !wordBefore(i2)) {
        let k2 = c === '"' ? i2 + 1 : i2 + 2;
        while (k2 < n && text[k2] !== '"') k2 += text[k2] === "\\\\" ? 2 : 1;
        blank(i2, k2 + 1);
        i2 = k2 + 1;
      } else if (c === "'" || c === "b" && next === "'" && !wordBefore(i2)) {
        const at2 = c === "'" ? i2 : i2 + 1;
        const m2 = /^'(?:\\\\(?:u\\{[0-9A-Fa-f_]+\\}|x[0-9A-Fa-f]{2}|.)|[^'\\\\\\n])'/u.exec(text.slice(at2, at2 + 16));
        const stop2 = m2 ? at2 + m2[0].length : i2 + 1;
        if (m2) blank(i2, stop2);
        i2 = stop2;
      } else i2++;
    }
    return out2.join("");
  };
  var indentOf = (line) => /^[ \\t]*/.exec(line)[0].replace(/\\t/g, "    ").length;
  var KEYWORDS2 = /* @__PURE__ */ new Set(["if", "while", "for", "match", "return", "loop", "fn", "let", "in", "as", "move", "unsafe", "async", "await", "impl", "where", "mut", "ref", "else", "break", "continue", "dyn", "yield", "Some", "Ok", "Err", "None"]);
  var CALL = /([A-Za-z_][A-Za-z0-9_]*)\\s*(?:::\\s*<[^()]*?>\\s*)?\\(/g;
  var sitesOn = (line, n) => {
    const sites = [];
    for (const m2 of line.matchAll(CALL)) {
      const name2 = m2[1];
      if (KEYWORDS2.has(name2)) continue;
      const before = line.slice(0, m2.index).replace(/\\s+$/, "");
      if (/\\b(fn|struct|enum|union|trait|type|mod|impl|dyn)$/.test(before)) continue;
      if (before.endsWith(".")) {
        sites.push({ line: n, name: name2, via: /(?:^|[^\\w.])self\\s*\\.$/.test(before) ? "self" : "other" });
      } else if (before.endsWith("::")) {
        const q2 = /(^|[^\\w:>])\\s*([A-Za-z_]\\w*)\\s*::$/.exec(before);
        if (q2?.[2] === "Self") sites.push({ line: n, name: name2, via: "Self" });
        else if (q2 && /^[A-Z]/.test(q2[2])) sites.push({ line: n, name: name2, via: "type", type: q2[2] });
        else sites.push({ line: n, name: name2, via: "other" });
      } else sites.push({ line: n, name: name2, via: "bare" });
    }
    return sites;
  };
  var cache = /* @__PURE__ */ new WeakMap();
  var rustFile = (lines, decls) => {
    const hit = cache.get(lines);
    if (hit) return hit;
    const code = codeOnly(lines.join("\\n")).split("\\n");
    const scopes = [{ id: 0, start: 0, end: Number.MAX_SAFE_INTEGER, items: 0 }];
    code.forEach((line, i2) => {
      if (!/^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?mod\\s+\\w+\\s*\\{\\s*$/.test(line)) return;
      const indent = indentOf(line);
      let end = i2 + 1;
      let items = indent + 4;
      let first = true;
      for (let k2 = i2 + 1; k2 < code.length; k2++) {
        const t = code[k2];
        if (t.trim() === "") continue;
        if (indentOf(t) > indent) {
          if (first) items = indentOf(t), first = false;
          end = k2 + 1;
          continue;
        }
        if (/^\\s*\\}/.test(t)) end = k2 + 1;
        break;
      }
      scopes.push({ id: scopes.length, start: i2 + 1, end, items });
    });
    const scopeAt = (line) => scopes.filter((s) => s.start < line && line <= s.end).sort((a, b2) => b2.start - a.start)[0];
    const impls = decls.filter((d) => d.kind === "class").map((d) => {
      let header = "";
      for (let k2 = d.start; k2 <= d.end; k2++) {
        header += \` \${code[k2 - 1]}\`;
        if (code[k2 - 1].includes("{")) break;
      }
      header = header.split("{")[0];
      let flat = header;
      for (let prev = ""; prev !== flat; ) prev = flat, flat = flat.replace(/<[^<>]*>/g, " ");
      flat = flat.replace(/\\bwhere\\b[\\s\\S]*$/, "").trim();
      const m2 = /\\bimpl\\s+(?:(.+?)\\s+for\\s+)?(?:&\\s*(?:mut\\s+)?)?([\\w:]+)\\s*$/.exec(flat);
      const scope = scopeAt(d.start);
      return { start: d.start, end: d.end, type: (m2?.[2] ?? "").split("::").pop(), inherent: m2 !== null && m2[1] === void 0, scope: scope.id, header };
    }).filter((b2) => b2.type !== "" && scopeAt(b2.start).items === indentOf(lines[b2.start - 1]));
    const implAt = (line) => impls.filter((b2) => b2.start < line && line <= b2.end).sort((a, b2) => b2.start - a.start)[0];
    const add = (map, key, value) => {
      const values = map.get(key);
      if (values) values.push(value);
      else map.set(key, [value]);
    };
    const functions = /* @__PURE__ */ new Map();
    const inherent = /* @__PURE__ */ new Map();
    const types = /* @__PURE__ */ new Set();
    for (const d of decls) {
      const scope = scopeAt(d.start);
      const impl = implAt(d.start);
      if (d.kind === "function" && !impl && d.indent === scope.items) add(functions, \`\${scope.id}|\${d.name}\`, d);
      if ((d.kind === "method" || d.kind === "function") && impl?.inherent && impl.scope === scope.id) add(inherent, \`\${impl.scope}|\${impl.type}|\${d.name}\`, d);
      if (d.kind === "type" && !impl && d.indent === scope.items && /\\b(struct|enum|union)\\b/.test(code[d.start - 1])) types.add(\`\${scope.id}|\${d.name}\`);
    }
    for (const b2 of impls) if (b2.inherent) types.add(\`\${b2.scope}|\${b2.type}\`);
    const one = (ds) => ds && ds.length === 1 ? ds[0] : void 0;
    const callsOf = (caller) => {
      if (caller.kind !== "function" && caller.kind !== "method") return [];
      const scope = scopeAt(caller.start);
      const impl = implAt(caller.start);
      const body2 = code.slice(caller.start - 1, caller.end).join("\\n");
      const bound = /* @__PURE__ */ new Map();
      const binds = (name2) => {
        let hit2 = bound.get(name2);
        if (hit2 === void 0) {
          const mentions = [...body2.matchAll(new RegExp(\`(^|[^\\\\w.:])\${name2}\\\\b(\\\\s*(?:::\\\\s*<[^()]*?>\\\\s*)?\\\\()?\`, "g"))];
          hit2 = mentions.some((x2) => !x2[2]) || new RegExp(\`\\\\bfn\\\\s+\${name2}\\\\b\`).test(body2.slice(body2.indexOf("\\n") + 1));
          bound.set(name2, hit2);
        }
        return hit2;
      };
      const shadowed = /* @__PURE__ */ new Map();
      const shadows = (type) => {
        let hit2 = shadowed.get(type);
        if (hit2 === void 0) {
          const generic = new RegExp(\`[<,]\\\\s*\${type}\\\\b\`);
          const local = new RegExp(\`\\\\buse\\\\b[^;]*\\\\b\${type}\\\\b|\\\\b(?:struct|enum|union|type|trait)\\\\s+\${type}\\\\b\`);
          hit2 = generic.test(code[caller.start - 1]) || impl !== void 0 && generic.test(impl.header) || local.test(body2);
          shadowed.set(type, hit2);
        }
        return hit2;
      };
      const nested = [];
      for (let n = caller.start + 1; n <= caller.end; n++) {
        if (!/^\\s*(?:unsafe\\s+)?impl\\b/.test(code[n - 1])) continue;
        const indent = indentOf(code[n - 1]);
        let to = n;
        while (to < caller.end && (code[to].trim() === "" || indentOf(code[to]) > indent || /^\\s*\\}/.test(code[to]))) {
          to++;
          if (/^\\s*\\}/.test(code[to - 1]) && indentOf(code[to - 1]) === indent) break;
        }
        nested.push({ from: n, to });
      }
      const ownSelf = (line) => !nested.some((r) => r.from <= line && line <= r.to);
      const out2 = [];
      for (let n = caller.start + 1; n <= caller.end && n <= code.length; n++) {
        for (const s of sitesOn(code[n - 1], n)) {
          let to;
          if (s.via === "bare") {
            to = one(functions.get(\`\${scope.id}|\${s.name}\`));
            if (to && binds(s.name)) to = void 0;
          } else if ((s.via === "self" || s.via === "Self") && impl && impl.scope === scope.id && ownSelf(s.line)) {
            to = one(inherent.get(\`\${impl.scope}|\${impl.type}|\${s.name}\`));
          } else if (s.via === "type" && types.has(\`\${scope.id}|\${s.type}\`) && !shadows(s.type)) {
            to = one(inherent.get(\`\${scope.id}|\${s.type}|\${s.name}\`));
          }
          if (!to || to.start === caller.start) continue;
          if (to.start <= caller.start && caller.end <= to.end || caller.start <= to.start && to.end <= caller.end) continue;
          out2.push({ to, line: s.line });
        }
      }
      return out2;
    };
    const known = /* @__PURE__ */ new Map();
    const calls = (caller) => {
      const key = \`\${caller.start}:\${caller.end}:\${caller.kind}\`;
      let hit2 = known.get(key);
      if (!hit2) known.set(key, hit2 = callsOf(caller));
      return hit2;
    };
    const analysis = { calls };
    cache.set(lines, analysis);
    return analysis;
  };

  // src/lib/symbols.ts
  var indentOf2 = (line) => {
    const m2 = /^[ \\t]*/.exec(line)[0];
    return m2.replace(/\\t/g, "    ").length;
  };
  var isBlank = (line) => line.trim() === "";
  var HASH_COMMENTS = /* @__PURE__ */ new Set(["py", "rb", "sh", "yaml", "toml"]);
  var isComment = (line, lang) => /^\\s*(\\/\\/|\\/\\*|\\*(\\s|\\/|$))/.test(line) || HASH_COMMENTS.has(lang) && /^\\s*#(?!\\[)/.test(line) || lang === "py" && /^\\s*("""|''')/.test(line) || lang === "sql" && /^\\s*--/.test(line);
  var isCloser = (line) => /^\\s*(\\}|\\)|\\]|>|end\\b)/.test(line);
  var opensAgain = (line) => /(\\{|\\(|\\[|=>|:)\\s*$/.test(line.trim());
  var KEYWORDS3 = /* @__PURE__ */ new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "function",
    "else",
    "do",
    "try",
    "await",
    "new",
    "throw",
    "typeof",
    "delete",
    "void",
    "yield",
    "super",
    "import",
    "export",
    "case",
    "with",
    "elif",
    "when"
  ]);
  var JS = [
    { re: /^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+([A-Za-z_$][\\w$]*)/, kind: "class", container: true },
    // \`type X,\` inside a multi-line import is no declaration.
    { re: /^\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type|enum)\\s+([A-Za-z_$][\\w$]*)(?=\\s*(?:[=<{]|extends\\b|$))/, kind: "type" },
    { re: /^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*([A-Za-z_$][\\w$]*)/, kind: "function" },
    {
      re: /^\\s*(?:export\\s+)?(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]*)?=\\s*(?:async\\s+)?(?:function\\b|\\(|<|[A-Za-z_$][\\w$]*\\s*=>)/,
      kind: "function"
    },
    { re: /^(?:export\\s+)?(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)/, kind: "value", topOnly: true },
    {
      re: /^\\s+(?:(?:public|private|protected|static|readonly|override|abstract|declare)\\s+)*(#?[A-Za-z_$][\\w$]*)\\s*(?:\\?|!)?\\s*(?::[^=]*)?=\\s*(?:async\\s+)?(?:\\(|[A-Za-z_$][\\w$]*\\s*=>|function\\b)/,
      kind: "method",
      inClassOnly: true
    },
    {
      re: /^\\s+(?:(?:public|private|protected|static|readonly|override|declare)\\s+)*(#?[A-Za-z_$][\\w$]*)\\s*[?!]?\\s*:\\s*\\(\\s*$/,
      kind: "method",
      inClassOnly: true,
      arrowField: true
    },
    {
      re: /^\\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\\s+)*\\*?\\s*(#?[A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\s*\\(/,
      kind: "method",
      inClassOnly: true
    }
  ];
  var PY = [
    { re: /^\\s*class\\s+(\\w+)/, kind: "class", container: true },
    { re: /^\\s*(?:async\\s+)?def\\s+(\\w+)/, kind: "function" }
  ];
  var GO = [
    { re: /^func\\s+\\([^)]*\\)\\s*(\\w+)/, kind: "method" },
    { re: /^func\\s+(\\w+)/, kind: "function" },
    { re: /^type\\s+(\\w+)/, kind: "type" }
  ];
  var RS = [
    { re: /^\\s*impl(?:<[^>]*>)?\\s+(?:[\\w:<>, ]+\\s+for\\s+)?([\\w:]+)/, kind: "class", container: true },
    { re: /^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:(?:async|const|unsafe|extern(?:\\s+"[^"]*")?)\\s+)*fn\\s+(\\w+)/, kind: "function" },
    { re: /^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:struct|enum|trait|type|union)\\s+(\\w+)/, kind: "type" }
  ];
  var RB = [
    { re: /^\\s*(?:class|module)\\s+([\\w:]+)/, kind: "class", container: true },
    { re: /^\\s*def\\s+(?:self\\.)?([\\w?!=]+)/, kind: "function" }
  ];
  var C_FAMILY = [
    { re: /^\\s*(?:[\\w@]+\\s+)*(?:class|interface|enum|struct|object|protocol|record|extension|trait)\\s+(\\w+)/, kind: "class", container: true },
    { re: /^\\s*(?:[\\w@]+\\s+)*(?:fun|func|function)\\s+(?:<[^>]*>\\s*)?(?:[\\w.]+\\.)?(\\w+)\\s*[(<]/, kind: "function" },
    { re: /^\\s*(?:(?:public|private|protected|internal|static|final|virtual|override|async|abstract|synchronized|inline|extern|const|unsafe)\\s+)*[\\w<>\\[\\],.?*&: ]+\\s+\\*?(\\w+)\\s*\\([^;]*$/, kind: "function" }
  ];
  var patternsFor = (lang) => {
    switch (lang) {
      case "ts":
      case "js":
        return JS;
      case "py":
        return PY;
      case "go":
        return GO;
      case "rs":
        return RS;
      case "rb":
        return RB;
      case "java":
      case "kt":
      case "swift":
      case "cs":
      case "php":
      case "c":
        return C_FAMILY;
      default:
        return [];
    }
  };
  var extentEnd = (lines, start2) => {
    const indent = indentOf2(lines[start2 - 1]);
    let last = start2;
    for (let i2 = start2 + 1; i2 <= lines.length; i2++) {
      const line = lines[i2 - 1];
      if (isBlank(line)) continue;
      if (indentOf2(line) > indent) {
        last = i2;
        continue;
      }
      if (isCloser(line)) {
        last = i2;
        if (opensAgain(line)) continue;
      }
      break;
    }
    return last;
  };
  var findDecls = (lines, lang) => {
    const patterns = patternsFor(lang);
    if (patterns.length === 0) return [];
    const decls = [];
    const containers = [];
    let functionsEnd = 0;
    for (let i2 = 1; i2 <= lines.length; i2++) {
      const line = lines[i2 - 1];
      if (isBlank(line) || isComment(line, lang)) continue;
      const indent = indentOf2(line);
      while (containers.length > 0 && containers[containers.length - 1].end < i2) containers.pop();
      const container = containers[containers.length - 1];
      if (i2 <= functionsEnd) continue;
      for (const p of patterns) {
        if (p.topOnly && indent > 0) continue;
        if (p.inClassOnly && !container) continue;
        const m2 = p.re.exec(line);
        const name2 = m2?.[p.group ?? 1];
        if (!m2 || !name2 || lang !== "rs" && KEYWORDS3.has(name2.replace(/^#/, ""))) continue;
        if (p.inClassOnly && container && (indent !== firstMemberIndent(lines, container, lang) || /;\\s*$/.test(line))) continue;
        const end = extentEnd(lines, i2);
        if (p.arrowField && !opensBody(lines, i2, end, indent)) continue;
        const kind = p.kind === "function" && container && indent > container.indent ? "method" : p.kind;
        const decl = { name: name2, kind, start: i2, end, indent, ...container ? { parent: container.name } : {} };
        decls.push(decl);
        if (p.container) containers.push(decl);
        if (kind === "function" || kind === "method") functionsEnd = Math.max(functionsEnd, end);
        break;
      }
    }
    return decls;
  };
  var opensBody = (lines, start2, end, indent) => {
    for (let i2 = start2 + 1; i2 <= end; i2++) {
      const line = lines[i2 - 1];
      if (!isBlank(line) && indentOf2(line) === indent && isCloser(line)) return /(=>\\s*\\{|=\\s*\\()\\s*$/.test(line.trim());
    }
    return false;
  };
  var firstMemberIndent = (lines, container, lang) => {
    for (let i2 = container.start + 1; i2 <= container.end; i2++) {
      const line = lines[i2 - 1];
      if (!isBlank(line) && !isComment(line, lang) && !isCloser(line)) return indentOf2(line);
    }
    return container.indent + 2;
  };
  var labelOf = (decl, lang) => {
    switch (decl.kind) {
      case "function":
      case "method":
        return lang === "rs" && decl.kind === "method" && decl.parent ? \`\${decl.parent.split("::").pop()}::\${decl.name}()\` : \`\${decl.name}()\`;
      case "class":
        return \`class \${decl.name}\`;
      case "type":
        return \`type \${decl.name}\`;
      case "namespace":
        return \`namespace \${decl.name}\`;
      case "value":
        return decl.name;
    }
  };
  var documented = (lines, starts, line, lang) => {
    for (let i2 = line; i2 <= Math.min(lines.length, line + 60); i2++) {
      const decl = starts.get(i2);
      if (decl && i2 > line) return decl;
      const text = lines[i2 - 1];
      if (!(isBlank(text) || isComment(text, lang) || /^\\s*@/.test(text))) return decl ?? null;
    }
    return null;
  };
  var innermostByLine = (decls, count2) => {
    const out2 = new Array(count2 + 1).fill(null);
    for (const d of decls) {
      for (let line = d.start; line <= Math.min(d.end, count2); line++) {
        const best = out2[line];
        if (best === null || d.end - d.start < best.end - best.start) out2[line] = d;
      }
    }
    return out2;
  };
  var changedSymbols = (path, lang, head, hunks) => {
    const changed = hunks.flatMap((h) => h.lines).filter((l3) => l3.t !== "ctx");
    if (!head) return { symbols: [], loose: looseRuns(path, changed) };
    const decls = findDecls(head, lang);
    const starts = /* @__PURE__ */ new Map();
    for (const d of decls) if (!starts.has(d.start)) starts.set(d.start, d);
    const innermost2 = innermostByLine(decls, head.length);
    const added = new Set(changed.filter((l3) => l3.t === "add").map((l3) => l3.n));
    const owner = /* @__PURE__ */ new Map();
    const loose = [];
    let previous = null;
    for (const l3 of changed) {
      const text = l3.text;
      const target = isBlank(text) ? previous && l3.at - previous.line.at <= 1 ? previous.target : void 0 : (isComment(text, lang) || /^\\s*@/.test(text) ? documented(head, starts, l3.at, lang) : null) ?? innermost2[l3.at] ?? null;
      if (target === void 0) continue;
      if (target) {
        const owned = owner.get(target);
        if (owned) owned.push(l3);
        else owner.set(target, [l3]);
      } else loose.push(l3);
      previous = { line: l3, target };
    }
    const symbols = [...owner.entries()].sort(([a], [b2]) => a.start - b2.start).map(([d, lines]) => {
      const ats = lines.map((l3) => l3.at);
      return {
        id: \`\${path}:\${d.start}\`,
        path,
        lang,
        name: d.name,
        label: labelOf(d, lang),
        kind: d.kind,
        ...d.parent ? { parent: d.parent } : {},
        status: added.has(d.start) ? "new" : "changed",
        start: d.start,
        end: d.end,
        from: ats.reduce((a, b2) => Math.min(a, b2)),
        to: ats.reduce((a, b2) => Math.max(a, b2)),
        add: lines.filter((l3) => l3.t === "add").length,
        del: lines.filter((l3) => l3.t === "del").length
      };
    });
    return { symbols, loose: looseRuns(path, loose) };
  };
  var looseRuns = (path, lines) => {
    const runs = [];
    for (const l3 of [...lines].sort((a, b2) => a.at - b2.at)) {
      const last = runs[runs.length - 1];
      const add = l3.t === "add" ? 1 : 0;
      const del = l3.t === "del" ? 1 : 0;
      if (last && l3.at - last.to <= 6) runs[runs.length - 1] = { ...last, to: Math.max(last.to, l3.at), add: last.add + add, del: last.del + del };
      else runs.push({ path, from: l3.at, to: l3.at, add, del });
    }
    return runs;
  };
  var COMMON = /* @__PURE__ */ new Set([
    "get",
    "set",
    "has",
    "add",
    "map",
    "run",
    "call",
    "apply",
    "bind",
    "then",
    "catch",
    "init",
    "main",
    "test",
    "it",
    "describe",
    "constructor",
    "toString",
    "value",
    "data",
    "default",
    "index",
    "render",
    "update",
    "create",
    "handle",
    "use",
    "new",
    "next",
    "push",
    "pop",
    "on",
    "off",
    "emit",
    "start",
    "stop",
    "close",
    "open",
    "read",
    "write",
    "load",
    "parse",
    "format",
    "name",
    "type",
    "key",
    "id",
    "size",
    "length",
    "error",
    "result",
    "options",
    "config",
    "self"
  ]);
  var calledAs = (symbol) => {
    const bare = symbol.name.replace(/^#/, "");
    if (bare.length < 3 || COMMON.has(bare)) return null;
    if (symbol.name.startsWith("#")) return () => true;
    return symbol.kind === "method" ? (t) => t.member : (t) => t.plain;
  };
  var CALL_TOKEN = /(#?[A-Za-z_$][\\w$]*)\\s*(?:<[^<>()]*>)?\\s*(?:\\?\\.)?\\(/g;
  var tokenCache = /* @__PURE__ */ new WeakMap();
  var callTokens = (lines, lang) => {
    const hit = tokenCache.get(lines);
    if (hit) return hit;
    const out2 = lines.map(
      (line, i2) => isComment(line, lang) ? [] : [...line.matchAll(CALL_TOKEN)].map((m2) => {
        const at2 = m2.index;
        const two = line.slice(Math.max(0, at2 - 2), at2);
        return { name: m2[1], line: i2 + 1, member: line[at2 - 1] === "." || two === "::" || two === "->", plain: at2 === 0 || !/[\\w$#.]/.test(line[at2 - 1]) };
      })
    );
    tokenCache.set(lines, out2);
    return out2;
  };
  var declCache = /* @__PURE__ */ new WeakMap();
  var rustOf = (lines) => {
    let decls = declCache.get(lines);
    if (!decls) declCache.set(lines, decls = findDecls(lines, "rs"));
    return rustFile(lines, decls);
  };
  var callsTo = (path, lines, lang, caller, target) => {
    if (lang === "rs") return path === target.path ? [...new Set(rustOf(lines).calls(caller).filter((c) => c.to.start === target.start).map((c) => c.line))] : [];
    const matches = calledAs(target);
    if (!matches) return [];
    const rows = /* @__PURE__ */ new Set();
    const tokens = callTokens(lines, lang);
    for (let n = Math.max(1, caller.start + 1); n <= Math.min(lines.length, caller.end); n++) if (tokens[n - 1].some((t) => t.name === target.name && matches(t))) rows.add(n);
    return [...rows];
  };
  var callEdges = (symbols, headByPath) => {
    const edges = [];
    const order = new Map(symbols.map((s, i2) => [s, i2]));
    const byName = /* @__PURE__ */ new Map();
    for (const s of symbols) {
      const named = byName.get(s.name);
      if (named) named.push(s);
      else byName.set(s.name, [s]);
    }
    const byStart = new Map(symbols.map((s) => [\`\${s.path}:\${s.start}\`, s]));
    for (const a of symbols) {
      const lines = headByPath.get(a.path);
      if (!lines || a.kind === "class") continue;
      const rows = /* @__PURE__ */ new Map();
      if (a.lang === "rs") {
        for (const c of rustOf(lines).calls(a)) {
          const b2 = byStart.get(\`\${a.path}:\${c.to.start}\`);
          if (b2) rows.set(b2, (rows.get(b2) ?? /* @__PURE__ */ new Set()).add(c.line));
        }
      } else {
        const tokens = callTokens(lines, a.lang);
        for (let n = a.start + 1; n <= Math.min(lines.length, a.end); n++) {
          for (const t of tokens[n - 1]) {
            for (const b2 of byName.get(t.name) ?? []) if (calledAs(b2)?.(t)) rows.set(b2, (rows.get(b2) ?? /* @__PURE__ */ new Set()).add(n));
          }
        }
      }
      const targets = [...rows.keys()].sort((x2, y2) => order.get(x2) - order.get(y2));
      for (const b2 of targets) {
        if (a === b2) continue;
        if (b2.path === a.path && b2.start <= a.start && a.end <= b2.end) continue;
        if (a.path === b2.path && a.start <= b2.start && b2.end <= a.end) continue;
        if (b2.name.startsWith("#") && b2.path !== a.path) continue;
        edges.push({ from: a.id, to: b2.id, calls: [...rows.get(b2)].sort((x2, y2) => x2 - y2) });
      }
    }
    return edges;
  };
  var CASE_PATTERNS = [
    /\\b(describe|context|suite|it|test|specify)(?:\\.(?:each|only|skip|concurrent|todo)(?:\\([^)]*\\))?)*\\(\\s*(['"\`])(.+?)\\2/,
    /^\\s*(?:async\\s+)?def\\s+(test)_?(\\w+)/,
    /^\\s*func\\s+(Test)(\\w+)\\s*\\(/
  ];
  var testCases = (hunks) => {
    const out2 = [];
    for (const h of hunks) {
      h.lines.forEach((l3, i2) => {
        if (l3.t === "ctx") return;
        const t = l3.t;
        const indent = /^\\s*/.exec(l3.text.replace(/\\t/g, "    "))[0].length;
        const js = CASE_PATTERNS[0].exec(l3.text);
        if (js) {
          out2.push({ name: js[3], at: l3.at, t, group: /^(describe|context|suite)$/.test(js[1]), indent });
          return;
        }
        if (/\\b(it|test)\\.each\\(.*\\)\\(\\s*$/.test(l3.text)) {
          const next = /^\\s*(['"\`])(.+?)\\1/.exec(h.lines[i2 + 1]?.text ?? "");
          if (next) out2.push({ name: next[2], at: l3.at, t, group: false, indent });
          return;
        }
        const py = CASE_PATTERNS[1].exec(l3.text) ?? CASE_PATTERNS[2].exec(l3.text);
        if (py) out2.push({ name: \`\${py[1]}\${py[1] === "test" ? "_" : ""}\${py[2]}\`, at: l3.at, t, group: false, indent });
      });
    }
    return out2;
  };

  // src/lib/model.ts
  var LIMITS = { cards: 32, part: 8 };
  var fileName = (path) => path.split("/").pop() ?? path;
  var analyse = async (pr, files, read, parse2) => {
    const sources = await readSources(files, read, parse2);
    const changed = new Set(files.filter((f2) => f2.status !== "removed").map((f2) => f2.path));
    const refs = resolveAll([...sources.facts.values()], changed, { paths: sources.paths, builtin: builtinRule(pr.ref, changed) });
    return buildReview(pr, files, { texts: sources.texts, facts: sources.facts, refs });
  };
  var pythonImports = (files, heads) => {
    const byStem = new Map(files.map((f2) => [f2.path.replace(/\\.[^/.]+$/, ""), f2.path]));
    const edges = [];
    for (const f2 of files.filter((x2) => x2.lang === "py")) {
      (heads.get(f2.path) ?? []).forEach((line, i2) => {
        const name2 = /^\\s*from\\s+\\.(\\w+)\\s+import/.exec(line)?.[1];
        const target = name2 ? byStem.get(\`\${f2.path.split("/").slice(0, -1).concat(name2).join("/")}\`) : void 0;
        if (target && target !== f2.path && !edges.some((e) => e.from === f2.path && e.to === target)) edges.push({ from: f2.path, to: target, at: i2 + 1 });
      });
    }
    return edges;
  };
  var push = (map, key, value) => {
    const values = map.get(key);
    if (values) values.push(value);
    else map.set(key, [value]);
  };
  var components = (ids, edges) => {
    const known = new Set(ids);
    const adj = /* @__PURE__ */ new Map();
    for (const e of edges) {
      push(adj, e.from, e.to);
      push(adj, e.to, e.from);
    }
    const group = /* @__PURE__ */ new Map();
    let groups = 0;
    for (const id of ids) {
      if (group.has(id)) continue;
      const g = groups++;
      group.set(id, g);
      const stack = [id];
      while (stack.length > 0) {
        for (const next of adj.get(stack.pop()) ?? []) {
          if (group.has(next) || !known.has(next)) continue;
          group.set(next, g);
          stack.push(next);
        }
      }
    }
    const out2 = Array.from({ length: groups }, () => []);
    for (const id of ids) out2[group.get(id)].push(id);
    return out2;
  };
  var threadsOf = (ids, edges) => {
    const first = /* @__PURE__ */ new Map();
    for (const [i2, id] of ids.entries()) if (!first.has(id)) first.set(id, i2);
    return sortBy(
      components(ids, edges).filter((g) => g.length >= 2),
      (g) => -g.length,
      (g) => first.get(g[0])
    );
  };
  var threadEdges = (threads, edges) => {
    const threadOf = new Map(threads.flatMap((members, b2) => members.map((id) => [id, b2])));
    const out2 = threads.map(() => []);
    for (const e of edges) {
      const b2 = threadOf.get(e.from);
      if (b2 !== void 0 && threadOf.get(e.to) === b2) out2[b2].push([e.from, e.to]);
    }
    return out2;
  };
  var IMPORT_LINE = /^\\s*(import\\b|from\\s+\\S+\\s+import\\b|export\\s.*\\bfrom\\b|use\\s|#include|require\\(|const\\s.*=\\s*require\\()/;
  var importLines = (t) => {
    const lines = /* @__PURE__ */ new Set();
    for (let n = t.first[0]; n >= 0; n = t.next[n]) {
      const ty = t.type[n];
      const text = textOf(t, n);
      const isImport = ty === "import_statement" || ty === "export_statement" && /\\bfrom\\s*["']/.test(text) && !/^export\\s+(default\\s+)?(async\\s+)?(function|class|const|let|var|interface|type|enum)\\b/.test(text) || (ty === "lexical_declaration" || ty === "variable_declaration") && /^\\s*(const|let|var)\\b[^=]*=\\s*require\\s*\\(\\s*["'][^"']+["']\\s*\\)\\s*;?\\s*$/.test(text);
      if (isImport) for (let l3 = lineOf(t, t.start[n]); l3 <= lineOf(t, Math.max(t.start[n], t.end[n] - 1)); l3++) lines.add(l3);
    }
    return lines;
  };
  var addedImports = (lines) => {
    const names = (t) => lines.filter((l3) => l3.t === t).flatMap((l3) => l3.text.replace(/['"][^'"]*['"]/g, "").match(/[A-Za-z_$][\\w$]*/g) ?? []);
    const removed = new Set(names("del"));
    const skip = /* @__PURE__ */ new Set(["import", "from", "type", "export", "as", "require", "const", "let", "var", "use", "default"]);
    return uniqBy(names("add").filter((n) => !removed.has(n) && !skip.has(n)), (n) => n);
  };
  var isDeprecated = (lines, start2, lang) => {
    for (let n = start2 - 1; n >= 1 && n >= start2 - 40; n--) {
      const line = lines[n - 1];
      if (!isComment(line, lang) && !/^\\s*@/.test(line)) return false;
      if (/@deprecated\\b/.test(line)) return true;
    }
    return false;
  };
  var parsedChanges = (path, lang, ff, hunks, units) => {
    const text = ff.flat.text.split("\\n");
    const changed = hunks.flatMap((h) => h.lines).filter((l3) => l3.t !== "ctx" && !(l3.t === "add" && (text[l3.at - 1] ?? "").trim() === ""));
    const owners = new Array(text.length + 2).fill(void 0);
    for (const u of ff.units) {
      for (let n = u.docLine; n <= u.endLine; n++) {
        const best = owners[n];
        if (!best || u.endLine - u.docLine < best.endLine - best.docLine) owners[n] = u;
      }
    }
    const owned = /* @__PURE__ */ new Map();
    const loose = [];
    for (const l3 of changed) {
      const owner = owners[l3.at];
      if (owner) push(owned, owner, l3);
      else loose.push(l3);
    }
    const added = new Set(changed.filter((l3) => l3.t === "add").map((l3) => l3.n));
    const symbols = ff.units.flatMap((u) => {
      const ls = owned.get(u);
      if (!ls) return [];
      units.set(u.id, u);
      const ats = ls.map((l3) => l3.at);
      return [
        {
          id: u.id,
          path,
          lang,
          name: u.name,
          label: labelOf(u),
          kind: u.kind,
          status: added.has(u.nameLine) ? "new" : "changed",
          start: u.startLine,
          end: u.endLine,
          from: ats.reduce((a, b2) => Math.min(a, b2)),
          to: ats.reduce((a, b2) => Math.max(a, b2)),
          add: ls.filter((l3) => l3.t === "add").length,
          del: ls.filter((l3) => l3.t === "del").length
        }
      ];
    });
    return { symbols, loose: looseRuns(path, loose) };
  };
  var pinFrom = (s) => Math.min(s.from, s.start);
  var buildReview = (pr, prFiles, analysed) => {
    const { facts } = analysed;
    const heads = new Map([...analysed.texts].map(([path, text]) => [path, text.split("\\n")]));
    const units = /* @__PURE__ */ new Map();
    const files = prFiles.map((f2) => {
      const role = roleOf(f2.path);
      const lang = languageOf(f2.path);
      const whole = f2.patch === void 0 && f2.status === "added" ? analysed.texts.get(f2.path) : void 0;
      const hunks = f2.patch ? parsePatch(f2.patch) : whole !== void 0 ? addedHunks(whole) : [];
      const ff = role === "code" && f2.status !== "removed" ? facts.get(f2.path) : void 0;
      const found = ff ? parsedChanges(f2.path, lang, ff, hunks, units) : role === "code" ? changedSymbols(f2.path, lang, heads.get(f2.path) ?? null, hunks) : { symbols: [], loose: [] };
      const loose = found.loose.filter((r) => !found.symbols.some((s) => pinFrom(s) <= r.from && r.to <= s.end));
      return {
        path: f2.path,
        ...f2.previousPath ? { previousPath: f2.previousPath } : {},
        status: f2.status,
        role,
        lang,
        additions: f2.additions,
        deletions: f2.deletions,
        hunks,
        hasPatch: f2.patch !== void 0 || whole !== void 0,
        symbols: found.symbols,
        loose,
        cases: role === "test" ? testCases(hunks) : []
      };
    });
    const context = { files, heads, facts, refs: analysed.refs, units };
    const draft = files.flatMap((f2) => f2.symbols).length >= 2 ? symbolBoard(context) : fileBoard(context);
    const limited = limit(place({ ...draft, links: linksOf(draft.pins, context) }), files);
    const board = place({ ...limited, links: linksOf(limited.pins, context) });
    const review = { pr, files, ...board, order: [], unpinned: unpinnedOf(board, files) };
    const plan = planBoard(review);
    return { review: { ...review, order: plan.order }, plan };
  };
  var compact = (review) => {
    const carded = new Set(review.pins.map((p) => p.path));
    return { ...review, files: review.files.map((f2) => carded.has(f2.path) ? f2 : { ...f2, hunks: [], symbols: [], loose: [], cases: [] }) };
  };
  var prPin = () => ({ id: "pr", kind: "pr", name: "The pull request", from: 0, to: 0, band: 0, lane: "flow", column: 0, status: "changed", add: 0, del: 0 });
  var nests = (a, b2) => a.path === b2.path && (a.start <= b2.start && b2.end <= a.end || b2.start <= a.start && a.end <= b2.end);
  var innermost = (units, path, offset) => sortBy(
    units.filter((u) => u.path === path && u.start <= offset && offset < u.end),
    (u) => u.end - u.start
  )[0];
  var filePin = (f2, band, lane, column, ranges, name2 = fileName(f2.path)) => ({
    id: \`file:\${f2.path}\`,
    kind: "file",
    name: name2,
    path: f2.path,
    from: ranges ? Math.min(...ranges.map((r) => r.from)) : 1,
    to: ranges ? Math.max(...ranges.map((r) => r.to)) : Number.MAX_SAFE_INTEGER,
    band,
    lane,
    column,
    status: f2.status === "added" ? "new" : "changed",
    add: ranges ? f2.loose.reduce((n, l3) => n + l3.add, 0) : f2.additions,
    del: ranges ? f2.loose.reduce((n, l3) => n + l3.del, 0) : f2.deletions,
    ...ranges ? { ranges } : {}
  });
  var testPins = (files, restBand) => files.filter((f2) => f2.role === "test").map((t) => ({ id: \`test:\${t.path}\`, kind: "test", name: fileName(t.path), path: t.path, from: 1, to: Number.MAX_SAFE_INTEGER, band: restBand, lane: "rest", column: 0, status: t.status === "added" ? "new" : "changed", add: t.additions, del: t.deletions }));
  var symbolBoard = (ctx) => {
    const { files, heads, facts, refs, units } = ctx;
    const symbols = files.flatMap((f2) => f2.symbols);
    const parsed = symbols.filter((s) => units.has(s.id));
    const patterned = symbols.filter((s) => !units.has(s.id));
    const ids = [...parsed, ...patterned].map((s) => s.id);
    const symbolOf = new Map(symbols.map((s) => [s.id, s]));
    const changedUnits = /* @__PURE__ */ new Map();
    for (const u of parsed.map((s) => units.get(s.id))) push(changedUnits, u.path, u);
    const edgeSet = /* @__PURE__ */ new Map();
    for (const r of refs) {
      const src = innermost(changedUnits.get(r.path) ?? [], r.path, r.start);
      if (!src || src.kind === "class") continue;
      for (const target of r.units) {
        if (!units.has(target.id) || target.id === src.id || nests(src, target)) continue;
        edgeSet.set(\`\${src.id}>\${target.id}\`, { from: src.id, to: target.id });
      }
    }
    const edges = [...edgeSet.values(), ...callEdges(patterned, heads)];
    const threads = threadsOf(ids, edges);
    const inThread = new Set(threads.flat());
    const pins = [prPin()];
    const bands = [];
    const restBand = threads.length;
    const changePin = (s, band, lane, column) => {
      const from = pinFrom(s);
      return { id: s.id, kind: "change", name: s.label, path: s.path, symbol: s, from, to: s.end, band, lane, column, status: s.status, add: s.add, del: s.del, head: (heads.get(s.path) ?? []).slice(from - 1, s.end) };
    };
    const within = threadEdges(threads, edges);
    threads.forEach((members, b2) => {
      const depth = layers(members, within[b2]);
      for (const id of members) pins.push(changePin(symbolOf.get(id), b2, "flow", depth.get(id) + 1));
      bands.push({ entries: members.filter((id) => depth.get(id) === 0) });
    });
    for (const id of ids.filter((id2) => !inThread.has(id2))) pins.push(changePin(symbolOf.get(id), restBand, "rest", 0));
    const contextPin = (id, path, name2, from, to, band) => ({
      id,
      kind: "context",
      name: name2,
      path,
      from,
      to,
      band,
      lane: "flow",
      column: 0,
      status: "unchanged",
      add: 0,
      del: 0,
      head: (heads.get(path) ?? []).slice(from - 1, to)
    });
    const changedPaths = new Set(files.map((f2) => f2.path));
    const refsTo = /* @__PURE__ */ new Map();
    for (const r of refs) for (const u of r.units) push(refsTo, u.id, r);
    const candidates = sortBy(
      [...facts.values()].filter((f2) => roleOf(f2.path) === "code").flatMap((f2) => f2.units.filter((u) => u.kind === "function" || u.kind === "method")),
      (u) => u.path,
      (u) => u.startLine
    ).filter((u) => !units.has(u.id));
    const parsedCandidates = (near) => {
      const rank = (u) => u.path === near ? 0 : changedPaths.has(u.path) ? 1 : 2;
      return [0, 1, 2].flatMap((r) => candidates.filter((u) => rank(u) === r));
    };
    const parsedCaller = (entry, band) => {
      const sites = refsTo.get(entry.id) ?? [];
      if (sites.length === 0) return null;
      const around = new Set(sites.map((s) => innermost(facts.get(s.path)?.units ?? [], s.path, s.start)));
      for (const u of parsedCandidates(entry.path)) {
        if (!around.has(u) || nests(u, entry) || entry.name.startsWith("#") && u.path !== entry.path) continue;
        if (isDeprecated(heads.get(u.path) ?? [], u.startLine, languageOf(u.path))) continue;
        return contextPin(\`ctx:\${u.id}\`, u.path, labelOf(u), u.startLine, u.endLine, band);
      }
      return null;
    };
    const unparsed = [...heads.keys()].filter((path) => !facts.has(path));
    const pinnedAt = new Set(symbols.map((s) => \`\${s.path}:\${s.start}\`));
    const callers = new Map(
      sortBy(unparsed, (path) => path).map((path) => [
        path,
        findDecls(heads.get(path), languageOf(path)).filter((d) => (d.kind === "function" || d.kind === "method") && !pinnedAt.has(\`\${path}:\${d.start}\`))
      ])
    );
    const patternedCaller = (e, band) => {
      const paths = [e.path, ...e.lang === "rs" || e.name.startsWith("#") ? [] : [...callers.keys()].filter((path) => path !== e.path)];
      for (const path of paths) {
        for (const d of callers.get(path) ?? []) {
          if (path === e.path && (d.start <= e.start && e.end <= d.end || e.start <= d.start && d.end <= e.end)) continue;
          const lines = heads.get(path);
          if (isDeprecated(lines, d.start, languageOf(path))) continue;
          if (callsTo(path, lines, languageOf(path), d, e).length > 0) return contextPin(\`ctx:\${path}:\${d.start}\`, path, labelOf(d, languageOf(path)), d.start, d.end, band);
        }
      }
      return null;
    };
    const callerIds = /* @__PURE__ */ new Set();
    bands.forEach((band, b2) => {
      for (const entry of band.entries) {
        const unit = units.get(entry);
        const caller = unit ? parsedCaller(unit, b2) : patternedCaller(symbolOf.get(entry), b2);
        if (!caller) continue;
        if (!callerIds.has(caller.id)) pins.push(caller);
        callerIds.add(caller.id);
        return;
      }
    });
    for (const f2 of files) {
      if (f2.role === "test") continue;
      const whole = f2.role !== "code" || f2.symbols.length === 0;
      if (!whole && f2.loose.length === 0) continue;
      const ranges = whole ? void 0 : f2.loose.map((l3) => ({ from: l3.from, to: l3.to }));
      const ff = facts.get(f2.path);
      const inImports = ff ? importLines(ff.flat) : /* @__PURE__ */ new Set();
      const lines = whole ? [] : f2.hunks.flatMap((h) => h.lines).filter((l3) => l3.t !== "ctx" && l3.text.trim() !== "" && ranges.some((r) => l3.at >= r.from && l3.at <= r.to));
      const imports = lines.length > 0 && lines.every((l3) => inImports.has(l3.n ?? l3.at) || IMPORT_LINE.test(l3.text));
      pins.push(filePin(f2, restBand, "rest", 0, ranges, whole ? fileName(f2.path) : imports ? \`\${fileName(f2.path)} imports\` : \`\${fileName(f2.path)}, other lines\`));
    }
    pins.push(...testPins(files, restBand));
    return { mode: "symbols", pins, bands };
  };
  var fileBoard = (ctx) => {
    const { files, refs, heads } = ctx;
    const code = files.filter((f2) => f2.role === "code");
    const ids = code.map((f2) => \`file:\${f2.path}\`);
    const codePaths = new Set(code.map((f2) => f2.path));
    const edgeSet = /* @__PURE__ */ new Map();
    for (const r of refs) {
      if (!codePaths.has(r.path)) continue;
      for (const u of r.units) if (u.path !== r.path && codePaths.has(u.path)) edgeSet.set(\`\${r.path}>\${u.path}\`, { from: \`file:\${r.path}\`, to: \`file:\${u.path}\` });
    }
    const edges = [...edgeSet.values(), ...pythonImports(code, heads).map((e) => ({ from: \`file:\${e.from}\`, to: \`file:\${e.to}\` }))];
    const threads = threadsOf(ids, edges);
    const pins = [prPin()];
    const bands = [];
    const fileOf = /* @__PURE__ */ new Map();
    for (const f2 of files) if (!fileOf.has(\`file:\${f2.path}\`)) fileOf.set(\`file:\${f2.path}\`, f2);
    const within = threadEdges(threads, edges);
    threads.forEach((members, b2) => {
      const depth = layers(members, within[b2]);
      for (const id of members) pins.push(filePin(fileOf.get(id), b2, "flow", depth.get(id) + 1));
      bands.push({ entries: members.filter((id) => depth.get(id) === 0) });
    });
    const placed = new Set(pins.map((p) => p.id));
    for (const f2 of files) if (f2.role !== "test" && !placed.has(\`file:\${f2.path}\`)) pins.push(filePin(f2, threads.length, "rest", 0));
    pins.push(...testPins(files, threads.length));
    return { mode: "files", pins, bands };
  };
  var link = (kind, from, to, rows, at2, reads) => ({
    id: \`\${kind}:\${from}>\${to}\`,
    from,
    to,
    kind,
    ...reads ? { reads } : {},
    ...at2 !== void 0 ? { at: at2 } : {},
    rows: [...rows]
  });
  var startRow = (calls, rows, changed) => calls.find((n) => changed.has(n)) ?? calls[0] ?? rows.find((n) => changed.has(n)) ?? rows[0];
  var linksOf = (pins, ctx) => {
    const { files, facts, refs, units, heads } = ctx;
    const regions = [];
    const represented = /* @__PURE__ */ new Map();
    const pinIds = new Set(pins.map((p) => p.id));
    const changedUnits = /* @__PURE__ */ new Map();
    for (const u of units.values()) push(changedUnits, u.path, u);
    const offsetOfLine = (path, line, end = false) => {
      const t = facts.get(path)?.flat;
      if (!t) return 0;
      if (line > t.lineStarts.length) return t.text.length;
      return end ? line < t.lineStarts.length ? t.lineStarts[line] : t.text.length : t.lineStarts[Math.max(0, line - 1)];
    };
    const unitOfPin = /* @__PURE__ */ new Map();
    const unitOf = (p) => {
      if (!unitOfPin.has(p)) unitOfPin.set(p, units.get(p.id) ?? (p.kind === "context" && p.path ? facts.get(p.path)?.units.find((u) => \`ctx:\${u.id}\` === p.id) : void 0));
      return unitOfPin.get(p);
    };
    for (const p of pins) {
      const u = unitOf(p);
      if (!p.path || !u) continue;
      regions.push({ pin: p, path: p.path, start: u.start, end: u.end });
      represented.set(u.id, p.id);
      for (const x2 of changedUnits.get(u.path) ?? []) if (x2 !== u && u.start <= x2.start && x2.end <= u.end && !pinIds.has(x2.id)) represented.set(x2.id, p.id);
    }
    for (const p of pins) {
      if (!p.path || p.kind !== "file" && p.kind !== "test") continue;
      const t = facts.get(p.path)?.flat;
      if (!t) continue;
      if (p.kind === "test" || !p.ranges) {
        regions.push({ pin: p, path: p.path, start: 0, end: t.text.length });
        if (p.kind === "file") {
          for (const x2 of changedUnits.get(p.path) ?? []) if (!represented.has(x2.id)) represented.set(x2.id, p.id);
        }
        continue;
      }
      for (const r of p.ranges) regions.push({ pin: p, path: p.path, start: offsetOfLine(p.path, r.from), end: offsetOfLine(p.path, r.to, true) });
    }
    const regionsIn = /* @__PURE__ */ new Map();
    const regionsOf = /* @__PURE__ */ new Map();
    for (const r of regions) {
      push(regionsIn, r.path, r);
      push(regionsOf, r.pin, r);
    }
    const pinAt = (path, offset) => {
      let best = null;
      for (const r of regionsIn.get(path) ?? []) if (offset >= r.start && offset < r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
      return best?.pin ?? null;
    };
    const holds = (a, b2) => {
      const ra = regionsOf.get(a) ?? [];
      const rb = regionsOf.get(b2) ?? [];
      return rb.length > 0 && rb.every((y2) => ra.some((x2) => x2.path === y2.path && x2.start <= y2.start && y2.end <= x2.end));
    };
    const isDecl = (p) => (p.kind === "change" || p.kind === "context") && unitOf(p) !== void 0;
    const pinById = new Map(pins.map((p) => [p.id, p]));
    const pairs = /* @__PURE__ */ new Map();
    for (const r of refs) {
      const from = pinAt(r.path, r.start);
      if (!from) continue;
      for (const u of r.units) {
        const to = pinById.get(represented.get(u.id) ?? "");
        if (!to || to === from) continue;
        if (isDecl(from) && isDecl(to) && (holds(from, to) || holds(to, from))) continue;
        const key = \`\${from.id}>\${to.id}\`;
        const pair = pairs.get(key) ?? { from, to, refs: [], seen: /* @__PURE__ */ new Set() };
        if (!pair.seen.has(r)) {
          pair.seen.add(r);
          pair.refs.push(r);
        }
        pairs.set(key, pair);
      }
    }
    const fileByPath = new Map(files.map((f2) => [f2.path, f2]));
    const addedLines = /* @__PURE__ */ new Map();
    const changedIn = (path = "") => {
      let hit = addedLines.get(path);
      if (!hit) {
        const f2 = fileByPath.get(path);
        hit = new Set(f2 ? f2.hunks.flatMap((h) => h.lines).filter((l3) => l3.t === "add").map((l3) => l3.n) : []);
        addedLines.set(path, hit);
      }
      return hit;
    };
    const links = [...pairs.values()].map(({ from, to, refs: rs }) => {
      const calls = [...new Set(rs.filter((r) => r.ref === "call").map((r) => r.line))].sort((a, b2) => a - b2);
      const all = [...new Set(rs.map((r) => r.line))].sort((a, b2) => a - b2);
      const kind = from.kind === "test" ? "tests" : from.kind === "context" ? "context" : calls.length > 0 ? "calls" : rs.some((r) => r.ref !== "import" && r.ref !== "export") ? "uses" : "imports";
      const rows = kind === "calls" || kind === "context" && calls.length > 0 ? calls : all;
      return link(kind, from.id, to.id, rows, startRow(calls, all, changedIn(from.path)), kind === "context" ? calls.length > 0 ? "calls" : "uses" : void 0);
    });
    const patterned = pins.filter((p) => p.kind === "change" && p.symbol && !units.has(p.id)).map((p) => p.symbol);
    for (const e of callEdges(patterned, heads)) links.push(link("calls", e.from, e.to, e.calls, startRow(e.calls, e.calls, changedIn(pinById.get(e.from)?.path))));
    const flowIds = /* @__PURE__ */ new Map();
    for (const p of pins) if (p.lane === "flow") flowIds.set(p.band, (flowIds.get(p.band) ?? /* @__PURE__ */ new Set()).add(p.id));
    for (const c of pins.filter((p) => p.kind === "context" && !unitOf(p))) {
      const lines = heads.get(c.path) ?? [];
      for (const s of patterned.filter((x2) => x2.id !== c.id && (flowIds.get(c.band)?.has(x2.id) ?? false))) {
        const calls = callsTo(c.path, lines, languageOf(c.path), { start: c.from, end: c.to, kind: "function" }, s);
        if (calls.length > 0) links.push(link("context", c.id, s.id, calls, calls[0], "calls"));
      }
    }
    const symbols = pins.filter((p) => p.kind === "change" && p.symbol).map((p) => p.symbol);
    for (const p of pins.filter((x2) => x2.kind === "file" && x2.ranges && x2.name.endsWith(" imports") && !facts.has(x2.path) && languageOf(x2.path) !== "rs")) {
      const f2 = files.find((x2) => x2.path === p.path);
      const lines = f2.hunks.flatMap((h) => h.lines).filter((l3) => l3.t !== "ctx" && p.ranges.some((r) => l3.at >= r.from && l3.at <= r.to));
      const names = new Set(addedImports(lines));
      for (const s of symbols) {
        if (s.path === p.path || s.name.startsWith("#") || !names.has(s.name)) continue;
        const row = lines.find((l3) => l3.t === "add" && new RegExp(\`\\\\b\${s.name.replace(/\\$/g, "\\\\$")}\\\\b\`).test(l3.text))?.n;
        links.push(link("imports", p.id, s.id, row ? [row] : [], row));
      }
    }
    const fileIds = new Set(pins.filter((p) => p.kind === "file").map((p) => p.id));
    for (const e of pythonImports(files.filter((f2) => f2.role === "code"), heads)) {
      const from = \`file:\${e.from}\`;
      const to = \`file:\${e.to}\`;
      if (fileIds.has(from) && fileIds.has(to) && pinById.get(from).lane === "flow") links.push(link("imports", from, to, [e.at], e.at));
    }
    return uniqBy(links, (l3) => \`\${l3.from}>\${l3.to}\`);
  };
  var place = (board) => {
    const restBand = board.bands.length;
    const flowBands = /* @__PURE__ */ new Map();
    const codeBands = /* @__PURE__ */ new Map();
    for (const p of board.pins) {
      if (p.lane !== "flow") continue;
      if (!flowBands.has(p.id)) flowBands.set(p.id, p.band);
      if ((p.kind === "change" || p.kind === "file") && !codeBands.has(p.id)) codeBands.set(p.id, p.band);
    }
    const linksFrom = /* @__PURE__ */ new Map();
    for (const l3 of board.links) push(linksFrom, l3.from, l3);
    return {
      ...board,
      pins: board.pins.map((p) => {
        if (p.kind === "test") {
          const bands2 = (linksFrom.get(p.id) ?? []).filter((l3) => l3.kind === "tests").map((l3) => codeBands.get(l3.to)).filter((b2) => b2 !== void 0);
          return bands2.length > 0 ? { ...p, lane: "under", band: Math.min(...bands2) } : { ...p, lane: "rest", band: restBand };
        }
        if (p.kind !== "file" || p.lane === "flow") return p;
        const bands = new Set((linksFrom.get(p.id) ?? []).map((l3) => flowBands.get(l3.to)));
        const [band] = bands;
        return bands.size === 1 && band !== void 0 ? { ...p, lane: "under", band } : { ...p, lane: "rest", band: restBand };
      })
    };
  };
  var limit = (board, files) => {
    const { pins, bands, links } = board;
    if (pins.length <= LIMITS.cards) return board;
    const index = new Map(pins.map((p, i2) => [p.id, i2]));
    const ranks = new Map(pins.filter((p) => p.lane === "rest").map((p) => [p.id, laneRank(p, files)]));
    const inBand = /* @__PURE__ */ new Map();
    for (const p of pins) push(inBand, p.band, p);
    const flow = (b2) => sortBy(
      (inBand.get(b2) ?? []).filter((p) => p.lane === "flow" && p.kind !== "pr" && p.kind !== "context"),
      (p) => p.column,
      (p) => index.get(p.id)
    );
    const tail = (b2) => {
      const band = inBand.get(b2) ?? [];
      return [...band.filter((p) => p.kind === "context"), ...band.filter((p) => p.lane === "under")];
    };
    const rest = sortBy(
      pins.filter((p) => p.lane === "rest"),
      (p) => ranks.get(p.id)[0],
      (p) => -(p.add + p.del),
      (p) => ranks.get(p.id)[1],
      (p) => ranks.get(p.id)[2]
    );
    const nearest = [pins[0], ...bands.flatMap((_2, b2) => [...flow(b2), ...tail(b2)]), ...rest];
    const calls = /* @__PURE__ */ new Map();
    const linked = /* @__PURE__ */ new Map();
    for (const l3 of links) {
      push(calls, l3.from, l3.to);
      push(linked, l3.from, l3.to);
      push(linked, l3.to, l3.from);
    }
    const shared = (ids) => [...ids].reduce((n, id) => n + (calls.get(id) ?? []).filter((x2) => ids.has(x2)).length, 0);
    const grow = (entry, members, tree) => {
      const queue = [entry.id];
      const seen = /* @__PURE__ */ new Set();
      while (queue.length > 0 && tree.size < LIMITS.part) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        tree.add(id);
        const next = (calls.get(id) ?? []).filter((x2) => members.has(x2) && !seen.has(x2));
        queue.push(...sortBy(next, (x2) => -(calls.get(x2)?.length ?? 0), (x2) => index.get(x2)).slice(0, 3));
      }
      return tree;
    };
    const part = (b2) => {
      const members = flow(b2);
      if (members.length <= LIMITS.part) return [...members, ...tail(b2)];
      const ids = new Set(members.map((p) => p.id));
      const first = Math.min(...members.map((p) => p.column));
      const firsts = members.filter((p) => p.column === first);
      const own = new Map(firsts.map((e) => [e, shared(grow(e, ids, /* @__PURE__ */ new Set()))]));
      const entries = sortBy(
        firsts,
        (e) => -own.get(e),
        (e) => index.get(e.id)
      );
      const tree = /* @__PURE__ */ new Set();
      for (const e of entries) if (tree.size < LIMITS.part) grow(e, ids, tree);
      return [...members.filter((p) => tree.has(p.id)), ...tail(b2).filter((p) => (linked.get(p.id) ?? []).some((x2) => tree.has(x2)))];
    };
    const parts2 = bands.map((_2, b2) => part(b2));
    const inParts = new Set(parts2.flat().map((p) => p.id));
    const grown = [pins[0], ...parts2.flat(), ...bands.flatMap((_2, b2) => [...flow(b2), ...tail(b2)].filter((p) => !inParts.has(p.id))), ...rest];
    const cut = (order) => new Set(order.slice(0, LIMITS.cards).map((p) => p.id));
    const byNearest = cut(nearest);
    const byParts = cut(grown);
    const keep = shared(byParts) > shared(byNearest) ? byParts : byNearest;
    const kept = bands.filter((_2, b2) => (inBand.get(b2) ?? []).some((p) => p.lane === "flow" && p.kind !== "pr" && keep.has(p.id)));
    const bandOf = new Map(bands.map((b2, i2) => [b2, i2]));
    const renumber = new Map(kept.map((b2, i2) => [bandOf.get(b2), i2]));
    return {
      ...board,
      pins: pins.filter((p) => keep.has(p.id)).map((p) => ({ ...p, band: p.lane === "rest" ? kept.length : renumber.get(p.band) ?? kept.length })),
      bands: kept.map((b2) => ({ entries: b2.entries.filter((id) => keep.has(id)) }))
    };
  };
  var unpinnedOf = (board, files) => {
    const pinned = new Set(board.pins.map((p) => p.id));
    const lost = board.mode === "symbols" ? files.flatMap((f2) => f2.symbols).filter((s) => !pinned.has(s.id)) : [];
    const carded = new Set(board.pins.map((p) => p.path));
    const counted = new Set(lost.map((s) => s.path));
    return { functions: lost.length, files: files.filter((f2) => !carded.has(f2.path) && !counted.has(f2.path)).length };
  };

  // src/worker/serve.ts
  var PARSER = "parser";
  var parserError = (err2) => {
    if (err2 instanceof Error && err2.cause === PARSER) return err2;
    console.error("[pr-blackboard] the parser won't run", err2);
    return new Error(err2 instanceof Error ? err2.message : String(err2), { cause: PARSER });
  };
  var serve = (scope, start2 = createSyntax) => {
    const github = createGithub((url, init2) => scope.fetch(url, init2));
    let asks = 0;
    const answers = /* @__PURE__ */ new Map();
    const fileOf = (name2) => new Promise((resolve, reject) => {
      const ask = asks++;
      answers.set(ask, (bytes) => bytes ? resolve(bytes) : reject(new Error(\`No \${name2} file\`, { cause: PARSER })));
      scope.postMessage({ type: "file", ask, name: name2 });
    });
    let syntax = null;
    const added = /* @__PURE__ */ new Map();
    const load = async (grammar) => {
      try {
        if (!syntax) {
          syntax = fileOf("runtime").then(start2);
          syntax.catch(() => syntax = null);
        }
        const s = await syntax;
        let hit = added.get(grammar);
        if (!hit) {
          hit = fileOf(grammar).then((bytes) => s.add(grammar, bytes));
          hit.catch(() => added.delete(grammar));
          added.set(grammar, hit);
        }
        await hit;
        return s;
      } catch (err2) {
        throw parserError(err2);
      }
    };
    const parse2 = async (path, text) => {
      const grammar = grammarOf(path);
      if (!grammar) return null;
      const s = await load(grammar);
      try {
        return parseFacts(s, path, text);
      } catch (err2) {
        console.warn(\`[pr-blackboard] couldn't parse \${path}\`, err2);
        return null;
      }
    };
    const run2 = async ({ id, pr, files }) => {
      try {
        const grammars = [...new Set(changedSources(files).map((f2) => grammarOf(f2.path)).filter((x2) => x2 !== null))];
        scope.postMessage({ type: "load", id, grammars });
        const { review, plan } = await analyse(pr, files, (path) => github.raw(pr.headRepo, pr.headSha, path), parse2);
        scope.postMessage({ type: "done", id, review: compact(review), plan });
      } catch (err2) {
        scope.postMessage({ type: "failed", id, message: err2 instanceof Error ? err2.message : String(err2), parser: err2 instanceof Error && err2.cause === PARSER });
      }
    };
    scope.onmessage = ({ data }) => {
      if (data.type === "analyse") {
        void run2(data);
        return;
      }
      answers.get(data.ask)?.(data.bytes);
      answers.delete(data.ask);
    };
  };

  // src/worker/main.ts
  serve(self);
})();
`;
