// Package supabase is a thin PostgREST client for the project's Supabase database — the service_role key over the
// REST API, which is how the Go API on the VPS reads and writes the hosted database.
//
// The deck crawls are the only user today. It mirrors the Typesense client: hand-rolled, status-carrying errors,
// deliberately no full Supabase SDK.
//
// Two call shapes, and no more. `RPC` posts to a security-definer function, which is how everything in the private
// `corpus` schema is reached: PostgREST can only address schemas on its exposed list, so a table path like
// `/rest/v1/corpus.decks` is read as a table *named* "corpus.decks" in `public` and answers PGRST205. Exposing
// `corpus` instead would defeat the point of the schema. `SelectAll` is table access for `public` rows the crawl
// reads directly (its app_config policy), paging a thousand at a time.
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

// MaxRowsPerRequest is the paging step, matching PostgREST's own default cap.
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

// RPC calls a Postgres function through PostgREST and returns its raw JSON result. args is marshalled as the
// function's named arguments, so the call site reads like the SQL signature.
func (c *Client) RPC(ctx context.Context, name string, args any) ([]byte, error) {
	if args == nil {
		args = map[string]any{}
	}
	return c.do(ctx, http.MethodPost, "/rpc/"+url.PathEscape(name), args, "")
}

// RPCInto calls a function and decodes its result into out.
func (c *Client) RPCInto(ctx context.Context, name string, args any, out any) error {
	payload, err := c.RPC(ctx, name, args)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("supabase: unreadable %s result: %w", name, err)
	}
	return nil
}

// SelectAll reads every matching row of an exposed (`public`) table, paging MaxRowsPerRequest at a time. Returns raw
// JSON rows; decoding is the caller's.
//
// filter is a single PostgREST condition, `column=operator.value`. It is deliberately one condition: PostgREST has
// no `a=eq.x and b=is.null` form, and splitting such a string on its first `=` produces a filter that silently
// matches nothing. Anything needing two conditions belongs in a function.
func (c *Client) SelectAll(ctx context.Context, table, columns, filter string) ([]json.RawMessage, error) {
	var all []json.RawMessage
	offset := 0
	for {
		q := url.Values{}
		q.Set("select", columns)
		if filter != "" {
			key, expr, ok := strings.Cut(filter, "=")
			if !ok {
				return nil, fmt.Errorf("supabase: filter %q is not column=operator.value", filter)
			}
			// A second "=" means someone wrote a compound expression. PostgREST has no such form: the whole tail
			// would become the value of the first condition, match nothing, and read as an empty table rather than
			// as a mistake. Two conditions belong in a function.
			if strings.Contains(expr, "=") {
				return nil, fmt.Errorf("supabase: filter %q is not a single condition", filter)
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

// AppConfig reads a row's jsonb `value` from public.app_config. Returns the null message when there is no row.
func (c *Client) AppConfig(ctx context.Context, key string) (json.RawMessage, error) {
	rows, err := c.SelectAll(ctx, "app_config", "value", "key=eq."+key)
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
