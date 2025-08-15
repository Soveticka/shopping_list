# Build stage
FROM golang:1.23-alpine AS builder

# Install git and other build dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy go mod files first
COPY go.mod ./

# Copy source code to allow go mod tidy to work correctly
COPY . .

# Download dependencies and generate go.sum
RUN go mod tidy && go mod download

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Final stage
FROM alpine:latest

# Install ca-certificates for HTTPS requests (OIDC)
RUN apk --no-cache add ca-certificates

# Create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

WORKDIR /root/

# Copy the binary from builder stage
COPY --from=builder /app/main .

# Change ownership to non-root user
RUN chown appuser:appuser main
USER appuser

# Expose port
EXPOSE 3001

# Command to run the application
CMD ["./main"]