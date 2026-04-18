#!/bin/sh
set -e

echo "Starting Relay Control Plane..."

# Start PocketBase in background
/pb/pocketbase serve --http=0.0.0.0:8090 --dir=/pb/pb_data &
PB_PID=$!

# Fixed delay before first health check
echo "Waiting for PocketBase to initialize..."
sleep 5

# Wait for PocketBase to be ready with improved logging
i=0
while [ $i -lt 30 ]; do
    if wget -q -O /dev/null http://127.0.0.1:8090/api/health 2>/dev/null; then
        echo "PocketBase is ready"
        break
    fi
    echo "Waiting for PocketBase... ($i/30)"
    sleep 2
    i=$((i+1))
done

if [ $i -ge 30 ]; then
    echo "ERROR: PocketBase failed to start within 30s"
    exit 1
fi

# Create initial superuser via API once PocketBase is ready
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
    echo "Creating superuser..."
    CREATE_RESULT=$(wget -qO- --post-data "{\"email\":\"$PB_ADMIN_EMAIL\",\"password\":\"$PB_ADMIN_PASSWORD\",\"passwordConfirm\":\"$PB_ADMIN_PASSWORD\"}" \
        --header "Content-Type: application/json" \
        http://127.0.0.1:8090/api/admins 2>&1) || true
    
    if echo "$CREATE_RESULT" | jq -e '.id' > /dev/null 2>&1; then
        echo "Superuser created"
    else
        # Check if already exists (code 400 with "already exists")
        if echo "$CREATE_RESULT" | grep -q "already exists"; then
            echo "Superuser already exists"
        else
            echo "Superuser creation warning: $CREATE_RESULT"
        fi
    fi

    # Configure OAuth2 if credentials provided
    if [ -n "$GITHUB_CLIENT_ID" ] && [ -n "$GITHUB_CLIENT_SECRET" ]; then
        echo "Configuring GitHub OAuth2..."
        
        AUTH_RESPONSE=$(wget -qO- --post-data "{\"identity\":\"$PB_ADMIN_EMAIL\",\"password\":\"$PB_ADMIN_PASSWORD\"}" \
            --header "Content-Type: application/json" \
            http://127.0.0.1:8090/api/admins/auth-with-password 2>/dev/null) || true
        
        ADMIN_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.token // empty')
        
        if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "null" ]; then
            echo "Got admin token, updating settings..."
            
            REDIRECT_URL="${PB_PUBLIC_URL:-http://127.0.0.1:8090}/api/oauth2-redirect"

            SETTINGS_RESPONSE=$(wget -qO- --method=PATCH --body-data "{\"githubAuth\":{\"enabled\":true,\"clientId\":\"$GITHUB_CLIENT_ID\",\"clientSecret\":\"$GITHUB_CLIENT_SECRET\",\"redirectUrl\":\"$REDIRECT_URL\"}}" \
                --header "Content-Type: application/json" \
                --header "Authorization: $ADMIN_TOKEN" \
                http://127.0.0.1:8090/api/settings 2>&1) || true
            
            if echo "$SETTINGS_RESPONSE" | jq -e '.githubAuth' > /dev/null 2>&1; then
                echo "GitHub OAuth configured successfully"
            else
                echo "OAuth config warning: $SETTINGS_RESPONSE"
            fi
        else
            echo "Failed to get admin token, skipping OAuth config"
        fi
    else
        echo "GitHub OAuth credentials not set, skipping"
    fi
fi

echo "Startup complete"
wait $PB_PID