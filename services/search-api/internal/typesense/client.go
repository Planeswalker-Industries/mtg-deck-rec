// Package typesense is a thin HTTP client for the endpoints this service actually uses.
//
// Documents pass through as json.RawMessage rather than being modelled in Go. The document shape is defined once,
// in packages/core/src/search/documents.ts, and is shared by the worker that writes it and the app that reads it —
// restating it here would give it a third definition to drift from. The only fields this package knows by name are
// the two it has to read to answer a question: `card_id` and `slug`.
package typesense

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(baseURL, apiKey string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		http:    &http.Client{Timeout: timeout},
	}
}

// Error carries Typesense's status code so callers can tell "not found" from "broken", which is the difference
// between an empty answer and a failure worth reporting.
type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string {
	return fmt.Sprintf("typesense: HTTP %d: %s", e.Status, truncate(e.Body, 300))
}

func (e *Error) NotFound() bool { return e.Status == http.StatusNotFound }

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func (c *Client) do(ctx context.Context, method, path string, body io.Reader, contentType string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-TYPESENSE-API-KEY", c.apiKey)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, &Error{Status: res.StatusCode, Body: string(payload)}
	}
	return payload, nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	contentType := ""
	if in != nil {
		encoded, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
		contentType = "application/json"
	}
	payload, err := c.do(ctx, method, path, body, contentType)
	if err != nil {
		return err
	}
	if out == nil || len(payload) == 0 {
		return nil
	}
	return json.Unmarshal(payload, out)
}

// --- searching ---

// SearchParams mirrors the query string Typesense's search endpoint takes. Only the fields this service sends are
// here; anything else would be a knob nobody turns.
type SearchParams struct {
	Collection     string `json:"collection"`
	Q              string `json:"q"`
	QueryBy        string `json:"query_by,omitempty"`
	QueryByWeights string `json:"query_by_weights,omitempty"`
	FilterBy       string `json:"filter_by,omitempty"`
	SortBy         string `json:"sort_by,omitempty"`
	IncludeFields  string `json:"include_fields,omitempty"`
	PerPage        int    `json:"per_page,omitempty"`
	Page           int    `json:"page,omitempty"`
	// Offset/Limit are the alternative to Page/PerPage, for a caller that pages by a row offset rather than by page
	// number. Set one pair or the other, never both.
	Limit  int `json:"limit,omitempty"`
	Offset int `json:"offset,omitempty"`
	Prefix         *bool  `json:"prefix,omitempty"`
	// One value per query_by field, e.g. "off,always,always". Only fields declared `infix: true` may be anything
	// but off.
	Infix string `json:"infix,omitempty"`
}

type Hit struct {
	Document json.RawMessage `json:"document"`
}

type SearchResult struct {
	Found int    `json:"found"`
	Hits  []Hit  `json:"hits"`
	Code  int    `json:"code"`
	Error string `json:"error"`
}

// MaxPerPage is Typesense's ceiling on a single page, and therefore the size every batched read chunks to.
const MaxPerPage = 250

// MultiSearch sends several searches in one round trip. Every batched read here is built on it: a 500-id fetch is
// two 250-id filters, and one request beats two.
func (c *Client) MultiSearch(ctx context.Context, searches []SearchParams) ([]SearchResult, error) {
	var out struct {
		Results []SearchResult `json:"results"`
	}
	if len(searches) == 0 {
		return nil, nil
	}
	if err := c.doJSON(ctx, http.MethodPost, "/multi_search", map[string]any{"searches": searches}, &out); err != nil {
		return nil, err
	}
	// A multi_search answers 200 even when an individual search failed, so each result carries its own error.
	for _, r := range out.Results {
		if r.Error != "" {
			return nil, &Error{Status: r.Code, Body: r.Error}
		}
	}
	return out.Results, nil
}

func (c *Client) Search(ctx context.Context, params SearchParams) (SearchResult, error) {
	results, err := c.MultiSearch(ctx, []SearchParams{params})
	if err != nil {
		return SearchResult{}, err
	}
	if len(results) == 0 {
		return SearchResult{}, nil
	}
	return results[0], nil
}

// --- documents ---

type ImportResult struct {
	Imported int      `json:"imported"`
	Failures []string `json:"failures"`
}

// Import upserts a JSONL batch. Typesense answers with one JSON object per line rather than a JSON document, and a
// rejected document is reported there with a 200 overall — so the body has to be read line by line or failures pass
// silently.
func (c *Client) Import(ctx context.Context, collection string, jsonl []byte) (ImportResult, error) {
	path := fmt.Sprintf("/collections/%s/documents/import?action=upsert", url.PathEscape(collection))
	payload, err := c.do(ctx, http.MethodPost, path, bytes.NewReader(jsonl), "text/plain")
	if err != nil {
		return ImportResult{}, err
	}
	result := ImportResult{}
	for _, line := range strings.Split(strings.TrimSpace(string(payload)), "\n") {
		if line == "" {
			continue
		}
		var parsed struct {
			Success bool   `json:"success"`
			Error   string `json:"error"`
		}
		if err := json.Unmarshal([]byte(line), &parsed); err != nil {
			return result, fmt.Errorf("unreadable import response line: %w", err)
		}
		if parsed.Success {
			result.Imported++
		} else {
			result.Failures = append(result.Failures, parsed.Error)
		}
	}
	return result, nil
}

// DeleteDocument reports whether a document was there to delete. Removing something already gone is the state the
// caller wanted, not an error.
func (c *Client) DeleteDocument(ctx context.Context, collection, id string) (bool, error) {
	path := fmt.Sprintf("/collections/%s/documents/%s", url.PathEscape(collection), url.PathEscape(id))
	if err := c.doJSON(ctx, http.MethodDelete, path, nil, nil); err != nil {
		var tsErr *Error
		if errorsAs(err, &tsErr) && tsErr.NotFound() {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// --- collections and aliases ---

type Collection struct {
	Name         string `json:"name"`
	NumDocuments int    `json:"num_documents"`
}

func (c *Client) ListCollections(ctx context.Context) ([]Collection, error) {
	var out []Collection
	if err := c.doJSON(ctx, http.MethodGet, "/collections", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) CreateCollection(ctx context.Context, schema json.RawMessage) error {
	return c.doJSON(ctx, http.MethodPost, "/collections", schema, nil)
}

func (c *Client) DropCollection(ctx context.Context, name string) error {
	err := c.doJSON(ctx, http.MethodDelete, "/collections/"+url.PathEscape(name), nil, nil)
	var tsErr *Error
	if errorsAs(err, &tsErr) && tsErr.NotFound() {
		return nil
	}
	return err
}

// ResolveAlias returns the collection an alias points at, or "" when there is no such alias.
func (c *Client) ResolveAlias(ctx context.Context, name string) (string, error) {
	var out struct {
		CollectionName string `json:"collection_name"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/aliases/"+url.PathEscape(name), nil, &out); err != nil {
		var tsErr *Error
		if errorsAs(err, &tsErr) && tsErr.NotFound() {
			return "", nil
		}
		return "", err
	}
	return out.CollectionName, nil
}

func (c *Client) UpsertAlias(ctx context.Context, name, collection string) error {
	return c.doJSON(ctx, http.MethodPut, "/aliases/"+url.PathEscape(name),
		map[string]string{"collection_name": collection}, nil)
}

func (c *Client) Health(ctx context.Context) error {
	var out struct {
		OK bool `json:"ok"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/health", nil, &out); err != nil {
		return err
	}
	if !out.OK {
		return fmt.Errorf("typesense reports itself unhealthy")
	}
	return nil
}
