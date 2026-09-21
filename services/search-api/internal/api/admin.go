package api

import (
	"encoding/json"
	"regexp"

	"github.com/gofiber/fiber/v3"
)

// Document ids as the worker produces them: a card id, a tag UUID, or a "keyId:cardId" pair. Checked because the id
// goes into a URL path.
var documentID = regexp.MustCompile(`^[A-Za-z0-9:_.-]{1,128}$`)

func (s *Server) collectionParam(c fiber.Ctx) (string, error) {
	name := c.Params("name")
	if !collectionName.MatchString(name) {
		return "", badRequest("that is not a valid collection name")
	}
	return name, nil
}

func (s *Server) listCollections(c fiber.Ctx) error {
	collections, err := s.ts.ListCollections(c.Context())
	if err != nil {
		return err
	}
	// make(..., 0, n) rather than a nil slice: an empty index is `[]` in the response, never `null`.
	out := make([]fiber.Map, 0, len(collections))
	for _, collection := range collections {
		out = append(out, fiber.Map{"name": collection.Name, "numDocuments": collection.NumDocuments})
	}
	return c.JSON(fiber.Map{"collections": out})
}

// createCollection passes the schema straight through. The schema is defined in @mtg/core/search and the worker
// sends it verbatim; restating it in Go would give it a second definition to drift from.
func (s *Server) createCollection(c fiber.Ctx) error {
	schema := json.RawMessage(c.Body())
	var probe struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(schema, &probe); err != nil {
		return badRequest("the schema is not valid JSON")
	}
	if !collectionName.MatchString(probe.Name) {
		return badRequest("the schema needs a valid `name`")
	}
	if err := s.ts.CreateCollection(c.Context(), schema); err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"name": probe.Name})
}

func (s *Server) dropCollection(c fiber.Ctx) error {
	name, err := s.collectionParam(c)
	if err != nil {
		return err
	}
	if err := s.ts.DropCollection(c.Context(), name); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"dropped": name})
}

// importDocuments takes JSONL exactly as Typesense does, because that is what the worker already builds and
// re-encoding tens of thousands of documents through this service would buy nothing.
func (s *Server) importDocuments(c fiber.Ctx) error {
	name, err := s.collectionParam(c)
	if err != nil {
		return err
	}
	body := c.Body()
	if len(body) == 0 {
		return c.JSON(fiber.Map{"imported": 0, "failures": []string{}})
	}
	result, err := s.ts.Import(c.Context(), name, body)
	if err != nil {
		return err
	}
	failures := result.Failures
	if failures == nil {
		failures = []string{}
	}
	return c.JSON(fiber.Map{"imported": result.Imported, "failures": failures})
}

func (s *Server) deleteDocument(c fiber.Ctx) error {
	name, err := s.collectionParam(c)
	if err != nil {
		return err
	}
	id := c.Params("id")
	if !documentID.MatchString(id) {
		return badRequest("that is not a valid document id")
	}
	deleted, err := s.ts.DeleteDocument(c.Context(), name, id)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"deleted": deleted})
}

func (s *Server) getAlias(c fiber.Ctx) error {
	name, err := s.collectionParam(c)
	if err != nil {
		return err
	}
	target, err := s.ts.ResolveAlias(c.Context(), name)
	if err != nil {
		return err
	}
	// An absent alias is a null rather than a 404: "there is no alias" is the answer, not a failure to answer.
	if target == "" {
		return c.JSON(fiber.Map{"collectionName": nil})
	}
	return c.JSON(fiber.Map{"collectionName": target})
}

func (s *Server) putAlias(c fiber.Ctx) error {
	name, err := s.collectionParam(c)
	if err != nil {
		return err
	}
	var body struct {
		CollectionName string `json:"collectionName"`
	}
	if err := decodeBody(c, &body); err != nil {
		return err
	}
	if !collectionName.MatchString(body.CollectionName) {
		return badRequest("collectionName must be a valid collection name")
	}
	if err := s.ts.UpsertAlias(c.Context(), name, body.CollectionName); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"name": name, "collectionName": body.CollectionName})
}
