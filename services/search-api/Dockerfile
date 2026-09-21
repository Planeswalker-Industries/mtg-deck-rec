# Two stages: build with the toolchain, ship without it. The result is a static binary on distroless — no shell, no
# package manager, nothing to patch but the binary itself.
FROM golang:1.25-alpine AS build
WORKDIR /src

# Dependencies first, so a code change does not re-download the module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/search-api .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/search-api /search-api
EXPOSE 8080
USER nonroot:nonroot
# `healthcheck` is a mode of this same binary: distroless has no shell to run curl in, and a healthcheck that cannot
# run marks a working container unhealthy forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/search-api", "healthcheck"]
ENTRYPOINT ["/search-api"]
