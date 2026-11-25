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
	"errors"
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

// Waits before each retry of a transient failure: three retries, doubling, seven seconds in all. That rides out a
// dropped connection or a gateway restart (one reset once ended a whole crawl run), and a database that is really
// down still ends the run seconds later.
const (
	firstRetryWait  = 1 * time.Second
	secondRetryWait = 2 * time.Second
	thirdRetryWait  = 4 * time.Second
)

// Cloudflare's 520-524 say the origin behind Supabase's edge dropped or timed out the request: the same transient
// trouble as a 502 or 504, under Cloudflare's own codes.
const (
	cloudflareFirstOriginStatus = 520
	cloudflareLastOriginStatus  = 524
)

type Client struct {
	baseURL string // e.g. https://<ref>.supabase.co
	key     string // service_role
	http    *http.Client
	// waits holds the wait before each retry; its length is the number of retries. A field so tests can shorten it.
	waits []time.Duration
}

// New builds a client. baseURL is the Supabase project URL; the REST path is appended here, so callers never think
// about PostgREST layout. timeout bounds each attempt, not a call with its retries.
func New(baseURL, serviceKey string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/") + "/rest/v1",
		key:     serviceKey,
		http:    &http.Client{Timeout: timeout},
		waits:   []time.Duration{firstRetryWait, secondRetryWait, thirdRetryWait},
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

// transientError marks a failure worth another try: the connection dropped, timed out or ended early, or a gateway in
// front of PostgREST answered for it. Anything PostgREST itself answered (a 4xx, a 500 from the function) is not.
type transientError struct{ err error }

func (e *transientError) Error() string { return e.err.Error() }
func (e *transientError) Unwrap() error { return e.err }

func transientStatus(status int) bool {
	switch status {
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	}
	return status >= cloudflareFirstOriginStatus && status <= cloudflareLastOriginStatus
}

// do sends one request and, with retry set, sends it again after each transient failure, waiting c.waits between
// tries and giving up early when ctx ends. Only a call that is safe to repeat may retry: a lost reply does not mean
// the first attempt never landed.
func (c *Client) do(ctx context.Context, method, path string, body any, prefer string, retry bool) ([]byte, error) {
	var encoded []byte
	if body != nil {
		var err error
		if encoded, err = json.Marshal(body); err != nil {
			return nil, err
		}
	}
	for attempt := 0; ; attempt++ {
		payload, err := c.send(ctx, method, path, encoded, body != nil, prefer)
		var transient *transientError
		if !errors.As(err, &transient) {
			return payload, err
		}
		if !retry || attempt >= len(c.waits) {
			return nil, transient.err
		}
		timer := time.NewTimer(c.waits[attempt])
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, fmt.Errorf("%w (while retrying after: %v)", ctx.Err(), transient.err)
		case <-timer.C:
		}
	}
}

// send makes one attempt. hasBody says encoded is a JSON body to send.
func (c *Client) send(ctx context.Context, method, path string, encoded []byte, hasBody bool, prefer string) ([]byte, error) {
	var reader io.Reader
	if hasBody {
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+c.key)
	if hasBody {
		req.Header.Set("Content-Type", "application/json")
	}
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}
	res, err := c.http.Do(req)
	if err != nil {
		// A cancelled or expired ctx is the caller stopping, not the network failing: never worth another try.
		if ctx.Err() != nil {
			return nil, err
		}
		return nil, &transientError{err}
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	if err != nil {
		if ctx.Err() != nil {
			return nil, err
		}
		return nil, &transientError{err}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		restErr := &Error{Status: res.StatusCode, Body: string(payload)}
		if transientStatus(res.StatusCode) {
			return nil, &transientError{restErr}
		}
		return nil, restErr
	}
	return payload, nil
}

// RPC calls a Postgres function through PostgREST and returns its raw JSON result. args is marshalled as the
// function's named arguments, so the call site reads like the SQL signature.
//
// A transient failure (a dropped connection, a gateway 502/503/504) is retried, so the function must be safe to run
// twice: an upsert, a read, a write keyed on the run. A function that is not uses RPCOnce.
func (c *Client) RPC(ctx context.Context, name string, args any) ([]byte, error) {
	return c.rpc(ctx, name, args, true)
}

// RPCOnce is RPC without the retry, for a function that must not run twice: one that creates a row each call, say,
// where a reply lost after the insert would make a retry insert a second.
func (c *Client) RPCOnce(ctx context.Context, name string, args any) ([]byte, error) {
	return c.rpc(ctx, name, args, false)
}

func (c *Client) rpc(ctx context.Context, name string, args any, retry bool) ([]byte, error) {
	if args == nil {
		args = map[string]any{}
	}
	return c.do(ctx, http.MethodPost, "/rpc/"+url.PathEscape(name), args, "", retry)
}

// RPCInto calls a function and decodes its result into out. It retries as RPC does.
func (c *Client) RPCInto(ctx context.Context, name string, args any, out any) error {
	return c.rpcInto(ctx, name, args, out, true)
}

// RPCOnceInto is RPCInto without the retry (see RPCOnce).
func (c *Client) RPCOnceInto(ctx context.Context, name string, args any, out any) error {
	return c.rpcInto(ctx, name, args, out, false)
}

func (c *Client) rpcInto(ctx context.Context, name string, args any, out any, retry bool) error {
	payload, err := c.rpc(ctx, name, args, retry)
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
		// A read: safe to repeat.
		payload, err := c.do(ctx, http.MethodGet, "/"+table+"?"+q.Encode(), nil, "", true)
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
