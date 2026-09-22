// Package supabase is a thin PostgREST client for the project's Supabase database — the service_role key over the
// REST API, which is how the Go API on the VPS reads and writes the hosted database.
//
// The Moxfield crawl is the only user today. It mirrors the Typesense client: hand-rolled, status-carrying errors,
// deliberately no full Supabase SDK. The rows it moves are small and few, so paging is one `limit`/`offset` loop
// and nothing here tries to be general PostgREST.
package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// MaxRowsPerRequest is the paging step. PostgREST caps at 1000 by default and the crawl's data sets are a few
// thousand rows, so a loop of this size is one slow request at worst.
const MaxRowsPerRequest = 1000

type Client struct {
	baseURL string // e.g. https://<ref>.supabase.co
	key     string // service_role
	http    *http.Client
}

// New builds a client. baseURL is the Supabase project URL; the REST path is appended here, so callers never think
// about PostgREST layout.
func New(baseURL, serviceKey string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/") + "/rest/v1",
		key:     serviceKey,
		http:    &http.Client{Timeout: timeout},
	}
}

// Error carries the REST status so callers can tell "row missing" from "database down", the difference between a
// quiet no-op and something to report.
type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string {
	return fmt.Sprintf("supabase: HTTP %d: %s", e.Status, truncate(e.Body, 300))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func (c *Client) do(ctx context.Context, method, path string, body any, prefer string) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+c.key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
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

// SelectAll reads every matching row, paging MaxRowsPerRequest at a time. Returns raw JSON rows; decoding is the
// caller's, because the crawl decodes three different shapes from the same client.
//
// filter is a PostgREST condition in its native form, e.g. "source_deck_id=in.(\"a\",\"b\")". It is set as a single
// query parameter and url.Values encodes it, so parens, quotes and dots survive the wire.
func (c *Client) SelectAll(ctx context.Context, table, columns, filter string) ([]json.RawMessage, error) {
	var all []json.RawMessage
	offset := 0
	for {
		q := url.Values{}
		q.Set("select", columns)
		if filter != "" {
			key, expr, ok := strings.Cut(filter, "=")
			if !ok {
				return nil, fmt.Errorf("supabase: filter %q is not key=expr", filter)
			}
			q.Set(key, expr)
		}
		q.Set("limit", strconv.Itoa(MaxRowsPerRequest))
		q.Set("offset", strconv.Itoa(offset))
		payload, err := c.do(ctx, http.MethodGet, "/"+table+"?"+q.Encode(), nil, "")
		if err != nil {
			return nil, err
		}
		var page []json.RawMessage
		if err := json.Unmarshal(payload, &page); err != nil {
			return nil, fmt.Errorf("supabase: unreadable %s page: %w", table, err)
		}
		all = append(all, page...)
		if len(page) < MaxRowsPerRequest {
			return all, nil
		}
		offset += len(page)
	}
}

// Upsert writes or merges `rows` by the given conflict columns (PostgREST `resolution=merge-duplicates` +
// `on_conflict`). Always called with rows that actually differ, so a write here is a real change.
func (c *Client) Upsert(ctx context.Context, table string, rows any, onConflict []string) error {
	cols := strings.Join(onConflict, ",")
	_, err := c.do(ctx, http.MethodPost, "/"+table+"?on_conflict="+cols, rows, "resolution=merge-duplicates")
	return err
}

// Insert writes rows and returns the created ones (return=representation), so a generated id can be read back. Call
// with onConflict empty for a pure insert; pass columns to make it an upsert.
func (c *Client) Insert(ctx context.Context, table string, rows any, selectColumns string, onConflict []string) ([]byte, error) {
	q := url.Values{}
	q.Set("select", selectColumns)
	if len(onConflict) > 0 {
		q.Set("on_conflict", strings.Join(onConflict, ","))
	}
	return c.do(ctx, http.MethodPost, "/"+table+"?"+q.Encode(), rows, "return=representation")
}

// Update patches the rows matched by filter with `row`. Used for the single crawl_state row.
func (c *Client) Update(ctx context.Context, table, filter string, row any) error {
	_, err := c.UpdateReturning(ctx, table, filter, "", row)
	return err
}

// UpdateReturning patches matching rows and returns the updated ones, so a caller can tell "nothing matched" from
// "it went through" - which is the whole mechanism behind an atomic claim. filter may be a compound expression, e.g.
// "id=eq.1 and running_run_id=is.null", in which case PostgREST only patches when the extra condition holds.
func (c *Client) UpdateReturning(ctx context.Context, table, filter, selectColumns string, row any) ([]byte, error) {
	q := url.Values{}
	key, expr, ok := strings.Cut(filter, "=")
	if ok {
		q.Set(key, expr)
	}
	if selectColumns != "" {
		q.Set("select", selectColumns)
	}
	return c.do(ctx, http.MethodPatch, "/"+table+"?"+q.Encode(), row, "return=representation")
}

// AppConfig reads a row's jsonb `value` from public.app_config. Returns the null message when there is no row.
func (c *Client) AppConfig(ctx context.Context, key string) (json.RawMessage, error) {
	rows, err := c.SelectAll(ctx, "app_config", "value", "key=eq."+url.QueryEscape(key))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return json.RawMessage("null"), nil
	}
	var first struct {
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(rows[0], &first); err != nil {
		return nil, err
	}
	return first.Value, nil
}
