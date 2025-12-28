#!/bin/sh

# Get queued command IDs and cancel them all
LIDARR_URL="http://localhost:8686"
API_KEY="<your-lidarr-api-key>"
TASK_ID="$1"

curl -X DELETE "$LIDARR_URL/api/v1/command/$TASK_ID" -H "X-Api-Key: $API_KEY"

curl -s "$LIDARR_URL/api/v1/command" -H "X-Api-Key: $API_KEY" | jq '.[] | {id, name, status}'