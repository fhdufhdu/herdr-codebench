package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

type editorTextEdit struct {
	Range   lspRange `json:"range"`
	NewText string   `json:"newText"`
}

func (edit *editorTextEdit) UnmarshalJSON(raw []byte) error {
	var wire struct {
		Range    *lspRange       `json:"range"`
		Text     *string         `json:"newText"`
		URI      json.RawMessage `json:"uri"`
		Document json.RawMessage `json:"textDocument"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return err
	}
	if wire.Range == nil || wire.Text == nil {
		return errors.New("edit range and newText are required")
	}
	if wire.URI != nil || wire.Document != nil {
		return errors.New("cross-file editor edits are not supported")
	}
	edit.Range, edit.NewText = *wire.Range, *wire.Text
	return nil
}

type editorCompletionItem struct {
	Label      string           `json:"label"`
	Detail     string           `json:"detail,omitempty"`
	SortText   string           `json:"sort_text,omitempty"`
	FilterText string           `json:"filter_text,omitempty"`
	InsertText string           `json:"insert_text"`
	TextEdit   *editorTextEdit  `json:"text_edit,omitempty"`
	Additional []editorTextEdit `json:"additional_text_edits,omitempty"`
	Disabled   string           `json:"disabled_reason,omitempty"`
	Item       json.RawMessage  `json:"item,omitempty"`
}

func editorOffset(text string, point lspPosition) (int, error) {
	if point.Line < 0 || point.Character < 0 {
		return 0, errors.New("negative editor position")
	}
	lines := strings.Split(text, "\n")
	if point.Line >= len(lines) {
		return 0, errors.New("editor line exceeds buffer")
	}
	offset := 0
	for _, line := range lines[:point.Line] {
		offset += utf16Len(line) + 1
	}
	column := 0
	for _, r := range strings.TrimSuffix(lines[point.Line], "\r") {
		if column == point.Character {
			return offset + column, nil
		}
		if r > 0xffff {
			column += 2
		} else {
			column++
		}
		if column > point.Character {
			return 0, errors.New("editor position splits a surrogate pair")
		}
	}
	if column != point.Character {
		return 0, errors.New("editor column exceeds buffer")
	}
	return offset + column, nil
}
func validateEditorEdits(text string, edits []editorTextEdit) error {
	type span struct{ from, to int }
	spans := make([]span, 0, len(edits))
	for _, edit := range edits {
		if !utf8.ValidString(edit.NewText) {
			return errors.New("invalid edit text")
		}
		from, err := editorOffset(text, edit.Range.Start)
		if err != nil {
			return err
		}
		to, err := editorOffset(text, edit.Range.End)
		if err != nil {
			return err
		}
		if to < from {
			return errors.New("reversed editor edit range")
		}
		spans = append(spans, span{from, to})
	}
	sort.Slice(spans, func(i, j int) bool {
		if spans[i].from == spans[j].from {
			return spans[i].to < spans[j].to
		}
		return spans[i].from < spans[j].from
	})
	for i := 1; i < len(spans); i++ {
		if spans[i].from < spans[i-1].to || spans[i].from == spans[i-1].from {
			return errors.New("overlapping or ambiguous editor edits")
		}
	}
	return nil
}
func (s *LSPServer) editorCapability(name string, out any) bool {
	s.mu.Lock()
	raw := append(json.RawMessage(nil), s.capabilities[name]...)
	s.mu.Unlock()
	if len(raw) == 0 || string(raw) == "false" || string(raw) == "null" {
		return false
	}
	return out == nil || json.Unmarshal(raw, out) == nil
}

// plainCompletionSnippet keeps literal text and initial placeholder defaults.
// It does not create tabstop sessions or evaluate variables/transforms.
func plainCompletionSnippet(source string) (string, error) {
	if len(source) > 256<<10 {
		return "", errors.New("snippet is too large")
	}
	at := 0
	values := map[string]string{}
	var parse func(bool, int) (string, error)
	parse = func(nested bool, depth int) (string, error) {
		if depth > 16 {
			return "", errors.New("snippet nesting is too deep")
		}
		var out strings.Builder
		for at < len(source) {
			if out.Len() > 256<<10 {
				return "", errors.New("expanded snippet is too large")
			}
			ch := source[at]
			if nested && ch == '}' {
				at++
				return out.String(), nil
			}
			if ch == '\\' && at+1 < len(source) && strings.ContainsRune("\\$}", rune(source[at+1])) {
				out.WriteByte(source[at+1])
				at += 2
				continue
			}
			if ch != '$' {
				out.WriteByte(ch)
				at++
				continue
			}
			at++
			braced := at < len(source) && source[at] == '{'
			if braced {
				at++
			}
			start := at
			for at < len(source) && source[at] >= '0' && source[at] <= '9' {
				at++
			}
			if start == at {
				return "", errors.New("snippet variables or malformed placeholders are not supported")
			}
			key := source[start:at]
			value := values[key]
			if braced {
				if at >= len(source) {
					return "", errors.New("unclosed snippet placeholder")
				}
				switch source[at] {
				case '}':
					at++
				case ':':
					at++
					var err error
					value, err = parse(true, depth+1)
					if err != nil {
						return "", err
					}
					values[key] = value
				case '|':
					at++
					var first strings.Builder
					selected, closed := true, false
					for at < len(source) {
						c := source[at]
						at++
						if c == '\\' && at < len(source) && strings.ContainsRune("\\,|", rune(source[at])) {
							if selected {
								first.WriteByte(source[at])
							}
							at++
							continue
						}
						if c == '|' && at < len(source) && source[at] == '}' {
							at++
							closed = true
							break
						}
						if c == '|' {
							return "", errors.New("malformed snippet choice")
						}
						if c == ',' {
							selected = false
						} else if selected {
							first.WriteByte(c)
						}
					}
					if !closed {
						return "", errors.New("unclosed snippet choice")
					}
					value = first.String()
					values[key] = value
				default:
					return "", errors.New("snippet transforms are not supported")
				}
			}
			out.WriteString(value)
		}
		if nested {
			return "", errors.New("unclosed snippet placeholder")
		}
		if out.Len() > 256<<10 {
			return "", errors.New("expanded snippet is too large")
		}
		return out.String(), nil
	}
	return parse(false, 0)
}

func completionItem(raw json.RawMessage, text string) editorCompletionItem {
	item := editorCompletionItem{Item: raw}
	var wire struct {
		Label      string           `json:"label"`
		Detail     string           `json:"detail"`
		Sort       string           `json:"sortText"`
		Filter     string           `json:"filterText"`
		Insert     *string          `json:"insertText"`
		Format     int              `json:"insertTextFormat"`
		Edit       json.RawMessage  `json:"textEdit"`
		Additional []editorTextEdit `json:"additionalTextEdits"`
		Command    json.RawMessage  `json:"command"`
	}
	if len(raw) > 256<<10 || json.Unmarshal(raw, &wire) != nil || wire.Label == "" {
		item.Disabled = "Invalid or oversized completion item"
		item.Item = nil
		return item
	}
	item.Label, item.Detail, item.SortText, item.FilterText = wire.Label, wire.Detail, wire.Sort, wire.Filter
	item.InsertText = wire.Label
	if wire.Insert != nil {
		item.InsertText = *wire.Insert
	}
	if len(wire.Command) > 0 && string(wire.Command) != "null" {
		item.Disabled = "Completion commands are not supported"
	}
	if len(wire.Edit) > 0 && string(wire.Edit) != "null" {
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(wire.Edit, &fields)
		if fields["range"] == nil {
			item.Disabled = "Insert/replace completion edits are not supported"
		} else {
			var edit editorTextEdit
			if err := json.Unmarshal(wire.Edit, &edit); err != nil {
				item.Disabled = "Invalid completion edit"
			} else {
				item.TextEdit = &edit
			}
		}
	}
	if wire.Format == 2 {
		// Only the main insertion is a snippet. AdditionalTextEdits are plain LSP text.
		target := &item.InsertText
		if item.TextEdit != nil {
			target = &item.TextEdit.NewText
		}
		plain, err := plainCompletionSnippet(*target)
		if err != nil {
			item.Disabled = "Unsupported completion snippet: " + err.Error()
			*target = "" // Never expose snippet syntax as an applicable insertion.
			item.InsertText = ""
		} else {
			*target = plain
			item.InsertText = plain
		}
	}
	item.Additional = wire.Additional
	edits := append([]editorTextEdit(nil), item.Additional...)
	if item.TextEdit != nil {
		edits = append(edits, *item.TextEdit)
	}
	if err := validateEditorEdits(text, edits); err != nil {
		item.Disabled = err.Error()
	}
	return item
}
func completionList(raw json.RawMessage, text string) (any, error) {
	var items []json.RawMessage
	incomplete := false
	var defaults map[string]json.RawMessage
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{"items": []editorCompletionItem{}, "incomplete": false}, nil
	}
	if raw[0] == '[' {
		if err := json.Unmarshal(raw, &items); err != nil {
			return nil, err
		}
	} else {
		var list struct {
			Items      []json.RawMessage          `json:"items"`
			Incomplete bool                       `json:"isIncomplete"`
			Defaults   map[string]json.RawMessage `json:"itemDefaults"`
		}
		if err := json.Unmarshal(raw, &list); err != nil {
			return nil, err
		}
		items, incomplete, defaults = list.Items, list.Incomplete, list.Defaults
	}
	out := make([]editorCompletionItem, 0, min(len(items), 100))
	size := 0
	for _, rawItem := range items {
		if len(defaults) > 0 {
			var fields map[string]json.RawMessage
			if json.Unmarshal(rawItem, &fields) == nil {
				for _, name := range []string{"insertTextFormat", "data"} {
					if fields[name] == nil && defaults[name] != nil {
						fields[name] = defaults[name]
					}
				}
				if fields["textEdit"] == nil && defaults["editRange"] != nil {
					newText := fields["textEditText"]
					if newText == nil {
						newText = fields["insertText"]
					}
					if newText == nil {
						newText = fields["label"]
					}
					fields["textEdit"], _ = json.Marshal(map[string]json.RawMessage{"range": defaults["editRange"], "newText": newText})
					var rangeFields map[string]json.RawMessage
					_ = json.Unmarshal(defaults["editRange"], &rangeFields)
					if rangeFields["start"] == nil {
						fields["textEdit"] = defaults["editRange"]
					}
				}
				rawItem, _ = json.Marshal(fields)
			}
		}
		item := completionItem(rawItem, text)
		size += len(rawItem)
		if len(out) >= 100 || size > 4<<20 {
			incomplete = true
			break
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].SortText, out[j].SortText
		if a == "" {
			a = out[i].Label
		}
		if b == "" {
			b = out[j].Label
		}
		return a < b
	})
	return map[string]any{"items": out, "incomplete": incomplete}, nil
}
func editorRequest(ctx context.Context, server *LSPServer, uri string, snapshot *documentSnapshot, route string, req Request) (any, error) {
	if snapshot == nil {
		return nil, errors.New("buffered document is required")
	}
	var provider struct {
		Resolve  bool     `json:"resolveProvider"`
		Triggers []string `json:"triggerCharacters"`
	}
	if route == "formatting" {
		if !server.editorCapability("documentFormattingProvider", nil) {
			return nil, errors.New("language server formatting is not supported")
		}
		size := req.TabSize
		if size == 0 {
			size = 4
		}
		if size < 1 || size > 16 {
			return nil, errors.New("tab_size must be 1–16")
		}
		spaces := true
		if req.InsertSpaces != nil {
			spaces = *req.InsertSpaces
		}
		raw, err := server.Call(ctx, "textDocument/formatting", map[string]any{"textDocument": map[string]any{"uri": uri}, "options": map[string]any{"tabSize": size, "insertSpaces": spaces}})
		if err != nil {
			return nil, err
		}
		edits := []editorTextEdit{}
		if string(raw) != "null" {
			if err = json.Unmarshal(raw, &edits); err != nil {
				return nil, err
			}
		}
		if err = validateEditorEdits(snapshot.text, edits); err != nil {
			return nil, err
		}
		return map[string]any{"edits": edits}, nil
	}
	if !server.editorCapability("completionProvider", &provider) {
		return nil, errors.New("language server completion is not supported")
	}
	if route == "completion_resolve" {
		if len(req.CompletionItem) == 0 || len(req.CompletionItem) > 256<<10 {
			return nil, errors.New("completion_item is required and bounded")
		}
		raw := req.CompletionItem
		if provider.Resolve {
			resolved, err := server.Call(ctx, "completionItem/resolve", raw)
			if err != nil {
				return nil, err
			}
			var original, patch map[string]json.RawMessage
			if json.Unmarshal(raw, &original) != nil || json.Unmarshal(resolved, &patch) != nil {
				return nil, errors.New("invalid resolved completion")
			}
			for key, value := range patch {
				original[key] = value
			}
			raw, _ = json.Marshal(original)
		}
		return completionItem(raw, snapshot.text), nil
	}
	if _, err := editorOffset(snapshot.text, lspPosition{Line: req.Line, Character: req.Col}); err != nil {
		return nil, fmt.Errorf("completion position: %w", err)
	}
	raw, err := server.Call(ctx, "textDocument/completion", map[string]any{"textDocument": map[string]any{"uri": uri}, "position": map[string]int{"line": req.Line, "character": req.Col}, "context": map[string]int{"triggerKind": 1}})
	if err != nil {
		return nil, err
	}
	result, err := completionList(raw, snapshot.text)
	if err != nil {
		return nil, err
	}
	value := result.(map[string]any)
	value["resolve_supported"] = provider.Resolve
	value["trigger_characters"] = provider.Triggers
	return value, nil
}
