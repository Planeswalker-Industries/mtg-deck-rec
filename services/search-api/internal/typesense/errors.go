package typesense

import "errors"

// A one-line indirection so the client file reads without `errors.As(...)` noise at every call site.
func errorsAs(err error, target **Error) bool { return errors.As(err, target) }
