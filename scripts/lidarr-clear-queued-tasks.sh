#!/bin/sh

# Get queued command IDs and cancel them all
LIDARR_URL="http://localhost:8686"
API_KEY="<your-lidarr-api-key>"

# Get all commands
curl -s "$LIDARR_URL/api/v1/command" -H "X-Api-Key: $API_KEY" | \
  jq -r '.[] | select(.status == "queued") | .id' | \
  while read id; do
    curl -X DELETE "$LIDARR_URL/api/v1/command/$id" -H "X-Api-Key: $API_KEY"
  done
